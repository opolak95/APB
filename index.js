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
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { saveEvent, archiveEvent } = require('./db/database');
const eventPresets = require('./config/events');

// Ensure required env vars
const { BOT_TOKEN, CHANNEL_ID, CLIENT_ID } = process.env;
if (!BOT_TOKEN || !CHANNEL_ID || !CLIENT_ID) {
  console.error('❌ Missing BOT_TOKEN, CHANNEL_ID or CLIENT_ID');
  process.exit(1);
}

// Initialize client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

let activeEvent = null;
let expiresAt = null;

// Global error handling
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({ content: '✅ Bot is online! Use `/create` to make an event.', flags: 64 });
  } catch (err) {
    console.error('Failed to send online message:', err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1) Slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
      const entries = Object.entries(eventPresets);
      if (entries.length === 0) {
        return interaction.reply({ content: '❌ No event presets available.', flags: 64 });
      }
      // Limit to 25 options
      const options = entries.slice(0, 25).map(([key, preset]) => ({
        label: preset.title,
        description: preset.description.substring(0, 100),
        value: key
      }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId('select_event_type')
        .setPlaceholder('Select event type')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({ content: '👇 Choose event type:', components: [row], flags: 64 });
      return;
    }

    // 2) Select menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_event_type') {
      const typeKey = interaction.values[0];
      const preset = eventPresets[typeKey];
      if (!preset) {
        return interaction.update({ content: '❌ Invalid type.', components: [], flags: 64 });
      }
      const modal = new ModalBuilder()
        .setCustomId(`event_details|${typeKey}`)
        .setTitle(`Create ${preset.title}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('event_date')
            .setLabel('Date (e.g. 20.6.2025)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('event_time')
            .setLabel('Time (e.g. 20:00)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('event_location')
            .setLabel('Location')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // 3) Modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('event_details|')) {
      await interaction.deferReply({ flags: 64 });
      const [, typeKey] = interaction.customId.split('|');
      const preset = eventPresets[typeKey];
      if (!preset) {
        return interaction.editReply({ content: '❌ Invalid type.', flags: 64 });
      }
      const date = interaction.fields.getTextInputValue('event_date');
      const time = interaction.fields.getTextInputValue('event_time');
      const location = interaction.fields.getTextInputValue('event_location');

      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Date', value: date, inline: true },
          { name: '⏰ Time', value: time, inline: true },
          { name: '📍 Location', value: location, inline: true }
        )
        .setColor(0x0099ff);

      const registrations = {};
      preset.roles.forEach(r => registrations[r.name] = []);
      preset.roles.forEach(r => embed.addFields({ name: `${r.name} (0/${r.max})`, value: '*nobody*', inline: true }));

      activeEvent = { preset, registrations, meta: { date, time, location } };
      expiresAt = Date.now() + 3600000;

      const rows = [];
      for (let i = 0; i < preset.roles.length; i += 5) {
        const row = new ActionRowBuilder();
        preset.roles.slice(i, i + 5).forEach(r => {
          row.addComponents(
            new ButtonBuilder().setCustomId(`join_${r.name}`).setLabel(r.name).setStyle(ButtonStyle.Primary)
          );
        });
        rows.push(row);
      }
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('maybe').setLabel('⚪ Maybe').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('leave').setLabel('🚪 Leave').setStyle(ButtonStyle.Danger)
        )
      );

      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [embed], components: rows });
      await interaction.editReply({ content: '✅ Event created!', flags: 64 });
      return;
    }

    // 4) Button interaction
    if (interaction.isButton()) {
      if (!activeEvent) {
        return interaction.reply({ content: '❌ No event.', flags: 64 });
      }
      const user = interaction.user;
      const action = interaction.customId;
      const { preset, registrations, meta } = activeEvent;
      Object.keys(registrations).forEach(k => registrations[k] = registrations[k].filter(u => u.id !== user.id));
      if (action.startsWith('join_')) {
        const roleName = action.replace('join_', '');
        const r = preset.roles.find(x => x.name === roleName);
        if (registrations[roleName].length >= r.max) return interaction.reply({ content: '⚠️ Full.', flags: 64 });
        registrations[roleName].push({ id: user.id, name: user.username });
      } else if (action === 'maybe') {
        registrations['Maybe'] = registrations['Maybe'] || [];
        registrations['Maybe'].push({ id: user.id, name: user.username });
      } else if (action === 'decline') {
        registrations['Decline'] = registrations['Decline'] || [];
        registrations['Decline'].push({ id: user.id, name: user.username });
      }

      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Date', value: meta.date, inline: true },
          { name: '⏰ Time', value: meta.time, inline: true },
          { name: '📍 Location', value: meta.location, inline: true }
        )
        .setColor(0x00ff00);
      preset.roles.forEach(r => {
        const list = registrations[r.name].map(u => `<@${u.id}>`).join(', ') || '*nobody*';
        embed.addFields({ name: `${r.name} (${registrations[r.name].length}/${r.max})`, value: list });
      });
      ['Maybe','Decline'].forEach(s => {
        if (registrations[s]) {
          const list = registrations[s].map(u => `<@${u.id}>`).join(', ') || '*nobody*';
          embed.addFields({ name: s, value: list });
        }
      });
      await interaction.update({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: '❌ Error occurred.', flags: 64 });
    }
  }
});

// Auto-archive
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(BOT_TOKEN);
