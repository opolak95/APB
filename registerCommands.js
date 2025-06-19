require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

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
          { name: 'Small Scale', value: 'SS' },
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

(async () => {
  try {
    console.log('⏳ Registruji slash příkazy...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash příkazy zaregistrovány!');
  } catch (error) {
    console.error('❌ Chyba při registraci:', error);
  }
})();
