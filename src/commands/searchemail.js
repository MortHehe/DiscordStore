const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { searchEmails } = require('../services/imap');
const { BRAND, ICON, DIVIDER, brandEmbed, guildFooter } = require('../utils/embeds');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:searchemail');

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('searchemail')
    .setDescription('[Admin] Cari email di inbox admin berdasarkan email penerima (IMAP)')
    // .setDefaultMemberPermissions(PermissionFlagsBits.all)
    .addStringOption(o =>
      o.setName('to').setDescription('Email penerima (misal: account123@gmail.com)').setRequired(true))
    .addIntegerOption(o =>
      o.setName('limit').setDescription('Jumlah hasil (default 5, max 10)')
        .setMinValue(1).setMaxValue(10).setRequired(false))
    .addIntegerOption(o =>
      o.setName('days').setDescription('Cari dalam N hari terakhir (default 30)')
        .setMinValue(1).setMaxValue(365).setRequired(false))
    .addStringOption(o =>
      o.setName('keyword').setDescription('Keyword di subject/body (optional)').setRequired(false)),

  async execute(interaction) {
    const to = interaction.options.getString('to');
    const limit = interaction.options.getInteger('limit') ?? 5;
    const days = interaction.options.getInteger('days') ?? 30;
    const keyword = interaction.options.getString('keyword');
    const from = null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const results = await searchEmails({ to, from, limit, days, keyword });

      if (results.length === 0) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`${ICON.scroll}  No Email Found`)
          .setDescription(
            `Tidak ada email ke \`${to}\`${keyword ? ` dengan keyword \`${keyword}\`` : ''} dalam **${days} hari** terakhir.`,
          )
          .setFooter(guildFooter(interaction.guild, 'IMAP search'));
        return interaction.editReply({ embeds: [embed] });
      }

      const filterLines = [
        `${ICON.target}  **To:** \`${to}\``,
        keyword ? `${ICON.key}  **Keyword:** \`${keyword}\`` : null,
        `${ICON.clock}  **Range:** ${days} hari terakhir`,
      ].filter(Boolean);

      const embed = brandEmbed(interaction.guild, { color: BRAND.info })
        .setAuthor({
          name: `${interaction.guild?.name ?? 'Pixel Shop'}  •  Email Search`,
          iconURL: interaction.guild?.iconURL({ size: 64 }) ?? undefined,
        })
        .setTitle(`${ICON.scroll}  Email Search — ${results.length} found`)
        .setDescription([...filterLines, DIVIDER].join('\n'));

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const ts = Math.floor(r.date.getTime() / 1000);

        const lines = [
          `📅  <t:${ts}:F>  (<t:${ts}:R>)`,
          `📨  From: \`${truncate(r.from, 80)}\``,
          `📬  To: \`${truncate(r.to, 80)}\``,
          '',
          `\`\`\`\n${truncate(r.preview || '_(empty body)_', 260)}\n\`\`\``,
        ];

        if (r.links.passwordReset.length > 0) {
          lines.push(`🔐  **Password Reset Links:**`);
          for (const link of r.links.passwordReset.slice(0, 2)) {
            lines.push(link);
          }
        }
        if (r.links.emailChange.length > 0) {
          lines.push(`📧  **Email Change Links:**`);
          for (const link of r.links.emailChange.slice(0, 2)) {
            lines.push(link);
          }
        }
        if (r.links.verify.length > 0) {
          lines.push(`${ICON.key}  **Verification Links:**`);
          for (const link of r.links.verify.slice(0, 2)) {
            lines.push(link);
          }
        }
        if (r.links.passwordReset.length === 0 && r.links.emailChange.length === 0 && r.links.verify.length === 0 && r.links.all.length > 0) {
          lines.push(`🔗  First link: ${r.links.all[0]}`);
        }

        embed.addFields({
          name: `#${i + 1}  •  ${truncate(r.subject, 200)}`,
          value: truncate(lines.join('\n'), 1024),
          inline: false,
        });
      }

      embed.setFooter(guildFooter(interaction.guild, `Searched last ${days} days • IMAP`));
      await interaction.editReply({ embeds: [embed] });
      log.info(`admin ${interaction.user.tag} searched to=${to} days=${days} → ${results.length} results`);
    } catch (err) {
      log.error('searchemail failed:', err);
      const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
        .setTitle(`${ICON.boom}  IMAP Error`)
        .setDescription(`\`${truncate(err.message, 500)}\`\n\n_Cek konfigurasi IMAP di \`.env\`._`);
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
