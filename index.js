require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

const eventPresets = require('./config/events');
const { saveEvent, archiveEvent } = require('./db/database');

const CHANNEL_ID = process.env.CHANNEL_ID;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

let activeEvent = null;
let expiresAt = null;
const pendingEvents = {};

process.on('unhandledRejection', error => {
  console.error('🔴 Nezachycená chyba (promise):', error);
});
process.on('uncaughtException', error => {
  console.error('🔴 Nezachycená výjimka:', error);
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send('✅ Jsem online a připraven sloužit Přátelům Hranatého Stolu!');
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
    const type = interaction.options.getString('type');
    const preset = eventPresets[type.toLowerCase()];

    if (!preset) return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });

    pendingEvents[interaction.user.id] = { preset };

    const modal = new ModalBuilder()
      .setCustomId('event_details_modal')
      .setTitle('Detaily eventu');

    const dateInput = new TextInputBuilder()
      .setCustomId('event_date')
      .setLabel('Datum (např. 2025-06-21)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId('event_time')
      .setLabel('Čas (např. 20:00)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const locationInput = new TextInputBuilder()
      .setCustomId('event_location')
      .setLabel('Startovací lokace')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(locationInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'event_details_modal') {
    const userEvent = pendingEvents[interaction.user.id];
    if (!userEvent) return interaction.reply({ content: '❌ Něco se pokazilo.', ephemeral: true });

    const date = interaction.fields.getTextInputValue('event_date');
    const time = interaction.fields.getTextInputValue('event_time');
    const location = interaction.fields.getTextInputValue('event_location');

    const embed = new EmbedBuilder()
      .setTitle(`${userEvent.preset.title}`)
      .setDescription(`${userEvent.preset.description}\n📅 ${date} 🕒 ${time} 📍 ${location}`)
      .setColor(0x0099ff);

    const rows = [];
    const row = new ActionRowBuilder();
    const registrations = {};

    userEvent.preset.roles.forEach(role => {
      registrations[role.name] = [];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`role_${role.name}`)
          .setLabel(role.name)
          .setStyle(ButtonStyle.Primary)
      );
    });

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('leave_event')
        .setLabel('Zrušit účast')
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(row);

    activeEvent = {
      preset: userEvent.preset,
      registrations,
      createdAt: Date.now(),
      createdBy: interaction.user.id,
      type: userEvent.preset.title
    };
    expiresAt = Date.now() + 60 * 60 * 1000;

    saveEvent(activeEvent);

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({ embeds: [embed], components: rows });

    await interaction.reply({ content: '✅ Event vytvořen a zveřejněn!', ephemeral: true });
    delete pendingEvents[interaction.user.id];
  }

  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });

    try {
      const user = interaction.user;
      const roleName = interaction.customId.replace('role_', '');
      const { registrations, preset } = activeEvent;

      if (interaction.customId === 'leave_event') {
        let removed = false;
        for (const role in registrations) {
          const index = registrations[role].findIndex(u => u.id === user.id);
          if (index !== -1) {
            registrations[role].splice(index, 1);
            removed = true;
          }
        }
        if (!removed) return interaction.reply({ content: '❌ Nejsi přihlášen.', ephemeral: true });
      } else {
        const alreadyRegistered = Object.values(registrations).some(list =>
          list.find(u => u.id === user.id)
        );
        if (alreadyRegistered) return interaction.reply({ content: '⚠️ Už jsi přihlášen.', ephemeral: true });

        const role = preset.roles.find(r => r.name === roleName);
        if (!role) return interaction.reply({ content: '❌ Neplatná role.', ephemeral: true });

        if (registrations[roleName].length >= role.max) {
          return interaction.reply({ content: '⚠️ Tato role je již plná.', ephemeral: true });
        }

        registrations[roleName].push({ id: user.id, name: user.username });
      }

      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .setColor(0x00ff00);

      preset.roles.forEach(role => {
        const players = registrations[role.name].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
        embed.addFields({
          name: `${role.name} (${registrations[role.name].length}/${role.max})`,
          value: players
        });
      });

      await interaction.update({ embeds: [embed] });
    } catch (error) {
      console.error('❗ Chyba při zpracování tlačítka:', error);
    }
  }
});

setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event vypršel, archivace...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(process.env.BOT_TOKEN);
