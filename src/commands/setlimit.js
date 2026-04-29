const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:setlimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlimit')
    .setDescription('[Admin] Set max quantity per transaksi /buy untuk produk')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('product').setDescription('Nama produk').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o =>
      o.setName('max').setDescription('Max per /buy (0 = unlimited / pakai cap global)').setMinValue(0).setMaxValue(10000).setRequired(true)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const name = interaction.options.getString('product');
    const max = interaction.options.getInteger('max');

    const product = await collections.products().findOne({ name });
    if (!product) {
      return interaction.reply({ content: `${ICON.boom} Produk \`${name}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
    }

    if (max === 0) {
      await collections.products().updateOne({ _id: product._id }, { $unset: { maxPerOrder: '' } });
      log.info(`admin ${interaction.user.tag} removed limit for "${name}"`);
    } else {
      await collections.products().updateOne({ _id: product._id }, { $set: { maxPerOrder: max } });
      log.info(`admin ${interaction.user.tag} set maxPerOrder=${max} for "${name}"`);
    }

    schedulePanelUpdate(interaction.client);

    const embed = brandEmbed(interaction.guild, { color: BRAND.success })
      .setTitle(`${ICON.sparkle}  Limit Updated`)
      .addFields(
        { name: `${ICON.product}  Produk`, value: `\`${name}\``, inline: true },
        { name: `${ICON.target}  Max per /buy`, value: max === 0 ? '_(unlimited)_' : `\`${max}\``, inline: true },
      )
      .setFooter(guildFooter(interaction.guild, 'Berlaku untuk pembelian baru'));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
