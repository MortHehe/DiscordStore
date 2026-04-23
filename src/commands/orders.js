const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { collections } = require('../db');
const { formatIDR } = require('../utils/format');
const { BRAND, ICON, DIVIDER, brandEmbed, guildFooter, orderStatusBadge } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('orders')
    .setDescription('Lihat quest log pembelian kamu'),

  async execute(interaction) {
    const rows = await collections.orders().aggregate([
      { $match: { userId: interaction.user.id } },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1, status: 1, price: 1,
          quantity: { $ifNull: ['$quantity', 1] },
          createdAt: 1,
          productName: '$product.name',
        },
      },
    ]).toArray();

    const embed = brandEmbed(interaction.guild, { color: BRAND.pixel })
      .setAuthor({
        name: `${interaction.guild?.name ?? 'Pixel Shop'}  •  Player Log`,
        iconURL: interaction.guild?.iconURL({ size: 128 }) ?? undefined,
      })
      .setTitle(`${ICON.scroll}  QUEST LOG`);

    if (rows.length === 0) {
      embed
        .setDescription(
          `${ICON.player}  <@${interaction.user.id}>\n\n` +
          `${ICON.seedling}  Quest log kamu masih kosong. Mulai petualangan dengan \`/buy\` atau lihat shop di atas! ${ICON.controller}`
        )
        .setFooter(guildFooter(interaction.guild, 'Belum ada quest'));
    } else {
      const totalSpent = rows.reduce((s, r) => s + (r.price || 0), 0);
      const completed = rows.filter(r => r.status === 'completed').length;

      const lines = rows.map(r => {
        const badge = orderStatusBadge(r.status);
        const ts = Math.floor(new Date(r.createdAt).getTime() / 1000);
        return (
          `${badge.emoji}  **${r.productName ?? '_(item dihapus)_'}** × ${r.quantity}\n` +
          `┣  ${ICON.gem} ${formatIDR(r.price)}  •  <t:${ts}:R>\n` +
          `┗  \`${r._id}\``
        );
      }).join('\n\n');

      embed.setDescription([
        `${ICON.player}  <@${interaction.user.id}> — berikut **${rows.length}** quest terakhirmu:`,
        DIVIDER,
        '',
        lines,
      ].join('\n'));

      embed.addFields(
        { name: `${ICON.trophy}  Quest Completed`, value: `\`${completed}\``, inline: true },
        { name: `${ICON.crystal}  Total Gems Spent`, value: formatIDR(totalSpent), inline: true },
      );

      embed.setFooter(guildFooter(interaction.guild, `${rows.length} quest terbaru`));
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
