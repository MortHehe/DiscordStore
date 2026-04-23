require('dotenv').config();
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { connectDatabase } = require('./db');
const { createLogger } = require('./utils/logger');
const { registerClient: registerPanelClient } = require('./services/panel');

const log = createLogger('bot');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    log.debug(`loaded command: /${command.data.name}`);
  } else {
    log.warn(`skipped ${file} — missing data or execute`);
  }
}
log.info(`loaded ${client.commands.size} command(s)`);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
  log.debug(`loaded event: ${event.name}${event.once ? ' (once)' : ''}`);
}
log.info(`loaded ${eventFiles.length} event handler(s)`);

client.on('error', (err) => log.error('discord client error:', err));
client.on('warn', (msg) => log.warn('discord:', msg));
client.on('shardError', (err) => log.error('shard error:', err));

(async () => {
  try {
    log.info('connecting to database...');
    await connectDatabase();
    log.info('logging in to Discord...');
    registerPanelClient(client);
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    log.error('startup failed:', err);
    process.exit(1);
  }
})();

async function shutdown(signal) {
  log.warn(`received ${signal}, shutting down...`);
  try {
    const { stopCleanupJob } = require('./services/inventory');
    const { stopRefreshJob } = require('./services/panel');
    const { stopPaymentPoller } = require('./services/paymentPoller');
    const { stopWebhookServer } = require('./services/webhookServer');
    stopCleanupJob();
    stopRefreshJob();
    stopPaymentPoller();
    stopWebhookServer();
    await client.destroy();
    const { closeDatabase } = require('./db');
    await closeDatabase();
  } catch (err) {
    log.error('shutdown error:', err);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
