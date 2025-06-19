require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const eventPresets = require('./config/events');
const { saveEvent, archiveEvent } = require('./db/database');

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
    if (interaction.commandName === 'create') {
      const type = interaction.options.getString('type');
      const preset = eventPresets[type];
      if (!preset) return interaction.reply({ content: 'Neplatný typ eventu.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(preset.title)
        .setDescription(preset.description)
        .setColor(0x0099ff);

      const rows = [];
      const registrations = {};
      preset.roles.forEach(role => {
        registrations[role.name] = [];
      });
      activeEvent = { preset, registrations, createdAt: Date.now(), createdBy: interaction.user.id, type };
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
      await interaction.reply({ embeds: [embed], components: rows });
    }
  }

  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: 'Žádný aktivní event.', ephemeral: true });

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
      if (!removed) return interaction.reply({ content: 'Nejsi přihlášen.', ephemeral: true });
    } else {
      const alreadyRegistered = Object.values(registrations).some(list => list.find(u => u.id === user.id));
      if (alreadyRegistered) return interaction.reply({ content: 'Už jsi se přihlásil.', ephemeral: true });

      if (registrations[roleName].length >= preset.roles.find(r => r.name === roleName).max) {
        return interaction.reply({ content: 'Tato role je již plná.', ephemeral: true });
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

setInterval(async () => {
  if (activeEvent && Date.now() > expiresAt) {
    console.log('⌛ Event vypršel, archivace...');
    await archiveEvent(activeEvent);
    activeEvent = null;
    expiresAt = null;
  }
}, 60000);

client.login(process.env.BOT_TOKEN);
