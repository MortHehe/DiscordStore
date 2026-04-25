const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { findDuplicates, removeAllDuplicates } = require('../services/stockDedupe');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');
const { DEDUPE_FIELD_COUNT } = require('../utils/stockKey');

const log = createLogger('cmd:dedupestock');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dedupestock')
    .setDescription('[Admin] Cari & hapus SEMUA copies dari duplicate stock')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('product').setDescription('Nama produk (kosongkan = scan semua)').setRequired(false).setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('confirm').setDescription('TRUE = hapus semua copies. FALSE = preview saja (default)').setRequired(false)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const productName = interaction.options.getString('product');
    const confirm = interaction.options.getBoolean('confirm') ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let productId = null;
    if (productName) {
      const product = await collections.products().findOne({ name: productName }, { projection: { _id: 1 } });
      if (!product) return interaction.editReply(`${ICON.boom} Produk \`${productName}\` tidak ditemukan.`);
      productId = product._id;
    }

    const duplicates = await findDuplicates(productId);

    if (duplicates.length === 0) {
      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  No Duplicates Found`)
        .setDescription(productName ? `Stock \`${productName}\` bersih.` : 'Semua stock tidak ada duplicate.');
      return interaction.editReply({ embeds: [embed] });
    }

    const totalToDelete = duplicates.reduce((s, d) => s + d.count, 0);
    const uniqueGroups = duplicates.length;

    if (!confirm) {
      const sample = duplicates.slice(0, 5).map(d => {
        const key = d._id.dedupeKey || d.sampleContent || '';
        const preview = key.length > 50 ? key.slice(0, 47) + '...' : key;
        return `• \`${preview}\` — ${d.count}x`;
      }).join('\n');

      const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
        .setTitle(`${ICON.fire}  Duplicate Preview`)
        .setDescription(
          `Ditemukan **${uniqueGroups}** group duplicate (**${totalToDelete}** copies total — SEMUA akan dihapus).\n\n` +
          `**Sample:**\n${sample}${duplicates.length > 5 ? `\n_...dan ${duplicates.length - 5} group lainnya_` : ''}\n\n` +
          `⚠️  Semua copies di group ini akan dihapus (tidak di-keep). Jalankan dengan \`confirm:true\` untuk lanjut.`,
        )
        .setFooter(guildFooter(
          interaction.guild,
          `Dedupe by ${DEDUPE_FIELD_COUNT} field pertama • ALL copies akan dihapus`,
        ));
      return interaction.editReply({ embeds: [embed] });
    }

    const result = await removeAllDuplicates(productId);
    log.info(`admin ${interaction.user.tag} purged ${result.deletedCount} duplicates${productName ? ` for "${productName}"` : ''}`);
    schedulePanelUpdate(interaction.client);

    const embed = brandEmbed(interaction.guild, { color: BRAND.success })
      .setTitle(`${ICON.sparkle}  Duplicates Purged`)
      .addFields(
        { name: `${ICON.product}  Scope`, value: productName ? `\`${productName}\`` : '_(semua produk)_', inline: true },
        { name: `${ICON.boom}  Dihapus`, value: `\`${result.deletedCount}\``, inline: true },
        { name: `${ICON.scroll}  Groups`, value: `\`${result.groups}\``, inline: true },
      )
      .setFooter(guildFooter(interaction.guild, 'Semua copies duplicate dihapus'));

    await interaction.editReply({ embeds: [embed] });
  },
};
