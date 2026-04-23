const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches, invalidateProductCache } = require('../utils/productCache');

const log = createLogger('cmd:setformat');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setformat')
    .setDescription('[Admin] Set/ubah format item untuk produk (misal: username|email|password)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('product').setDescription('Nama produk').setRequired(true).setAutocomplete(true))
    .addStringOption(o =>
      o.setName('format').setDescription('Format baru. Kosongkan untuk menghapus.').setRequired(false)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try {
      await interaction.respond(names);
    } catch (err) {
      if (err.code !== 10062) throw err;
    }
  },

  async execute(interaction) {
    const name = interaction.options.getString('product');
    const format = interaction.options.getString('format');

    const product = await collections.products().findOne({ name });
    if (!product) {
      return interaction.reply({ content: `Produk \`${name}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
    }

    if (format) {
      await collections.products().updateOne({ _id: product._id }, { $set: { format } });
      log.info(`admin ${interaction.user.tag} set format for "${name}" → "${format}"`);
      return interaction.reply({
        content: `✅ Format \`${name}\` di-set ke \`${format}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await collections.products().updateOne({ _id: product._id }, { $unset: { format: '' } });
    log.info(`admin ${interaction.user.tag} cleared format for "${name}"`);
    return interaction.reply({
      content: `✅ Format \`${name}\` dihapus.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
