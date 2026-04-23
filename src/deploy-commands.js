require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./utils/logger');

const log = createLogger('deploy');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    log.debug(`queued /${command.data.name}`);
  }
}

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  log.error('missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);
    log.info(`registering ${commands.length} command(s) ${GUILD_ID ? `to guild ${GUILD_ID}` : 'globally'}...`);
    const data = await rest.put(route, { body: commands });
    log.info(`registered ${data.length} command(s) successfully`);
  } catch (err) {
    log.error('deploy failed:', err);
    process.exit(1);
  }
})();
