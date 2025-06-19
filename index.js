require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
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

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    console.log(`📥 Slash příkaz: /${interaction.commandName} od ${interaction.user.tag}`);

    if (interaction.commandName === 'create') {
      try {
        await interaction.deferReply({ ephemeral: true });

        const type = interaction.options.getString('type');
        console.log(`📦 Zvolený typ eventu: ${type}`);
        const preset = eventPresets[type];

        if (!preset) {
          console.warn(`❌ Neplatný typ eventu: ${type}`);
          return interaction.editReply({ content: '❌ Neplatný typ eventu.' });
        }

        const embed = new EmbedBuilder()
          .setTitle(preset.title)
          .setDescription(preset.description)
          .setColor(0x0099ff);

        const rows = [];
        const registrations = {};
        preset.roles.forEach(role => {
          registrations[role.name] = [];
        });

        activeEvent = {
          preset,
          registrations,
          createdAt: Date.now(),
          createdBy: interaction.user.id,
          type
        };
        expiresAt = Date.now() + 60 * 60 * 1000;

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
        rows.push(row);

        saveEvent(activeEvent);
        console.log('💾 Event uložen do DB.');

        const channel = await client.channels.fetch(CHANNEL_ID);
        await channel.send({ embeds: [embed], components: rows });

        console.log(`📨 Embed odeslán do kanálu ${CHANNEL_ID}`);
        await interaction.editReply({ content: '✅ Event vytvořen a zveřejněn v kanálu.' });
      } catch (error) {
        console.error('❗ Chyba při vytváření eventu:', error);
        interaction.editReply({ content: '❌ Nastala chyba při vytváření eventu.' });
      }
    }
  }

  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: '❌ Žádný aktivní event.', ephemeral: true });

    try {
      const user = interaction.user;
      const roleName = interaction.customId.replace('role_', '');
      const { registrations, preset } = activeEvent;

      console.log(`👤 ${user.tag} klikl na tlačítko: ${interaction.customId}`);

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
      console.log(`🔄 Embed aktualizován po ak
