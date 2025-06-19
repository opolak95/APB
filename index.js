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
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const eventPresets = require('./config/events');
const { saveEvent, archiveEvent } = require('./db/database');

const CHANNEL_ID = process.env.CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

let activeEvent = null;
let expiresAt = null;

// Globální zachytávání všech chyb
process.on('unhandledRejection', error => {
  console.error('🔴 Nezachycená chyba (promise):', error);
});
process.on('uncaughtException', error => {
  console.error('🔴 Nezachycená výjimka:', error);
});

// 👉 Registrace slash příkazů při spuštění
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('create')
      .setDescription('Vytvoří nový Albion event')
      .addStringOption(option =>
        option.setName('type')
          .setDescription('Typ eventu')
          .setRequired(true)
          .addChoices(
            { name: 'ZvZ', value: 'ZvZ' },
            { name: 'SS', value: 'SS' },
            { name: 'Dungeon', value: 'Dungeon' },
            { name: 'Faction', value: 'Faction' },
            { name: 'Ganking', value: 'Ganking' },
            { name: 'Arena', value: 'Arena' },
            { name: 'Training', value: 'Training' },
            { name: 'HCE', value: 'HCE' },
            { name: 'Gathering', value: 'Gathering' }
          )
      )
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    console.log('🔧 Registruji slash příkazy...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash příkazy zaregistrovány!');
  } catch (error) {
    console.error('❌ Chyba při registraci příkazů:', error);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot přihlášen jako ${client.user.tag}`);

  await registerSlashCommands();

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send('✅ Jsem online a slash příkazy byly zaregistrovány.');
    console.log('📨 Potvrzení odesláno do kanálu.');
  } catch (err) {
    console.error('❌ Nepodařilo se odeslat zprávu do kanálu:', err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  console.log('📩 ZACHYCENÁ INTERAKCE:', {
    type: interaction.type,
    isChatInput: interaction.isChatInputCommand(),
    command: interaction.commandName,
    user: interaction.user?.tag
  });

  if (interaction.isChatInputCommand()) {
    console.log(`📥 Slash příkaz: /${interaction.commandName} od ${interaction.user.tag}`);

    if (interaction.commandName === 'create') {
      await interaction.deferReply({ flags: 64 }); // ephemeral reply (flags method)
      try {
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

        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ Nastala chyba při vytváření eventu.' });
          } else {
            await interaction.reply({ content: '❌ Chyba bez odpovědi.', ephemeral: true });
          }
        } catch (replyError) {
          console.error('❌ Nepodařilo se odpovědět na chybu:', replyError);
        }
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
      console.log(`🔄 Embed aktualizován po akci uživatele ${user.tag}`);
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
