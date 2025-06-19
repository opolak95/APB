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

// Validate essential environment variables
const { BOT_TOKEN, CHANNEL_ID, CLIENT_ID } = process.env;
if (!BOT_TOKEN || !CHANNEL_ID || !CLIENT_ID) {
  console.error('❌ Missing one of BOT_TOKEN, CHANNEL_ID, CLIENT_ID');
  process.exit(1);
}

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

// State for the active event
let activeEvent = null;
let expiresAt = null;

// Global error handling
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send('✅ Bot is online! Use `/create` to start an Albion event.');
  } catch (err) {
    console.error('❌ Failed to send online confirmation:', err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1) Slash command /create: prompt type selection
    if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
      const options = Object.entries(eventPresets).map(([key, preset]) => ({
        label: preset.title,
        description: preset.description,
        value: key
      }));
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_event_type')
        .setPlaceholder('Select event type')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ content: '👇 Select the event type:', components: [row], ephemeral: true });
      return;
    }

    // 2) Handle select menu: show modal for details
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_event_type') {
      const typeKey = interaction.values[0];
      const preset = eventPresets[typeKey];
      if (!preset) {
        return interaction.update({ content: '❌ Invalid event type', components: [], ephemeral: true });
      }
      const modal = new ModalBuilder()
        .setCustomId(`event_details|${typeKey}`)
        .setTitle(`Create: ${preset.title}`);

      const dateInput = new TextInputBuilder()
        .setCustomId('event_date')
        .setLabel('Date (e.g. 20.6.2025)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const timeInput = new TextInputBuilder()
        .setCustomId('event_time')
        .setLabel('Time (e.g. 20:00)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const locationInput = new TextInputBuilder()
        .setCustomId('event_location')
        .setLabel('Start location')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(timeInput),
        new ActionRowBuilder().addComponents(locationInput)
      );
      await interaction.showModal(modal);
      return;
    }

    // 3) Modal submit: build event embed
    if (interaction.isModalSubmit() && interaction.customId.startsWith('event_details|')) {
      const [, typeKey] = interaction.customId.split('|');
      const preset = eventPresets[typeKey];
      if (!preset) {
        return interaction.reply({ content: '❌ Invalid event type', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

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

      // Initialize registrations
      const registrations = {};
      preset.roles.forEach(role => registrations[role.name] = []);

      // Add initial role fields
      preset.roles.forEach(role => {
        embed.addFields({ name: `${role.name} (0/${role.max})`, value: '*nobody*', inline: true });
      });

      activeEvent = { preset, registrations, meta: { date, time, location } };
      expiresAt = Date.now() + 60 * 60 * 1000;

      // Build button rows dynamically (groups of 5)
      const rows = [];
      for (let i = 0; i < preset.roles.length; i += 5) {
        const row = new ActionRowBuilder();
        preset.roles.slice(i, i + 5).forEach(role => {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`join_${role.name}`)
              .setLabel(role.name)
              .setStyle(ButtonStyle.Primary)
          );
        });
        rows.push(row);
      }
      // Status buttons
      const statusRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('maybe').setLabel('⚪ Maybe').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('leave').setLabel('🚪 Leave').setStyle(ButtonStyle.Danger)
      );
      rows.push(statusRow);

      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [embed], components: rows });
      await interaction.editReply({ content: '✅ Event created!', ephemeral: true });
      return;
    }

    // 4) Button interactions: update registrations
    if (interaction.isButton()) {
      if (!activeEvent) {
        return interaction.reply({ content: '❌ No active event.', ephemeral: true });
      }
      const user = interaction.user;
      const action = interaction.customId;
      const { preset, registrations, meta } = activeEvent;

      // Remove user from all roles/statuses
      Object.keys(registrations).forEach(key => {
        registrations[key] = registrations[key].filter(u => u.id !== user.id);
      });

      if (action.startsWith('join_')) {
        const roleName = action.replace('join_', '');
        const role = preset.roles.find(r => r.name === roleName);
        if (registrations[roleName].length >= role.max) {
          return interaction.reply({ content: '⚠️ Role full.', ephemeral: true });
        }
        registrations[roleName].push({ id: user.id, name: user.username });
      } else if (action === 'maybe') {
        registrations['Maybe'] = registrations['Maybe'] || [];
        registrations['Maybe'].push({ id: user.id, name: user.username });
      } else if (action === 'decline') {
        registrations['Decline'] = registrations['Decline'] || [];
        registrations['Decline'].push({ id: user.id, name: user.username });
      } // leave already handled by reset

      // Rebuild embed
      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Date', value: meta.date, inline: true },
          { name: '⏰ Time', value: meta.time, inline: true },
          { name: '📍 Location', value: meta.location, inline: true }
        )
        .setColor(0x00ff00);

      preset.roles.forEach(role => {
        const list = registrations[role.name].map(u => `<@${u.id}>`).join(', ') || '*nobody*';
        embed.addFields({ name: `${role.name} (${registrations[role.name].length}/${role.max})`, value: list });
      });

      ['Maybe', 'Decline'].forEach(status => {
        if (registrations[status]) {
          const list = registrations[status].map(u => `<@${u.id}>`).join(', ') || '*nobody*';
          embed.addFields({ name: status, value: list });
        }
      });

      await interaction.update({ embeds: [embed] });
    }
  } catch (err) {
    console.error('❌ Interaction handler error:', err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
    }
  }
});

// Auto-archive expired events
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event expired, archiving...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(BOT_TOKEN);
