const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ObjectId } = require('mongodb');
const { collections } = require('../db');
const { formatIDR } = require('../utils/format');
const { createPayment } = require('../payments');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { reserveStock, RESERVATION_TTL_MS } = require('../services/inventory');
const { getMaintenanceStatus } = require('../services/maintenance');
const { removeAllDuplicates } = require('../services/stockDedupe');
const { BRAND, ICON, DIVIDER, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:buy');
const MAX_QUANTITY = 50;
const COOLDOWN_MS = 5 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Klaim item dari Pixel World Shop')
    .addStringOption(opt =>
      opt.setName('product').setDescription('Nama produk').setRequired(true).setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('quantity')
         .setDescription(`Jumlah pembelian (default 1, max ${MAX_QUANTITY})`)
         .setMinValue(1).setMaxValue(MAX_QUANTITY).setRequired(false)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const name = interaction.options.getString('product');
    const quantity = interaction.options.getInteger('quantity') ?? 1;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);

    if (!isAdmin) {
      const recentPending = await collections.orders().findOne(
        {
          userId: interaction.user.id,
          status: 'pending',
          giftedBy: { $exists: false },
        },
        { sort: { createdAt: -1 } },
      );

      if (recentPending) {
        const createdAt = new Date(recentPending.createdAt).getTime();
        const elapsed = Date.now() - createdAt;
        if (elapsed < COOLDOWN_MS) {
          const cooldownEndsUnix = Math.floor((createdAt + COOLDOWN_MS) / 1000);
          const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
            .setTitle(`${ICON.clock}  Transaksi Sedang Berjalan`)
            .setDescription(
              `Kamu masih punya order **pending**. Selesaikan dulu atau tunggu cooldown selesai.`,
            )
            .addFields(
              { name: `${ICON.scroll}  Order Aktif`, value: `\`${recentPending._id}\``, inline: false },
              { name: `${ICON.target}  Cooldown Berakhir`, value: `<t:${cooldownEndsUnix}:R>`, inline: true },
              { name: `${ICON.lightning}  Aksi`, value: 'Selesaikan payment, atau tunggu auto-cancel', inline: true },
            )
            .setFooter(guildFooter(interaction.guild, 'Cooldown 5 menit per transaksi'));
          return interaction.editReply({ embeds: [embed] });
        }
      }
    }

    if (!isAdmin) {
      const maint = await getMaintenanceStatus();
      if (maint.enabled) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`🛠️  SHOP MAINTENANCE`)
          .setDescription([
            `Shop sedang **maintenance** saat ini. /buy tidak tersedia sementara.`,
            '',
            `**Alasan:** ${maint.reason || '_(tidak disebutkan)_'}`,
            '',
            `_Silakan coba lagi nanti._`,
          ].join('\n'))
          .setFooter(guildFooter(interaction.guild, 'Maintenance'));
        return interaction.editReply({ embeds: [embed] });
      }
    }

    const product = await collections.products().findOne({ name });
    if (!product) {
      const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
        .setTitle(`${ICON.boom}  Item Tidak Ditemukan`)
        .setDescription(`Item \`${name}\` tidak ada di shop.`);
      return interaction.editReply({ embeds: [embed] });
    }

    if (product.maxPerOrder && product.maxPerOrder > 0 && !isAdmin) {
      if (quantity > product.maxPerOrder) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`${ICON.fire}  Lewat Limit per Transaksi`)
          .setDescription(
            `Item **${product.name}** punya limit **${product.maxPerOrder}** per /buy.\n\n` +
            `Kamu bisa /buy lagi setelah selesai transaksi ini.`,
          )
          .addFields(
            { name: `${ICON.target}  Max per /buy`, value: `\`${product.maxPerOrder}\``, inline: true },
            { name: `${ICON.lightning}  Diminta`, value: `\`${quantity}\``, inline: true },
          )
          .setFooter(guildFooter(interaction.guild, `Coba dengan max ${product.maxPerOrder}`));
        return interaction.editReply({ embeds: [embed] });
      }
    }

    const totalPrice = product.price * quantity;
    const orderId = new ObjectId();

    const preCheck = await removeAllDuplicates(product._id);
    if (preCheck.deletedCount > 0) {
      log.warn(`pre-buy dedupe purged ${preCheck.deletedCount} items for product ${product.name}`);
    }

    const reserveResult = await reserveStock({
      productId: product._id,
      userId: interaction.user.id,
      orderId,
      quantity,
    });

    if (!reserveResult.success) {
      if (reserveResult.reason === 'INSUFFICIENT_STOCK') {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`${ICON.fire}  Stock Tidak Cukup`)
          .setDescription(`Item **${name}** tidak cukup untuk permintaanmu.`)
          .addFields(
            { name: `${ICON.product}  Tersedia`, value: `\`${reserveResult.available}\``, inline: true },
            { name: `${ICON.target}  Diminta`, value: `\`${reserveResult.requested}\``, inline: true },
          )
          .setFooter(guildFooter(interaction.guild, 'Coba dengan jumlah lebih kecil'));
        return interaction.editReply({ embeds: [embed] });
      }

      log.warn(`reserve RACE_EXHAUSTED for ${interaction.user.tag} (${reserveResult.detail})`);
      const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
        .setTitle(`${ICON.lightning}  Shop Lagi Ramai`)
        .setDescription(
          `Player lain sedang akses stock yang sama. Sistem sudah coba **${reserveResult.attempts}x** tapi gagal.\n\n_Coba lagi dalam beberapa detik._`,
        );
      return interaction.editReply({ embeds: [embed] });
    }

    await collections.orders().insertOne({
      _id: orderId,
      userId: interaction.user.id,
      productId: product._id,
      stockIds: reserveResult.stockIds,
      quantity,
      unitPrice: product.price,
      price: totalPrice,
      status: 'pending',
      createdAt: new Date(),
      reservationExpiresAt: reserveResult.expiresAt,
      invoiceInteractionToken: interaction.token,
    });

    const payment = await createPayment({ orderId, amount: totalPrice, userId: interaction.user.id });
    await collections.orders().updateOne({ _id: orderId }, { $set: { paymentRef: payment.ref } });

    const expiresUnix = Math.floor(reserveResult.expiresAt.getTime() / 1000);
    const ttlMinutes = Math.floor(RESERVATION_TTL_MS / 60_000);

    const embed = brandEmbed(interaction.guild, { color: BRAND.gold })
      .setAuthor({
        name: `${interaction.guild?.name ?? 'Pixel Shop'}  •  Checkout`,
        iconURL: interaction.guild?.iconURL({ size: 128 }) ?? undefined,
      })
      .setTitle(`${ICON.scroll}  INVOICE — ${product.name}`)
      .setDescription([
        `${ICON.player}  **Player:** <@${interaction.user.id}>`,
        `_Selesaikan payment dalam **${ttlMinutes} menit** — jika tidak, order akan dibatalkan otomatis._`,
        DIVIDER,
      ].join('\n'))
      .addFields(
        { name: `${ICON.product}  Item`, value: `**${product.name}**`, inline: false },
        { name: `${ICON.target}  Jumlah`, value: `\`${quantity}\``, inline: true },
        { name: `${ICON.gem}  Harga`, value: formatIDR(product.price), inline: true },
        { name: `${ICON.crystal}  Total`, value: `**${formatIDR(totalPrice)}**`, inline: true },
      );

    if (product.format) {
      embed.addFields({ name: `${ICON.key}  Format Item`, value: `\`${product.format}\``, inline: false });
    }

    embed.addFields(
      { name: `${ICON.lightning}  Cara Payment`, value: payment.instructions, inline: false },
      { name: `${ICON.scroll}  Order ID`, value: `\`${orderId}\``, inline: false },
      { name: `${ICON.clock}  Expires`, value: `<t:${expiresUnix}:R>`, inline: false },
    );

    if (payment.qrImageUrl) embed.setImage(payment.qrImageUrl);

    embed.setFooter(guildFooter(interaction.guild, '⏳ Awaiting Payment  •  Quest Started'));

    await interaction.editReply({ embeds: [embed] });
    log.info(`new order ${orderId} by ${interaction.user.tag}: ${quantity}× ${product.name} = ${formatIDR(totalPrice)} (attempt=${reserveResult.attempt})`);
    schedulePanelUpdate(interaction.client);
  },
};
