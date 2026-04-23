const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { invalidateProductCache } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');
const { formatIDR } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('[Admin] Tambah item baru ke shop')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('name').setDescription('Nama item').setRequired(true))
    .addIntegerOption(o => o.setName('price').setDescription('Harga (IDR)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('description').setDescription('Deskripsi'))
    .addStringOption(o =>
      o.setName('format').setDescription('Format item, misal: username|email|password')),

  async execute(interaction) {
    const name = interaction.options.getString('name');
    const price = interaction.options.getInteger('price');
    const description = interaction.options.getString('description') ?? null;
    const format = interaction.options.getString('format') ?? null;

    try {
      const res = await collections.products().insertOne({
        name, description, format, price, createdAt: new Date(),
      });
      invalidateProductCache();
      schedulePanelUpdate(interaction.client);

      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  Item Baru Ditambahkan`)
        .addFields(
          { name: `${ICON.product}  Nama`, value: `**${name}**`, inline: false },
          { name: `${ICON.gem}  Harga`, value: formatIDR(price), inline: true },
          { name: `${ICON.scroll}  Product ID`, value: `\`${res.insertedId}\``, inline: true },
        );
      if (format) embed.addFields({ name: `${ICON.key}  Format`, value: `\`${format}\``, inline: false });
      if (description) embed.addFields({ name: `${ICON.scroll}  Deskripsi`, value: description, inline: false });
      embed.setFooter(guildFooter(interaction.guild, 'Tambah stock dengan /addstock'));

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
      if (err.code === 11000) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
          .setTitle(`${ICON.boom}  Item Sudah Ada`)
          .setDescription(`Item dengan nama \`${name}\` sudah ada di shop.`);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      throw err;
    }
  },
};
