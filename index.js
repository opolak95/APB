// index.js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const eventPresets = require('./config/events');
const { saveEvent, archiveEvent } = require('./db/database');

const { BOT_TOKEN, CHANNEL_ID, CLIENT_ID } = process.env;
if (!BOT_TOKEN || !CHANNEL_ID || !CLIENT_ID) {
  console.error('❌ Chybí BOT_TOKEN, CHANNEL_ID nebo CLIENT_ID v .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- error handling ---
process.on('unhandledRejection', e => console.error('❌ Unhandled promise rejection:', e));
process.on('uncaughtException', e => console.error('❌ Uncaught exception:', e));

let activeEvent = null;
let expiresAt   = null;

client.once(Events.ClientReady, async () => {
  console.log(`✅ Přihlášen jako ${client.user.tag}`);
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    await ch.send('🤖 Bot je online! Použij `/create` pro nový event.');
  } catch (e) {
    console.error('❌ Nepodařilo se poslat uvítací zprávu:', e);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1) Spuštění slash příkazu /create
    if (interaction.isChatInputCommand() && interaction.commandName === 'create') {
      const type = interaction.options.getString('type');
      if (!eventPresets[type]) {
        return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });
      }

      // Modal pro zadání detailů
      const modal = new ModalBuilder()
        .setCustomId(`modal_event_${type}`)
        .setTitle(`Nový event: ${eventPresets[type].title}`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('date')
            .setLabel('Datum (např. 20. 6. 2025)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('time')
            .setLabel('Čas (např. 20:00)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('location')
            .setLabel('Startovací lokace')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      // **NIKDY NEDEFERUJ** před showModal, jinak Discord považuje interaction za uzavřený
      await interaction.showModal(modal);
      return;
    }

    // 2) Zpracování modalu
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_event_')) {
      const type = interaction.customId.replace('modal_event_', '');
      const preset = eventPresets[type];
      if (!preset) {
        return interaction.reply({ content: '❌ Neplatný typ eventu.', ephemeral: true });
      }

      const date     = interaction.fields.getTextInputValue('date');
      const time     = interaction.fields.getTextInputValue('time');
      const location = interaction.fields.getTextInputValue('location');

      // Uložení do DB i do runtime proměnné
      const ev = {
        type,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
        meta: { date, time, location },
        registrations: {}
      };
      preset.roles.forEach(r => ev.registrations[r.name] = []);
      saveEvent(ev);
      activeEvent = ev;
      expiresAt   = Date.now() + 60 * 60 * 1000; // vyprší za hodinu

      // Sestavení embedu
      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Datum', value: date, inline: true },
          { name: '⏰ Čas',   value: time, inline: true },
          { name: '📍 Lokace', value: location, inline: true }
        )
        .setColor(0x0099ff);

      // Pole tlačítek (max. 5 tlačítek / řádek)
      const rows = [];
      for (let i = 0; i < preset.roles.length; i += 5) {
        const row = new ActionRowBuilder();
        preset.roles.slice(i, i + 5).forEach(r => {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`join_${r.name}`)
              .setLabel(r.name)
              .setStyle(ButtonStyle.Primary)
          );
        });
        rows.push(row);
      }
      // tlačítko Zrušit účast
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('leave')
            .setLabel('🚪 Zrušit účast')
            .setStyle(ButtonStyle.Danger)
        )
      );

      // Odeslání do kanálu
      const ch = await client.channels.fetch(CHANNEL_ID);
      await ch.send({ embeds: [embed], components: rows });

      // Potvrzení autorovi
      await interaction.reply({ content: '✅ Event vytvořen!', ephemeral: true });
      return;
    }

    // 3) Zpracování tlačítek
    if (interaction.isButton()) {
      if (!activeEvent) {
        return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });
      }

      const user = interaction.user;
      const [action, ...rest] = interaction.customId.split('_');
      const roleName = rest.join('_');
      const { preset, registrations, meta } = activeEvent;

      // Odhlásit uživatele z jakékoliv předchozí role
      Object.keys(registrations).forEach(k => {
        registrations[k] = registrations[k].filter(u => u.id !== user.id);
      });

      // Pokud se přihlásí
      if (action === 'join') {
        const role = preset.roles.find(r => r.name === roleName);
        if (!role) {
          return interaction.reply({ content: '❌ Neznámá role.', ephemeral: true });
        }
        if (registrations[roleName].length >= role.max) {
          return interaction.reply({ content: '⚠️ Role je již plná.', ephemeral: true });
        }
        registrations[roleName].push({ id: user.id, name: user.username });
      }
      // leave → jen odhlásí, nic dalšího

      // Přestavíme embed
      const updated = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .addFields(
          { name: '📅 Datum', value: meta.date, inline: true },
          { name: '⏰ Čas',   value: meta.time, inline: true },
          { name: '📍 Lokace', value: meta.location, inline: true }
        )
        .setColor(0x00ff00);

      preset.roles.forEach(r => {
        const list = registrations[r.name].map(u => `<@${u.id}>`).join(', ') || '*nikdo*';
        updated.addFields({ name: `${r.name} (${registrations[r.name].length}/${r.max})`, value: list });
      });

      await interaction.update({ embeds: [updated] });
    }
  } catch (err) {
    console.error('❌ Interaction handler error:', err);
    // pokud to ještě nebylo odpovězeno/acknowledged:
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: '❌ Nastala chyba.', ephemeral: true });
    }
  }
});

// Archivace po vypršení
setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt   = null;
  }
}, 60 * 1000);

client.login(BOT_TOKEN);
