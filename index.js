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
  StringSelectMenuBuilder
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

// Přihlášení
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send('✅ Jsem online a připraven sloužit Přátelům Hranatého Stolu!');
});

// Slash příkaz: zobrazí dropdown
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
    const options = Object.keys(eventPresets).map(key => ({
      label: eventPresets[key].title,
      value: key
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_event_type')
      .setPlaceholder('Vyber typ eventu')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);
    await interaction.reply({ content: '👇 Vyber typ eventu:', components: [row], ephemeral: true });
  }

  // Po výběru typu v dropdownu
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_event_type') {
    const type = interaction.values[0];
    const preset = eventPresets[type];
    if (!preset) return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(preset.title)
      .setDescription(preset.description)
      .setColor(0x0099ff);

    const registrations = {};
    preset.roles.forEach(role => {
      registrations[role.name] = [];
      embed.addFields({ name: `${role.name} (0/${role.max})`, value: '*nikdo*' });
    });

    activeEvent = { preset, registrations, createdAt: Date.now(), createdBy: interaction.user.id, type };
    expiresAt = Date.now() + 60 * 60 * 1000;
    saveEvent(activeEvent);

    const row = new ActionRowBuilder();
    preset.roles.forEach(role => {
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

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({ embeds: [embed], components: [row] });

    await interaction.update({ content: '✅ Event byl vytvořen!', components: [] });
  }

  // Tlačítka pro přihlášení
  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });

    const user = interaction.user;
    const roleName = interaction.customId.replace('role_', '');
    const { registrations, preset } = activeEvent;

    if (interaction.customId === 'leave_event') {
      for (const role in registrations) {
        registrations[role] = registrations[role].filter(u => u.id !== user.id);
      }
    } else {
      const alreadyRegistered = Object.values(registrations).some(list => list.find(u => u.id === user.id));
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
      embed.addFields({ name: `${role.name} (${registrations[role.name].length}/${role.max})`, value: players });
    });

    await interaction.update({ embeds: [embed] });
  }
});

// Automatická archivace
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event vypršel, archivace...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(process.env.BOT_TOKEN);
