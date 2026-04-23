const { AttachmentBuilder } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { formatIDR } = require('../utils/format');
const { BRAND, ICON, DIVIDER, brandEmbed } = require('../utils/embeds');
const { assignRoleAcrossGuilds } = require('../utils/roles');
const { releaseReservation } = require('./inventory');
const { markPaymentSuccess, markPaymentCancelled } = require('./invoiceUpdater');
const { logSale } = require('./saleLogger');

const log = createLogger('delivery');

class DeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function orderStockIds(order) {
  if (Array.isArray(order.stockIds)) return order.stockIds;
  if (order.stockId) return [order.stockId];
  return [];
}

function buildDeliveryPayload(product, order, stocks, guild = null) {
  const qty = stocks.length;
  const fileName = `order-${order._id}.txt`;
  const body = stocks.map(s => s.content).join('\n');
  const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: fileName });

  const embed = brandEmbed(guild, { color: BRAND.gold, thumbnail: !!guild })
    .setAuthor({
      name: `${guild?.name ?? 'Pixel Shop'}  •  Loot Delivery`,
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`${ICON.party}  RARE ITEM DROPPED!  ${ICON.gift}`)
    .setDescription([
      `${ICON.trophy}  **Congratulations Player!**`,
      `Item dari **${guild?.name ?? 'Pixel Shop'}** telah masuk ke inventory kamu!`,
      DIVIDER,
    ].join('\n'))
    .addFields(
      { name: `${ICON.product}  Item`, value: `**${product.name}**`, inline: false },
      { name: `${ICON.target}  Jumlah`, value: `\`${qty}\``, inline: true },
      { name: `${ICON.crystal}  Total Paid`, value: `**${formatIDR(order.price)}**`, inline: true },
      { name: `${ICON.scroll}  Order ID`, value: `\`${order._id}\``, inline: false },
    );

  if (product.format) {
    embed.addFields({
      name: `${ICON.key}  Format Item`,
      value: `\`${product.format}\``,
      inline: false,
    });
  }

  embed.addFields({
    name: `${ICON.gift}  File Pesanan`,
    value: `📎  Download **\`${fileName}\`** yang terlampir di pesan ini.`,
    inline: false,
  });

  embed.setFooter({
    text: `${ICON.shield} Simpan baik-baik — data tidak dikirim ulang otomatis. Hubungi admin jika butuh bantuan.`,
  });

  return { embeds: [embed], files: [file] };
}

function pickGuild(client) {
  return client.guilds.cache.first() ?? null;
}

async function deliverOrder(client, orderId, { paymentRef = null } = {}) {
  const order = await collections.orders().findOne({ _id: orderId });
  if (!order) throw new DeliveryError('NOT_FOUND', 'Order tidak ditemukan');
  if (order.status === 'completed') throw new DeliveryError('ALREADY_DELIVERED', 'Order sudah dikirim sebelumnya');
  if (order.status === 'cancelled') throw new DeliveryError('CANCELLED', 'Order sudah dibatalkan');

  const stockIds = orderStockIds(order);
  if (stockIds.length === 0) throw new DeliveryError('NO_STOCK', 'Order tidak memiliki stock items');

  const stocks = await collections.stock().find({ _id: { $in: stockIds } }).toArray();
  if (stocks.length !== stockIds.length) throw new DeliveryError('NO_STOCK', 'Beberapa stock items hilang');
  const alreadySold = stocks.filter(s => s.sold);
  if (alreadySold.length > 0) throw new DeliveryError('STOCK_SOLD', `${alreadySold.length} item sudah terjual ke order lain`);

  const product = await collections.products().findOne({ _id: order.productId });
  if (!product) throw new DeliveryError('NO_PRODUCT', 'Produk tidak ditemukan');

  let user;
  try {
    user = await client.users.fetch(order.userId);
  } catch (err) {
    throw new DeliveryError('USER_FETCH_FAILED', `Gagal fetch user: ${err.message}`);
  }

  const payload = buildDeliveryPayload(product, order, stocks, pickGuild(client));
  try {
    await user.send(payload);
  } catch (err) {
    log.warn(`DM to ${user.tag} (${user.id}) failed: ${err.message}`);
    throw new DeliveryError('DM_FAILED', `Tidak bisa DM buyer (${err.message}). Minta buyer buka DM lalu /resend.`);
  }

  const now = new Date();
  const stockUpdate = await collections.stock().updateMany(
    { _id: { $in: stockIds }, sold: false },
    {
      $set: { sold: true, soldAt: now, soldToOrder: order._id },
      $unset: { reservedBy: '', reservedAt: '', reservationOrderId: '' },
    },
  );

  if (stockUpdate.modifiedCount !== stockIds.length) {
    log.error(`CRITICAL: DM sent but only ${stockUpdate.modifiedCount}/${stockIds.length} stock marked sold for order ${orderId}`);
    throw new DeliveryError('RACE_CONDITION', 'Sebagian stock terjual saat pengiriman — cek log');
  }

  await collections.orders().updateOne(
    { _id: order._id, status: 'pending' },
    {
      $set: {
        status: 'completed',
        paymentRef: paymentRef || order.paymentRef || null,
        completedAt: now,
        dmSent: true,
      },
    },
  );

  log.info(`delivered order ${orderId} to ${user.tag} — ${stockIds.length}× ${product.name}, total ${formatIDR(order.price)}`);

  const saleType = order.giftedBy ? 'gift' : 'sale';
  logSale(client, { order, product, user, type: saleType }).catch(() => {});

  markPaymentSuccess(client, order, product).catch(() => {});

  const buyerRoleId = process.env.BUYER_ROLE_ID;
  if (buyerRoleId) {
    assignRoleAcrossGuilds(client, order.userId, buyerRoleId, `buyer — order ${order._id}`)
      .catch(err => log.warn(`buyer role assign failed: ${err.message}`));
  }

  return { order, product, stocks, user };
}

async function resendOrder(client, orderId) {
  const order = await collections.orders().findOne({ _id: orderId });
  if (!order) throw new DeliveryError('NOT_FOUND', 'Order tidak ditemukan');
  if (order.status !== 'completed') throw new DeliveryError('NOT_COMPLETED', 'Order belum completed — gunakan /confirm dulu');

  const stockIds = orderStockIds(order);
  const stocks = await collections.stock().find({ _id: { $in: stockIds } }).toArray();
  const product = await collections.products().findOne({ _id: order.productId });
  if (!product || stocks.length === 0) throw new DeliveryError('DATA_GONE', 'Data stock atau produk hilang');

  const user = await client.users.fetch(order.userId);
  await user.send(buildDeliveryPayload(product, order, stocks, pickGuild(client)));

  log.info(`resent order ${orderId} to ${user.tag}`);
  return { order, product, user };
}

async function cancelOrder(orderId, reason = 'cancelled by admin') {
  const order = await collections.orders().findOne({ _id: orderId });
  if (!order) throw new DeliveryError('NOT_FOUND', 'Order tidak ditemukan');
  if (order.status !== 'pending') throw new DeliveryError('NOT_PENDING', `Order status=${order.status}, hanya pending yang bisa dibatalkan`);

  const released = await releaseReservation(orderId);

  await collections.orders().updateOne(
    { _id: order._id, status: 'pending' },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } },
  );

  log.info(`cancelled order ${orderId} (reason: ${reason}, released ${released} stock items)`);
  return { order };
}

async function markCancelledInvoice(client, orderId, reason) {
  const order = await collections.orders().findOne({ _id: orderId });
  if (order?.invoiceInteractionToken) {
    await markPaymentCancelled(client, order, reason);
  }
}

module.exports = { deliverOrder, resendOrder, cancelOrder, markCancelledInvoice, DeliveryError };
