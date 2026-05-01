const {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, AttachmentBuilder, ChannelType,
} = require('discord.js');
const { collections } = require('../db');
const { runMassLinkPipeline } = require('../services/massLink');
const { MassLinkTracker } = require('../services/massLinkTracker');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const botLog = createLogger('cmd:masslink');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = /\.(txt|csv|log)$/i;

function isAuthorized(interaction) {
  const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);
  if (isAdmin) return true;

  const roleId = process.env.MASSLINK_ROLE_ID;
  if (roleId && interaction.member?.roles?.cache?.has?.(roleId)) return true;

  const userIds = (process.env.MASSLINK_ALLOW_USER_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (userIds.includes(interaction.user.id)) return true;

  return false;
}

function buildResultEmbed(guild, status, details) {
  const colorMap = {
    success: BRAND.success,
    partial: BRAND.warning,
    aborted: BRAND.danger,
    crashed: BRAND.danger,
    'check-ok': BRAND.success,
  };
  const titleMap = {
    success: `${ICON.trophy}  MassLink: All Linked`,
    partial: `${ICON.fire}  MassLink: Partial Success`,
    aborted: `${ICON.boom}  MassLink: Aborted`,
    crashed: `${ICON.boom}  MassLink: Crashed`,
    'check-ok': `${ICON.sparkle}  Steam Check: All Free`,
  };

  return brandEmbed(guild, { color: colorMap[status], thumbnail: false })
    .setAuthor({
      name: `${guild?.name ?? 'Pixel Shop'}  •  MassLink Result`,
      iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
    })
    .setTitle(titleMap[status])
    .addFields(details)
    .setFooter(guildFooter(guild, 'Mass-link pipeline'))
    .setTimestamp();
}

async function sendResultDm(user, embed, files = []) {
  try {
    await user.send({ embeds: [embed], files });
    return { sent: true };
  } catch (err) {
    botLog.warn(`DM to ${user.tag} failed: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

function logAttachment(buffer, name = 'masslink-log.txt') {
  return new AttachmentBuilder(Buffer.from(buffer, 'utf8'), { name });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('masslink')
    .setDescription('[Admin] Mass link Pixel World accounts to Steam (3-step pipeline)')
    // .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption((o) =>
      o.setName('file')
        .setDescription('File: nickname|pw_email|pw_pass|steam_user|steam_pass per line')
        .setRequired(true))
    .addBooleanOption((o) =>
      o.setName('check_only')
        .setDescription('Hanya jalankan Step 1 (Steam Check) lalu stop')
        .setRequired(false)),

  async execute(interaction) {
    if (!isAuthorized(interaction)) {
      botLog.warn(`unauthorized masslink attempt by ${interaction.user.tag} (${interaction.user.id})`);
      return interaction.reply({
        content: `${ICON.shield} Kamu tidak punya akses untuk command ini. Hubungi admin.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticket = await collections.tickets().findOne({
      channelId: interaction.channel.id,
      status: 'open',
    });
    if (!ticket) {
      return interaction.reply({
        content: `${ICON.shield} \`/masslink\` cuma bisa dijalankan di **dalam ticket channel** yang aktif.\n\nBuka ticket dulu via panel \`/ticketpanel\`, lalu jalankan command di sana.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const attachment = interaction.options.getAttachment('file', true);
    const onlyCheckSteam = interaction.options.getBoolean('check_only') ?? false;

    if (attachment.size > MAX_FILE_BYTES) {
      return interaction.reply({
        content: `${ICON.boom} File terlalu besar (max ${MAX_FILE_BYTES / 1024 / 1024}MB).`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const ct = (attachment.contentType || '').toLowerCase();
    if (!ALLOWED_EXT.test(attachment.name || '') && !ct.startsWith('text/')) {
      return interaction.reply({
        content: `${ICON.boom} File harus text (.txt/.csv/.log).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    let text;
    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      return interaction.editReply(`${ICON.boom} Failed to download attachment: ${e.message}`);
    }

    const tracker = new MassLinkTracker(async (payload) => {
      await interaction.editReply(payload);
    });
    botLog.info(`admin ${interaction.user.tag} started masslink (size=${attachment.size}, check_only=${onlyCheckSteam}) in channel ${interaction.channel.id}`);

    const startedAt = Date.now();
    let summaryEmbed = null;
    let dmFiles = [];

    try {
      const result = await runMassLinkPipeline(text, { onlyCheckSteam }, tracker);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (result.aborted) {
        summaryEmbed = buildResultEmbed(interaction.guild, 'aborted', [
          { name: `${ICON.scroll}  Reason`, value: `\`${result.reason}\``, inline: false },
          { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          { name: `${ICON.player}  Triggered by`, value: `<@${interaction.user.id}>`, inline: true },
        ]);
        dmFiles = [];
      } else if (result.steamCheckOnly) {
        summaryEmbed = buildResultEmbed(interaction.guild, 'check-ok', [
          { name: `${ICON.product}  Total checked`, value: `\`${result.totalRows}\``, inline: true },
          { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
        ]);
        dmFiles = [];
      } else {
        const { link, totalRows, skipped = [] } = result;
        const allFailed = [
          ...skipped.map((s) => ({ ...s, stage: 'unlink' })),
          ...link.failed.map((f) => ({ ...f, stage: 'link' })),
        ];

        const files = [];
        if (link.linked.length > 0) {
          const successTxt = link.linked
            .map((l) =>
              `${l.row.nickname}|${l.row.pw_email}|${l.row.pw_pass}|${l.row.steam_user}|${l.row.steam_pass}`,
            )
            .join('\n');
          files.push(new AttachmentBuilder(Buffer.from(successTxt, 'utf8'), { name: 'masslink-success.txt' }));
        }
        if (allFailed.length > 0) {
          const failedTxt = allFailed
            .map((f) =>
              `${f.row.nickname}|${f.row.pw_email}|${f.row.pw_pass}|${f.row.steam_user}|${f.row.steam_pass} : ${f.err}`,
            )
            .join('\n');
          files.push(new AttachmentBuilder(Buffer.from(failedTxt, 'utf8'), { name: 'masslink-failed.txt' }));
        }

        if (allFailed.length === 0) {
          summaryEmbed = buildResultEmbed(interaction.guild, 'success', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
        } else {
          summaryEmbed = buildResultEmbed(interaction.guild, 'partial', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.shield}  Skipped`, value: `\`${skipped.length}\``, inline: true },
            { name: `${ICON.boom}  Failed`, value: `\`${link.failed.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
        }
        dmFiles = files;
      }
    } catch (e) {
      botLog.error('pipeline crashed:', e);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      summaryEmbed = buildResultEmbed(interaction.guild, 'crashed', [
        { name: `${ICON.scroll}  Error`, value: `\`${(e.message || String(e)).slice(0, 500)}\``, inline: false },
        { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
      ]);
      dmFiles = [];
    }

    await tracker.finalize(summaryEmbed);
    const dmResult = await sendResultDm(interaction.user, summaryEmbed, dmFiles);

    if (!dmResult.sent) {
      try {
        await interaction.followUp({
          content: `⚠️ Tidak bisa kirim DM ke <@${interaction.user.id}> (DM tertutup). Buka DM dulu untuk dapat full report.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch { /* ignore */ }
    }
  },
};
