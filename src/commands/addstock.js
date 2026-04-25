const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { getProductNames, filterMatches } = require('../utils/productCache');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');
const { extractDedupeKey } = require('../utils/stockKey');
const { removeAllDuplicates } = require('../services/stockDedupe');

const log = createLogger('cmd:addstock');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS_PER_CALL = 10_000;
const ALLOWED_EXT = /\.(txt|csv|log)$/i;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addstock')
    .setDescription('[Admin] Tambah stock untuk item (via file atau manual)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('product').setDescription('Nama item').setRequired(true).setAutocomplete(true))
    .addAttachmentOption(o =>
      o.setName('file').setDescription('File .txt (satu item per baris)').setRequired(false))
    .addStringOption(o =>
      o.setName('items').setDescription('Items dipisah `;` (misal email:pass;email2:pass2)').setRequired(false)),

  async autocomplete(interaction) {
    await getProductNames();
    const focused = interaction.options.getFocused();
    const names = filterMatches(focused).map(n => ({ name: n, value: n }));
    try { await interaction.respond(names); }
    catch (err) { if (err.code !== 10062) throw err; }
  },

  async execute(interaction) {
    const name = interaction.options.getString('product');
    const file = interaction.options.getAttachment('file');
    const raw = interaction.options.getString('items');

    if (!file && !raw) {
      return interaction.reply({
        content: 'Berikan **file** atau **items** (minimal salah satu).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const product = await collections.products().findOne({ name }, { projection: { _id: 1, name: 1 } });
    if (!product) {
      return interaction.reply({ content: `Item \`${name}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const items = [];
    let source = 'manual';

    if (file) {
      if (file.size > MAX_FILE_BYTES) {
        return interaction.editReply(`File terlalu besar (max ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
      }
      const ct = (file.contentType || '').toLowerCase();
      const hasValidExt = ALLOWED_EXT.test(file.name || '');
      if (!hasValidExt && !ct.startsWith('text/')) {
        return interaction.editReply(
          `File harus berupa text (.txt / .csv / .log). Terdeteksi: \`${ct || 'unknown'}\``
        );
      }

      try {
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) items.push(trimmed);
        }
        source = file ? (raw ? 'file+manual' : 'file') : 'manual';
      } catch (err) {
        log.error(`failed to fetch attachment ${file.url}:`, err);
        return interaction.editReply('Gagal mengunduh file. Coba upload ulang.');
      }
    }

    if (raw) {
      for (const item of raw.split(';')) {
        const trimmed = item.trim();
        if (trimmed) items.push(trimmed);
      }
    }

    const seenKeys = new Set();
    const uniqueItems = [];
    let dupInUpload = 0;
    for (const item of items) {
      const key = extractDedupeKey(item);
      if (seenKeys.has(key)) { dupInUpload++; continue; }
      seenKeys.add(key);
      uniqueItems.push(item);
    }

    if (uniqueItems.length === 0) {
      return interaction.editReply('Tidak ada item valid ditemukan dalam input.');
    }
    if (uniqueItems.length > MAX_ITEMS_PER_CALL) {
      return interaction.editReply(`Terlalu banyak item (${uniqueItems.length}). Batas: ${MAX_ITEMS_PER_CALL}.`);
    }

    const existingDocs = await collections.stock()
      .find(
        { productId: product._id, sold: false },
        { projection: { content: 1 } },
      )
      .toArray();
    const existingKeys = new Set(existingDocs.map(d => extractDedupeKey(d.content)));
    const trulyNew = uniqueItems.filter(c => !existingKeys.has(extractDedupeKey(c)));
    const dupInDb = uniqueItems.length - trulyNew.length;

    if (trulyNew.length === 0) {
      return interaction.editReply(
        `Semua **${uniqueItems.length}** item sudah ada di DB. Tidak ada yang ditambahkan.`,
      );
    }

    await collections.stock().insertMany(
      trulyNew.map(content => ({
        productId: product._id, content, sold: false, createdAt: new Date(),
      })),
    );

    const autoPurge = await removeAllDuplicates(product._id);

    const duplicates = dupInUpload + dupInDb;
    const added = trulyNew.length - autoPurge.deletedCount;
    const purged = autoPurge.deletedCount;

    const totalStock = await collections.stock().countDocuments({ productId: product._id, sold: false });

    log.info(`admin ${interaction.user.tag} added ${added} stock to "${product.name}" (source=${source}, skipped=${duplicates})`);
    schedulePanelUpdate(interaction.client);

    const embed = brandEmbed(interaction.guild, { color: BRAND.success })
      .setTitle(`${ICON.sparkle}  Stock Restocked`)
      .addFields(
        { name: `${ICON.product}  Item`, value: `\`${product.name}\``, inline: true },
        { name: `${ICON.lightning}  Ditambah`, value: `\`${added}\``, inline: true },
        { name: `${ICON.block}  Total Stock`, value: `\`${totalStock}\``, inline: true },
      )
      .setFooter(guildFooter(
        interaction.guild,
        `Source: ${source}${duplicates > 0 ? ` • ${duplicates} dup skipped` : ''}${purged > 0 ? ` • ${purged} auto-purged` : ''}`,
      ));

    const preview = trulyNew.slice(0, 3).map(s => s.length > 60 ? s.slice(0, 57) + '...' : s);
    if (preview.length > 0) {
      embed.addFields({
        name: `${ICON.scroll}  Preview`,
        value: '```\n' + preview.join('\n') + (added > 3 ? `\n... +${added - 3} lainnya` : '') + '\n```',
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
