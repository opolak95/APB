// commands.js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('create')
    .setDescription('Vytvoří nový Albion Online event')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Typ eventu')
        .setRequired(true)
        .addChoices(
          { name: 'ZvZ', value: 'zvz' },
          { name: 'Small Scale', value: 'ss' },
          { name: 'Dungeon', value: 'dungeon' },
          { name: 'Faction', value: 'faction' },
          { name: 'Ganking', value: 'ganking' },
          { name: 'Arena', value: 'arena' }
        )
    )
    .toJSON()
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    console.log('⏳ Registruji slash příkazy…');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash příkazy zaregistrovány!');
  } catch (err) {
    console.error('❌ Chyba při registraci slash příkazů:', err);
  }
})();
