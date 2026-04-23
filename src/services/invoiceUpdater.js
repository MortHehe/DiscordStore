const { WebhookClient } = require('discord.js');
const { formatIDR } = require('../utils/format');
const { BRAND, ICON, DIVIDER, brandEmbed } = require('../utils/embeds');
const { createLogger } = require('../utils/logger');

const log = createLogger('invoice');

async function editInvoice(client, order, embed) {
  if (!order?.invoiceInteractionToken) return { skipped: true };
  try {
    const webhook = new WebhookClient({
      id: client.user.id,
      token: order.invoiceInteractionToken,
    });
    await webhook.editMessage('@original', { embeds: [embed] });
    log.info(`invoice updated for order ${order._id}`);
    return { edited: true };
  } catch (err) {
    log.warn(`edit invoice ${order._id} failed: ${err.message}`);
    return { failed: true, error: err.message };
  }
}

function buildSuccessEmbed(product, order) {
  return brandEmbed(null, { color: BRAND.success, thumbnail: false })
    .setTitle(`${ICON.trophy}  PAYMENT SUCCESS`)
    .setDescription([
      `${ICON.sparkle}  Pembayaran kamu sudah **terkonfirmasi**!`,
      '',
      `Item sudah dikirim ke **DM kamu** — silakan cek inbox Discord.`,
      DIVIDER,
    ].join('\n'))
    .addFields(
      { name: `${ICON.product}  Item`, value: `**${product.name}**`, inline: false },
      { name: `${ICON.target}  Jumlah`, value: `\`${order.quantity ?? 1}\``, inline: true },
      { name: `${ICON.crystal}  Total`, value: formatIDR(order.price), inline: true },
      { name: `${ICON.scroll}  Order ID`, value: `\`${order._id}\``, inline: false },
    )
    .setFooter({ text: 'Thanks for shopping! 🎮' })
    .setTimestamp();
}

function buildExpiredEmbed(order) {
  return brandEmbed(null, { color: BRAND.danger, thumbnail: false })
    .setTitle(`${ICON.boom}  ORDER EXPIRED`)
    .setDescription([
      `Order ini **expired** karena payment tidak masuk dalam waktu yang ditentukan.`,
      '',
      `_Stock sudah dikembalikan ke shop. Silakan \`/buy\` lagi kalau masih ingin beli._`,
    ].join('\n'))
    .addFields(
      { name: `${ICON.scroll}  Order ID`, value: `\`${order._id}\``, inline: false },
    )
    .setTimestamp();
}

function buildCancelledEmbed(order, reason = 'dibatalkan') {
  return brandEmbed(null, { color: BRAND.danger, thumbnail: false })
    .setTitle(`${ICON.shield}  ORDER CANCELLED`)
    .setDescription([
      `Order ini sudah **${reason}**.`,
      '',
      `_Stock sudah dikembalikan ke shop._`,
    ].join('\n'))
    .addFields(
      { name: `${ICON.scroll}  Order ID`, value: `\`${order._id}\``, inline: false },
    )
    .setTimestamp();
}

async function markPaymentSuccess(client, order, product) {
  return editInvoice(client, order, buildSuccessEmbed(product, order));
}

async function markPaymentExpired(client, order) {
  return editInvoice(client, order, buildExpiredEmbed(order));
}

async function markPaymentCancelled(client, order, reason) {
  return editInvoice(client, order, buildCancelledEmbed(order, reason));
}

module.exports = { markPaymentSuccess, markPaymentExpired, markPaymentCancelled };
