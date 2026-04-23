const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:clearstock');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearstock')
    .setDescription('[Admin] Hapus SEMUA stock unsold untuk produk tertentu')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('product').setDescription('Nama produk').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('confirm').setDescription('Set TRUE untuk konfirmasi — aksi ini tidak bisa dibatalkan').setRequired(true)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const name = interaction.options.getString('product');
    const confirm = interaction.options.getBoolean('confirm');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const product = await collections.products().findOne({ name }, { projection: { _id: 1, name: 1 } });
    if (!product) {
      return interaction.editReply(`${ICON.boom} Produk \`${name}\` tidak ditemukan.`);
    }

    if (!confirm) {
      const countUnsold = await collections.stock().countDocuments({ productId: product._id, sold: false });
      const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
        .setTitle(`${ICON.fire}  Konfirmasi Clearstock`)
        .setDescription(
          `Aksi ini akan **menghapus ${countUnsold} stock items unsold** dari \`${product.name}\`.\n\n` +
          `Item yang sudah terjual **tidak** dihapus.\n\n` +
          `Jalankan lagi dengan \`confirm:true\` untuk melanjutkan.`,
        );
      return interaction.editReply({ embeds: [embed] });
    }

    const result = await collections.stock().deleteMany({ productId: product._id, sold: false });

    log.info(`admin ${interaction.user.tag} cleared ${result.deletedCount} stock of "${product.name}"`);
    schedulePanelUpdate(interaction.client);

    const embed = brandEmbed(interaction.guild, { color: BRAND.success })
      .setTitle(`${ICON.sparkle}  Stock Cleared`)
      .addFields(
        { name: `${ICON.product}  Produk`, value: `\`${product.name}\``, inline: true },
        { name: `${ICON.boom}  Dihapus`, value: `\`${result.deletedCount}\``, inline: true },
      )
      .setFooter(guildFooter(interaction.guild, 'Stock sold tidak terpengaruh'));

    await interaction.editReply({ embeds: [embed] });
  },
};
