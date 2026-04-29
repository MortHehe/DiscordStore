const { EmbedBuilder } = require('discord.js');
const { getDb, collections } = require('../db');
const { BRAND } = require('../utils/embeds');
const { createLogger } = require('../utils/logger');

const log = createLogger('statusPanel');
const STATUS_PANEL_ID = 'statusPanel';
const REFRESH_MS = 30_000;

let intervalId = null;
let clientRef = null;
let lastApiPing = -1;

function latencyIcon(ms) {
  if (ms < 0) return '❌';
  if (ms < 100) return '🟢';
  if (ms < 300) return '🟡';
  return '🔴';
}

async function buildStatusEmbed(client) {
  const wsPing = Math.max(0, client.ws.ping);

  let dbPing = -1;
  let dbStatus = '❌ Error';
  try {
    const start = Date.now();
    await getDb().admin().ping();
    dbPing = Date.now() - start;
    dbStatus = '✅ Connected';
  } catch (err) {
    dbStatus = `❌ ${err.message.slice(0, 40)}`;
  }

  const wsBad = wsPing > 500;
  const dbBad = dbPing < 0 || dbPing > 500;
  const apiBad = lastApiPing > 500;
  const wsWarn = wsPing > 200;
  const dbWarn = dbPing > 0 && dbPing > 300;
  const apiWarn = lastApiPing > 0 && lastApiPing > 300;

  const color = (wsBad || dbBad || apiBad) ? BRAND.danger
              : (wsWarn || dbWarn || apiWarn) ? BRAND.warning
              : BRAND.success;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${client.guilds.cache.first()?.name ?? 'Pixel Shop'}  •  Live Status`,
      iconURL: client.guilds.cache.first()?.iconURL({ size: 64 }) ?? undefined,
    })
    .setTitle(`🤖  Bot Status`)
    .addFields(
      {
        name: '⚡  Latency',
        value: [
          `${latencyIcon(wsPing)} Discord WS — \`${wsPing}ms\``,
          `${latencyIcon(lastApiPing)} Discord API — \`${lastApiPing < 0 ? 'measuring...' : lastApiPing + 'ms'}\``,
          `${latencyIcon(dbPing)} MongoDB — \`${dbPing < 0 ? 'n/a' : dbPing + 'ms'}\``,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛡️  Services',
        value: `🗄️ Database — ${dbStatus}`,
        inline: false,
      },
    )
    .setFooter({ text: `Auto-refresh tiap 30s` })
    .setTimestamp();

  return embed;
}

async function getStatusConfig() {
  return collections.settings().findOne({ _id: STATUS_PANEL_ID });
}

async function postStatusPanel(client, channel) {
  const embed = await buildStatusEmbed(client);
  const start = Date.now();
  const message = await channel.send({ embeds: [embed] });
  lastApiPing = Date.now() - start;

  await collections.settings().updateOne(
    { _id: STATUS_PANEL_ID },
    {
      $set: {
        channelId: channel.id,
        messageId: message.id,
        guildId: channel.guild.id,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  log.info(`status panel posted in #${channel.name} (msg=${message.id})`);
  return message;
}

async function updateStatusPanel(client = clientRef) {
  if (!client) return;
  const config = await getStatusConfig();
  if (!config) return;

  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(config.messageId);
    const embed = await buildStatusEmbed(client);

    const start = Date.now();
    await message.edit({ embeds: [embed] });
    lastApiPing = Date.now() - start;
  } catch (err) {
    log.warn(`status panel update failed: ${err.message}`);
  }
}

function startStatusUpdater(client) {
  clientRef = client;
  if (intervalId) return;
  intervalId = setInterval(() => {
    updateStatusPanel(client).catch(() => {});
  }, REFRESH_MS);
  log.info(`status panel updater started (every ${REFRESH_MS / 1000}s)`);
}

function stopStatusUpdater() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function removeStatusPanel(client) {
  const config = await getStatusConfig();
  if (!config) return false;
  try {
    const channel = await client.channels.fetch(config.channelId);
    const message = await channel.messages.fetch(config.messageId);
    await message.delete();
  } catch { /* gone */ }
  await collections.settings().deleteOne({ _id: STATUS_PANEL_ID });
  log.info('status panel removed');
  return true;
}

module.exports = {
  postStatusPanel,
  updateStatusPanel,
  startStatusUpdater,
  stopStatusUpdater,
  removeStatusPanel,
  getStatusConfig,
};
