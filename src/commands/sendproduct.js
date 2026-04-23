const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ObjectId } = require('mongodb');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { reserveStock } = require('../services/inventory');
const { deliverOrder, DeliveryError } = require('../services/delivery');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:sendproduct');
const MAX_QUANTITY = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sendproduct')
    .setDescription('[Admin] Kirim produk gratis (gift) ke player — tanpa payment')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName('user').setDescription('Player yang akan menerima').setRequired(true))
    .addStringOption(o =>
      o.setName('product').setDescription('Nama produk').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o =>
      o.setName('quantity').setDescription(`Jumlah (default 1, max ${MAX_QUANTITY})`)
       .setMinValue(1).setMaxValue(MAX_QUANTITY).setRequired(false))
    .addStringOption(o =>
      o.setName('reason').setDescription('Alasan gift (untuk log)').setRequired(false)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const name = interaction.options.getString('product');
    const quantity = interaction.options.getInteger('quantity') ?? 1;
    const reason = interaction.options.getString('reason') || 'admin gift';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const product = await collections.products().findOne({ name });
    if (!product) {
      return interaction.editReply(`${ICON.boom} Produk \`${name}\` tidak ditemukan.`);
    }

    if (user.bot) {
      return interaction.editReply(`${ICON.boom} Tidak bisa kirim ke bot.`);
    }

    const orderId = new ObjectId();
    const reserveResult = await reserveStock({
      productId: product._id,
      userId: user.id,
      orderId,
      quantity,
    });

    if (!reserveResult.success) {
      if (reserveResult.reason === 'INSUFFICIENT_STOCK') {
        return interaction.editReply(
          `${ICON.fire} Stock tidak cukup. Tersedia: \`${reserveResult.available}\` • Diminta: \`${quantity}\``,
        );
      }
      return interaction.editReply(`${ICON.lightning} Reserve gagal: ${reserveResult.reason}`);
    }

    await collections.orders().insertOne({
      _id: orderId,
      userId: user.id,
      productId: product._id,
      stockIds: reserveResult.stockIds,
      quantity,
      unitPrice: product.price,
      price: 0,
      status: 'pending',
      createdAt: new Date(),
      reservationExpiresAt: reserveResult.expiresAt,
      giftedBy: interaction.user.id,
      giftReason: reason,
    });

    try {
      await deliverOrder(interaction.client, orderId);
      schedulePanelUpdate(interaction.client);

      const embed = brandEmbed(interaction.guild, { color: BRAND.accent })
        .setTitle(`${ICON.gift}  Gift Terkirim`)
        .addFields(
          { name: `${ICON.player}  Penerima`, value: `${user.tag}\n<@${user.id}>`, inline: false },
          { name: `${ICON.product}  Item`, value: `**${product.name}** × \`${quantity}\``, inline: false },
          { name: `${ICON.scroll}  Order ID`, value: `\`${orderId}\``, inline: false },
          { name: `${ICON.key}  Reason`, value: reason, inline: false },
        )
        .setFooter(guildFooter(interaction.guild, 'DM terkirim ke player'));

      await interaction.editReply({ embeds: [embed] });
      log.info(`admin ${interaction.user.tag} gifted ${quantity}× ${product.name} to ${user.tag} (reason: ${reason})`);
    } catch (err) {
      if (err instanceof DeliveryError) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`${ICON.shield}  Delivery Gagal`)
          .setDescription(`**${err.code}** — ${err.message}\n\nOrder tetap \`pending\`. Minta user buka DM lalu \`/resend order:${orderId}\`.`);
        return interaction.editReply({ embeds: [embed] });
      }
      log.error('sendproduct failed:', err);
      throw err;
    }
  },
};
