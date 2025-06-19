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

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

// Channel where events will be posted (ID from .env)
const CHANNEL_ID = process.env.CHANNEL_ID;

// State for the currently active event and its expiration
let activeEvent = null;
let expiresAt = null;

// Global error handling to avoid crashes
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

// On bot ready, notify and confirm
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send('✅ Bot je online a připraven k použití příkazu `/create`.');
  } catch (err) {
    console.error('❌ Nepodařilo se odeslat úvodní zprávu:', err);
  }
});

// Handle interactions: slash commands, modal submissions, buttons
client.on(Events.InteractionCreate, async interaction => {
  // 1) Slash command: /create
  if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
    try {
      // Build a modal to collect event details
      const modal = new ModalBuilder()
        .setCustomId('event_details')
        .setTitle('Nový Albion Event');

      // Input for event type (must match keys in eventPresets)
      const typeInput = new TextInputBuilder()
        .setCustomId('event_type')
        .setLabel('Typ eventu (např. zvz, ss, dungeon)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      // Input for date
      const dateInput = new TextInputBuilder()
        .setCustomId('event_date')
        .setLabel('Datum (např. 20. 6. 2025)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      // Input for time
      const timeInput = new TextInputBuilder()
        .setCustomId('event_time')
        .setLabel('Čas (např. 20:00)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      // Input for location
      const locationInput = new TextInputBuilder()
        .setCustomId('event_location')
        .setLabel('Startovací lokace')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      // Assemble modal components into action rows
      modal.addComponents(
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(timeInput),
        new ActionRowBuilder().addComponents(locationInput)
      );

      // Show modal (single response; do not call deferReply or reply)
      await interaction.showModal(modal);
    } catch (err) {
      console.error('❌ Chyba při zobrazování modalu:', err);
      // Inform user of failure
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Nepodařilo se otevřít modal.', ephemeral: true });
      }
    }
  }

  // 2) Modal submission: event_details
  if (interaction.isModalSubmit() && interaction.customId === 'event_details') {
    try {
      const type = interaction.fields.getTextInputValue('event_type').toLowerCase();
      const date = interaction.fields.getTextInputValue('event_date');
      const time = interaction.fields.getTextInputValue('event_time');
      const location = interaction.fields.getTextInputValue('event_location');

      // Validate preset
      const preset = eventPresets[type];
      if (!preset) {
        return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });
      }

      // Build the embed with header info
      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Datum', value: date, inline: true },
          { name: '⏰ Čas', value: time, inline: true },
          { name: '📍 Lokace', value: location, inline: true }
        )
        .setColor(0x0099ff);

      // Initialize registrations state
      const registrations = {};
      preset.roles.forEach(role => registrations[role.name] = []);

      // Add role fields initial state
      preset.roles.forEach(role => {
        embed.addFields({
          name: `${role.name} (0/${role.max})`,
          value: '*nikdo*',
          inline: true
        });
      });

      // Save active event state
      activeEvent = { preset, registrations, meta: { date, time, location } };
      expiresAt = Date.now() + 60 * 60 * 1000;

      // Build role buttons (up to 5 per row)
      const roleRow = new ActionRowBuilder();
      preset.roles.slice(0, 5).forEach(role => {
        roleRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`join_${role.name}`)
            .setLabel(role.name)
            .setStyle(ButtonStyle.Primary)
        );
      });

      // Build status buttons
      const statusRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('maybe')
            .setLabel('⚪ Možná')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('decline')
            .setLabel('❌ Nezúčastním se')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('leave')
            .setLabel('Zrušit účast')
            .setStyle(ButtonStyle.Danger)
        );

      // Send embed to channel
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [embed], components: [roleRow, statusRow] });

      // Acknowledge modal submit
      await interaction.reply({ content: '✅ Event vytvořen!', ephemeral: true });
    } catch (err) {
      console.error('❌ Chyba při zpracování modalu:', err);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Došlo k chybě.', ephemeral: true });
      }
    }
  }

  // 3) Button interactions
  if (interaction.isButton()) {
    try {
      if (!activeEvent) {
        return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });
      }
      const user = interaction.user;
      const action = interaction.customId;
      const { preset, registrations, meta } = activeEvent;

      // Remove user from all roles/statuses
      Object.keys(registrations).forEach(key => {
        registrations[key] = registrations[key].filter(u => u.id !== user.id);
      });

      // Handle join_<role>
      if (action.startsWith('join_')) {
        const roleName = action.replace('join_', '');
        const role = preset.roles.find(r => r.name === roleName);
        if (registrations[roleName].length >= role.max) {
          return interaction.reply({ content: '⚠️ Role je plná.', ephemeral: true });
        }
        registrations[roleName].push({ id: user.id, name: user.username });
      } else if (action === 'maybe') {
        registrations['Možná'] = registrations['Možná'] || [];
        registrations['Možná'].push({ id: user.id, name: user.username });
      } else if (action === 'decline') {
        registrations['Nezúčastním se'] = registrations['Nezúčastním se'] || [];
        registrations['Nezúčastním se'].push({ id: user.id, name: user.username });
      } // leave simply removes

      // Rebuild embed
      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Datum', value: meta.date, inline: true },
          { name: '⏰ Čas', value: meta.time, inline: true },
          { name: '📍 Lokace', value: meta.location, inline: true }
        )
        .setColor(0x00ff00);

      // Add roles
      preset.roles.forEach(role => {
        const users = registrations[role.name].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
        embed.addFields({ name: `${role.name} (${registrations[role.name].length}/${role.max})`, value: users });
      });

      // Add statuses
      ['Možná', 'Nezúčastním se'].forEach(status => {
        if (registrations[status]) {
          const list = registrations[status].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
          embed.addFields({ name: status, value: list });
        }
      });

      // Update message
      await interaction.update({ embeds: [embed] });
    } catch (err) {
      console.error('❌ Chyba při zpracování tlačítka:', err);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Chyba při akci.', ephemeral: true });
      }
    }
  }
});

// Auto-archive event after expiration
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event vypršel, archivace...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(process.env.BOT_TOKEN);
