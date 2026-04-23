const { EmbedBuilder } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { formatIDR } = require('../utils/format');
const { BRAND, ICON, DIVIDER } = require('../utils/embeds');

const log = createLogger('panel');
const PANEL_ID = 'stockPanel';
const DEBOUNCE_MS = 1000;
const DEFAULT_REFRESH_MINUTES = 5;

let debounceTimer = null;
let refreshInterval = null;
let clientRef = null;

function registerClient(client) { clientRef = client; }

async function getPanelConfig() {
  return collections.settings().findOne({ _id: PANEL_ID });
}

async function savePanelConfig(partial) {
  await collections.settings().updateOne(
    { _id: PANEL_ID },
    { $set: { ...partial, updatedAt: new Date() } },
    { upsert: true },
  );
}

async function deletePanelConfig() {
  await collections.settings().deleteOne({ _id: PANEL_ID });
}

async function aggregateProducts() {
  return collections.products().aggregate([
    {
      $lookup: {
        from: 'stock',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$productId', '$$pid'] } } },
          {
            $group: {
              _id: null,
              available: { $sum: { $cond: [{ $and: [
                { $eq: ['$sold', false] },
                { $eq: [{ $ifNull: ['$reservedBy', null] }, null] },
              ] }, 1, 0] } },
              reserved: { $sum: { $cond: [{ $and: [
                { $eq: ['$sold', false] },
                { $ne: [{ $ifNull: ['$reservedBy', null] }, null] },
              ] }, 1, 0] } },
              sold: { $sum: { $cond: ['$sold', 1, 0] } },
            },
          },
        ],
        as: 'stats',
      },
    },
    {
      $project: {
        name: 1, description: 1, format: 1, price: 1,
        available: { $ifNull: [{ $first: '$stats.available' }, 0] },
        reserved: { $ifNull: [{ $first: '$stats.reserved' }, 0] },
        sold: { $ifNull: [{ $first: '$stats.sold' }, 0] },
      },
    },
    { $sort: { name: 1 } },
  ]).toArray();
}

function buildPanelEmbed(products, guild) {
  const storeName = guild?.name ?? 'Pixel Shop';
  const updateTs = Math.floor(Date.now() / 1000);

  const totalAvailable = products.reduce((s, p) => s + p.available, 0);
  const totalSold = products.reduce((s, p) => s + p.sold, 0);
  const color =
    products.length === 0 ? BRAND.primary :
    totalAvailable === 0 ? BRAND.danger :
    totalAvailable < products.length * 3 ? BRAND.warning :
    BRAND.pixel;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${storeName}  •  Live Shop`,
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`${ICON.shop}  PIXEL WORLD SHOP  ${ICON.shop}`)
    .setTimestamp();

  if (guild?.iconURL()) embed.setThumbnail(guild.iconURL({ size: 256 }));

  const header = [
    `${ICON.sparkle} _Selamat datang **Player**! Pilih item favoritmu dan klaim sekarang dengan \`/buy\`._ ${ICON.sparkle}`,
    '',
    `${ICON.clock}  **Last Update:** <t:${updateTs}:R>   ${ICON.trophy}  **Total Sold:** \`${totalSold}\``,
    DIVIDER,
    '',
  ].join('\n');

  if (products.length === 0) {
    embed.setDescription(
      header +
      `${ICON.scroll}  _Shop masih kosong. Admin dapat mengisi dengan_ \`/addproduct\``
    );
    embed.setFooter({
      text: `${storeName}  •  Auto-syncing panel`,
      iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
    });
    return embed;
  }

  const blocks = products.map(p => {
    const stockIcon = p.available === 0 ? '🔴' : p.available < 5 ? '🟡' : '🟢';
    const main = [
      `${ICON.product}  **${p.name}**`,
      '',
      `${stockIcon}  **Stock:** \`${p.available}\`${p.reserved > 0 ? `  _(${p.reserved} reserved)_` : ''}`,
      `${ICON.gem}  **Price:** \`${formatIDR(p.price)}\``,
      `${ICON.sword}  **Sold:** \`${p.sold}\``,
    ];
    const extras = [];
    if (p.format) extras.push(`${ICON.key}  **Format:** \`${p.format}\``);
    if (p.description) extras.push(`${ICON.scroll}  **Info:** ${p.description}`);

    return extras.length > 0
      ? [...main, '', ...extras].join('\n')
      : main.join('\n');
  });

  const description = header + blocks.join('\n\n' + DIVIDER + '\n\n');
  embed.setDescription(description.slice(0, 4096));
  embed.setFooter({
    text: `${storeName}  •  ${products.length} items  •  ${ICON.controller} /buy untuk klaim`,
    iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
  });

  return embed;
}

async function postPanel(client, channel) {
  const products = await aggregateProducts();
  const embed = buildPanelEmbed(products, channel.guild);
  const message = await channel.send({ embeds: [embed] });
  await savePanelConfig({
    channelId: channel.id,
    messageId: message.id,
    guildId: channel.guild.id,
  });
  log.info(`panel posted in #${channel.name} (msg=${message.id})`);
  return message;
}

async function updatePanelNow(client = clientRef) {
  if (!client) return;
  const config = await getPanelConfig();
  if (!config) return;

  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(config.messageId);
    const products = await aggregateProducts();
    const embed = buildPanelEmbed(products, channel.guild);
    await message.edit({ embeds: [embed] });
    await savePanelConfig({ channelId: config.channelId, messageId: config.messageId, guildId: config.guildId });
    log.info(`panel updated — ${products.length} product(s) in #${channel.name}`);
  } catch (err) {
    log.warn(`panel update failed: ${err.message}`);
  }
}

function schedulePanelUpdate(client = clientRef) {
  if (!client) return;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    updatePanelNow(client).catch(err => log.error('scheduled update failed:', err));
  }, DEBOUNCE_MS);
}

async function removePanel(client) {
  const config = await getPanelConfig();
  if (!config) return false;
  try {
    const channel = await client.channels.fetch(config.channelId);
    const message = await channel.messages.fetch(config.messageId);
    await message.delete();
  } catch { /* gone */ }
  await deletePanelConfig();
  log.info('panel removed');
  return true;
}

function startRefreshJob(client = clientRef) {
  if (!client) return;
  if (refreshInterval) return;

  const minutes = Number(process.env.PANEL_REFRESH_MINUTES) || DEFAULT_REFRESH_MINUTES;
  const ms = Math.max(1, minutes) * 60_000;

  refreshInterval = setInterval(() => {
    updatePanelNow(client).catch(err => log.warn(`periodic refresh failed: ${err.message}`));
  }, ms);

  log.info(`panel refresh job started (every ${minutes} min)`);
}

function stopRefreshJob() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

module.exports = {
  registerClient, postPanel, updatePanelNow, schedulePanelUpdate, removePanel, getPanelConfig,
  startRefreshJob, stopRefreshJob,
};
