const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} = require('discord.js');
const { collections } = require('../db');
const { formatIDR } = require('../utils/format');

const PAGE_SIZE = 5;
const COLLECTOR_MS = 5 * 60 * 1000;
const BAR_WIDTH = 10;

const COLOR_GOOD = 0x57f287;
const COLOR_WARN = 0xfee75c;
const COLOR_BAD = 0xed4245;
const COLOR_NEUTRAL = 0x5865f2;

function stockBar(n) {
  const filled = Math.min(BAR_WIDTH, Math.max(0, n));
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function stockBadge(n) {
  if (n === 0) return { emoji: '🔴', label: 'Habis' };
  if (n < 5) return { emoji: '🟡', label: `${n} tersisa` };
  return { emoji: '🟢', label: `${n} tersedia` };
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

async function fetchStock() {
  return collections.products().aggregate([
    {
      $lookup: {
        from: 'stock',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$productId', '$$pid'] }, { $eq: ['$sold', false] }] } } },
          { $count: 'n' },
        ],
        as: 'available',
      },
    },
    {
      $project: {
        name: 1,
        description: 1,
        price: 1,
        available: { $ifNull: [{ $first: '$available.n' }, 0] },
      },
    },
    { $sort: { name: 1 } },
  ]).toArray();
}

function overallColor(rows) {
  if (rows.length === 0) return COLOR_NEUTRAL;
  const inStock = rows.filter(r => r.available > 0).length;
  if (inStock === 0) return COLOR_BAD;
  if (inStock < rows.length) return COLOR_WARN;
  return COLOR_GOOD;
}

function buildLoadingEmbed(guild, text = 'Memuat daftar produk') {
  return new EmbedBuilder()
    .setColor(COLOR_NEUTRAL)
    .setAuthor({
      name: guild?.name ?? 'Toko',
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle('🛍️  Toko Digital')
    .setDescription(
      '```ansi\n' +
      `[2;36m${text}...[0m\n` +
      '░░░░░░░░░░  [2;37mplease wait[0m\n' +
      '```'
    );
}

function buildEmbed(rows, page, guild) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
  const inStockCount = rows.filter(r => r.available > 0).length;

  const embed = new EmbedBuilder()
    .setColor(overallColor(rows))
    .setAuthor({
      name: guild?.name ?? 'Toko',
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle('🛍️  Toko Digital  —  Daftar Produk')
    .setTimestamp();

  if (rows.length === 0) {
    embed
      .setDescription(
        '```ansi\n[2;31mToko masih kosong[0m\n```\n' +
        '_Admin dapat menambahkan produk dengan_ `/addproduct`'
      )
      .setFooter({ text: 'Tidak ada produk untuk ditampilkan' });
    return { embed, totalPages: 1, safePage: 0 };
  }

  embed.setDescription(
    '```ansi\n' +
    `[2;37m📊 Total Produk [0m : [2;36m${String(rows.length).padStart(3)}[0m\n` +
    `[2;37m✅ Tersedia     [0m : [2;32m${String(inStockCount).padStart(3)}[0m\n` +
    `[2;37m📦 Stok Total   [0m : [2;33m${String(totalAvailable).padStart(3)}[0m\n` +
    '```'
  );

  for (const r of slice) {
    const badge = stockBadge(r.available);
    const lines = [
      `> 💰 **${formatIDR(r.price)}**   •   📦 \`${badge.label}\``,
      `> \`${stockBar(r.available)}\``,
    ];
    if (r.description) lines.push(`> ✨ ${truncate(r.description, 140)}`);
    embed.addFields({
      name: `${badge.emoji}  ${r.name}`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: `Halaman ${safePage + 1}/${totalPages}  •  Beli dengan /buy`,
    iconURL: guild?.iconURL({ size: 32 }) ?? undefined,
  });

  return { embed, totalPages, safePage };
}

function buildButtons(page, totalPages, { disabled = false, refreshing = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('stock:prev')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    new ButtonBuilder()
      .setCustomId('stock:page')
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('stock:next')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('stock:refresh')
      .setEmoji(refreshing ? '⏳' : '🔄')
      .setLabel(refreshing ? 'Memuat...' : 'Refresh')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || refreshing),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Lihat daftar produk dan stok yang tersedia'),

  async execute(interaction) {
    await interaction.reply({ embeds: [buildLoadingEmbed(interaction.guild)] });

    let rows = await fetchStock();
    let page = 0;
    let state = buildEmbed(rows, page, interaction.guild);

    const msg = await interaction.editReply({
      embeds: [state.embed],
      components: [buildButtons(state.safePage, state.totalPages)],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: COLLECTOR_MS,
      filter: i => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (btn) => {
      try {
        if (btn.customId === 'stock:refresh') {
          await btn.update({
            embeds: [state.embed],
            components: [buildButtons(state.safePage, state.totalPages, { refreshing: true })],
          });
          rows = await fetchStock();
          state = buildEmbed(rows, page, interaction.guild);
          page = state.safePage;
          await interaction.editReply({
            embeds: [state.embed],
            components: [buildButtons(state.safePage, state.totalPages)],
          });
          return;
        }

        if (btn.customId === 'stock:prev') page = Math.max(0, page - 1);
        else if (btn.customId === 'stock:next') page = page + 1;

        state = buildEmbed(rows, page, interaction.guild);
        page = state.safePage;
        await btn.update({
          embeds: [state.embed],
          components: [buildButtons(state.safePage, state.totalPages)],
        });
      } catch (err) {
        console.error('[stock collector]', err);
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({
          components: [buildButtons(state.safePage, state.totalPages, { disabled: true })],
        });
      } catch { /* message may be deleted */ }
    });
  },
};
