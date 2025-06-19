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

// Zachytávání chyb
process.on('unhandledRejection', error => console.error('🔴 Nezachycená chyba (promise):', error));
process.on('uncaughtException', error => console.error('🔴 Nezachycená výjimka:', error));

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send('✅ Jsem online a připraven sloužit Přátelům Hranatého Stolu!');
  } catch (err) {
    console.error('❌ Nepodařilo se odeslat zprávu do kanálu:', err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'create') {
      try {
        await interaction.deferReply({ flags: 64 }); // flags místo deprecated ephemeral

        const type = interaction.options.getString('type');
        const preset = eventPresets[type];
        if (!preset) return interaction.editReply({ content: '❌ Neplatný typ eventu.' });

        const embed = new EmbedBuilder()
          .setTitle(preset.title)
          .setDescription(preset.description)
          .setColor(0x0099ff);

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
        saveEvent(activeEvent);

        // Rozdělení tlačítek na více řádků
        const components = [];
        let row = new ActionRowBuilder();
        let count = 0;
        for (const role of preset.roles) {
          if (count === 5) {
            components.push(row);
            row = new ActionRowBuilder();
            count = 0;
          }
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`role_${role.name}`)
              .setLabel(role.name)
              .setStyle(ButtonStyle.Primary)
          );
          count++;
        }
        if (count > 0) components.push(row); // poslední nedokončený řádek

        // Tlačítko "Zrušit účast"
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('leave_event')
              .setLabel('Zrušit účast')
              .setStyle(ButtonStyle.Danger)
          )
        );

        const channel = await client.channels.fetch(CHANNEL_ID);
        await channel.send({ embeds: [embed], components });
        await interaction.editReply({ content: '✅ Event vytvořen a zveřejněn v kanálu.' });
      } catch (err) {
        console.error('❌ Chyba při vytváření eventu:', err);
        interaction.editReply({ content: '❌ Chyba při vytváření eventu.' });
      }
    }
  }

  if (interaction.isButton()) {
    if (!activeEvent) return interaction.reply({ content: '❌ Žádný aktivní event.', flags: 64 });

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
        if (!removed) return interaction.reply({ content: '❌ Nejsi přihlášen.', flags: 64 });
      } else {
        const alreadyRegistered = Object.values(registrations).some(list =>
          list.find(u => u.id === user.id)
        );
        if (alreadyRegistered) return interaction.reply({ content: '⚠️ Už jsi přihlášen.', flags: 64 });

        const role = preset.roles.find(r => r.name === roleName);
        if (!role) return interaction.reply({ content: '❌ Neplatná role.', flags: 64 });

        if (registrations[roleName].length >= role.max) {
          return interaction.reply({ content: '⚠️ Tato role je plná.', flags: 64 });
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
