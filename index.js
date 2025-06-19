// index.js
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
  TextInputStyle
} = require('discord.js');
const { saveEvent, archiveEvent } = require('./db/database');
const eventPresets = require('./config/events');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.Channel]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
let activeEvent = null;
let expiresAt = null;

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send('✅ Jsem online a slash příkazy byly zaregistrovány.');
});

client.on(Events.InteractionCreate, async interaction => {
  // /create spustí modal
  if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
    const modal = new ModalBuilder()
      .setCustomId('event_details')
      .setTitle('Nový Albion Event');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_type')
          .setLabel('Typ eventu (např. ss, zvz, faction...)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_date')
          .setLabel('Datum (např. 20. 6. 2025)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_time')
          .setLabel('Čas (např. 20:00)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('event_location')
          .setLabel('Startovací lokace')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  }

  // Zpracování modalu
  if (interaction.isModalSubmit() && interaction.customId === 'event_details') {
    const type = interaction.fields.getTextInputValue('event_type').toLowerCase();
    const date = interaction.fields.getTextInputValue('event_date');
    const time = interaction.fields.getTextInputValue('event_time');
    const location = interaction.fields.getTextInputValue('event_location');

    const preset = eventPresets[type];
    if (!preset) return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(preset.title)
      .setDescription(preset.description)
      .addFields(
        { name: '📅 Datum', value: date, inline: true },
        { name: '⏰ Čas', value: time, inline: true },
        { name: '📍 Lokace', value: location, inline: true }
      )
      .setColor(0x0099ff);

    const registrations = {};
    preset.roles.forEach(role => {
      registrations[role.name] = [];
      embed.addFields({ name: `${role.name} (0/${role.max})`, value: '*nikdo*', inline: true });
    });

    activeEvent = {
      preset,
      registrations,
      createdAt: Date.now(),
      createdBy: interaction.user.id,
      meta: { date, time, location },
      type
    };
    expiresAt = Date.now() + 60 * 60 * 1000;

    const roleButtons = new ActionRowBuilder();
    preset.roles.slice(0, 5).forEach(role => {
      roleButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`join_${role.name}`)
          .setLabel(role.name)
          .setStyle(ButtonStyle.Primary)
      );
    });

    const statusButtons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('maybe').setLabel('⚪ Možná').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('decline').setLabel('❌ Nezúčastním se').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('leave').setLabel('Zrušit účast').setStyle(ButtonStyle.Danger)
      );

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({ embeds: [embed], components: [roleButtons, statusButtons] });
    await interaction.reply({ content: '✅ Event vytvořen!', ephemeral: true });
  }

  // Zpracování tlačítek
  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });

    const user = interaction.user;
    const action = interaction.customId;
    const { preset, registrations } = activeEvent;

    Object.keys(registrations).forEach(role => {
      registrations[role] = registrations[role].filter(u => u.id !== user.id);
    });

    if (action.startsWith('join_')) {
      const roleName = action.replace('join_', '');
      const role = preset.roles.find(r => r.name === roleName);
      if (registrations[roleName].length >= role.max) {
        return interaction.reply({ content: '⚠️ Tato role je již plná.', ephemeral: true });
      }
      registrations[roleName].push({ id: user.id, name: user.username });
    }
    if (action === 'maybe') {
      if (!registrations['Možná']) registrations['Možná'] = [];
      registrations['Možná'].push({ id: user.id, name: user.username });
    }
    if (action === 'decline') {
      if (!registrations['Nezúčastním se']) registrations['Nezúčastním se'] = [];
      registrations['Nezúčastním se'].push({ id: user.id, name: user.username });
    }

    const embed = new EmbedBuilder()
      .setTitle(preset.title)
      .setDescription(preset.description)
      .addFields(
        { name: '📅 Datum', value: activeEvent.meta.date, inline: true },
        { name: '⏰ Čas', value: activeEvent.meta.time, inline: true },
        { name: '📍 Lokace', value: activeEvent.meta.location, inline: true }
      )
      .setColor(0x00ff00);

    preset.roles.forEach(role => {
      const players = registrations[role.name].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
      embed.addFields({ name: `${role.name} (${registrations[role.name].length}/${role.max})`, value: players });
    });

    ['Možná', 'Nezúčastním se'].forEach(status => {
      if (registrations[status]) {
        const list = registrations[status].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
        embed.addFields({ name: status, value: list });
      }
    });

    await interaction.update({ embeds: [embed] });
  }
});

// Archivace po expiraci
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event vypršel, archivace...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(process.env.BOT_TOKEN);
