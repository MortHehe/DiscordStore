const { EmbedBuilder } = require('discord.js');
const { formatIDR } = require('../utils/format');
const { BRAND, ICON, DIVIDER } = require('../utils/embeds');
const { createLogger } = require('../utils/logger');

const log = createLogger('sale-log');

function buildAdminSaleEmbed({ order, product, user, type = 'sale' }) {
  const isGift = type === 'gift';
  const ts = Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setColor(isGift ? BRAND.accent : BRAND.success)
    .setAuthor({
      name: isGift ? 'Admin Gift' : 'New Sale',
      iconURL: user.displayAvatarURL({ size: 64 }),
    })
    .setTitle(isGift ? `${ICON.gift}  GIFT DELIVERED` : `${ICON.sword}  NEW SALE`)
    .setDescription(DIVIDER)
    .addFields(
      { name: `${ICON.player}  Player`, value: `${user.tag}\n<@${user.id}>  \`${user.id}\``, inline: false },
      { name: `${ICON.product}  Item`, value: `**${product.name}**`, inline: true },
      { name: `${ICON.target}  Quantity`, value: `\`${order.quantity ?? 1}\``, inline: true },
      { name: `${ICON.crystal}  Total`, value: isGift ? '_(gift)_' : `**${formatIDR(order.price)}**`, inline: true },
      { name: `${ICON.scroll}  Order ID`, value: `\`${order._id}\``, inline: false },
      { name: `${ICON.clock}  Time`, value: `<t:${ts}:F>  (<t:${ts}:R>)`, inline: false },
    );

  if (order.paymentRef) {
    embed.addFields({ name: `${ICON.lightning}  Payment Ref`, value: `\`${order.paymentRef}\``, inline: false });
  }

  if (isGift && order.giftedBy) {
    embed.addFields({ name: `${ICON.shield}  Gifted By`, value: `<@${order.giftedBy}>`, inline: true });
  }

  if (isGift && order.giftReason) {
    embed.addFields({ name: `${ICON.scroll}  Reason`, value: order.giftReason, inline: false });
  }

  embed.setTimestamp();
  return embed;
}

function buildPublicSaleEmbed({ order, product, user, guild }) {
  const ts = Math.floor(Date.now() / 1000);
  const qty = order.quantity ?? 1;

  return new EmbedBuilder()
    .setColor(BRAND.gold)
    .setAuthor({
      name: `${guild?.name ?? 'Pixel Shop'}  •  Live Sales`,
      iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
    })
    .setTitle(`${ICON.sparkle}  NEW PURCHASE  ${ICON.sparkle}`)
    .setDescription([
      DIVIDER,
      `${ICON.product}  **${product.name}**  × \`${qty}\``,
      `${ICON.gem}  **${formatIDR(order.price)}**`,
      `${ICON.player}  by <@${user.id}>  \`${user.id}\``,
      `${ICON.scroll}  Order ID: \`${order._id}\``,
      `${ICON.clock}  <t:${ts}:R>`,
      DIVIDER,
    ].join('\n'))
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setFooter({
      text: `Thanks! Gabung antrean berikutnya dengan /buy ${ICON.controller}`,
      iconURL: guild?.iconURL({ size: 32 }) ?? undefined,
    })
    .setTimestamp();
}

async function postToChannel(client, channelId, payload, label) {
  if (!channelId || channelId.startsWith('paste_') || channelId.startsWith('channel_')) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send(payload);
    log.debug(`posted ${label} log`);
  } catch (err) {
    log.warn(`${label} post failed: ${err.message}`);
  }
}

async function logSale(client, { order, product, user, type = 'sale', guild = null }) {
  const adminChannelId = process.env.SALE_LOG_CHANNEL_ID;
  const publicChannelId = process.env.PUBLIC_SALE_LOG_CHANNEL_ID;
  const logGiftsPublic = (process.env.PUBLIC_LOG_SHOW_GIFTS || 'false').toLowerCase() === 'true';

  const effectiveGuild = guild ?? client.guilds.cache.first() ?? null;
  const isGift = type === 'gift';

  await Promise.all([
    postToChannel(
      client,
      adminChannelId,
      { embeds: [buildAdminSaleEmbed({ order, product, user, type })] },
      `admin ${type}`,
    ),
    (!isGift || logGiftsPublic)
      ? postToChannel(
          client,
          publicChannelId,
          { embeds: [buildPublicSaleEmbed({ order, product, user, guild: effectiveGuild })] },
          `public ${type}`,
        )
      : Promise.resolve(),
  ]);
}

module.exports = { logSale };
