const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ObjectId } = require('mongodb');
const { collections } = require('../db');
const { formatIDR } = require('../utils/format');
const { createPayment } = require('../payments');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { reserveStock, RESERVATION_TTL_MS } = require('../services/inventory');
const { BRAND, ICON, DIVIDER, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:buy');
const MAX_QUANTITY = 50;

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

    const product = await collections.products().findOne({ name });
    if (!product) {
      const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
        .setTitle(`${ICON.boom}  Item Tidak Ditemukan`)
        .setDescription(`Item \`${name}\` tidak ada di shop.`);
      return interaction.editReply({ embeds: [embed] });
    }

    const totalPrice = product.price * quantity;
    const orderId = new ObjectId();

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
