const {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, AttachmentBuilder, ChannelType,
} = require('discord.js');
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

    let thread;
    try {
      thread = await interaction.channel.threads.create({
        name: `MassLink ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        autoArchiveDuration: 60,
        type: ChannelType.PublicThread,
        reason: `MassLink triggered by ${interaction.user.tag}`,
      });
      await thread.members.add(interaction.user.id).catch(() => {});
    } catch (err) {
      botLog.error('thread create failed:', err);
      return interaction.editReply(`${ICON.boom} Gagal create thread: ${err.message}`);
    }

    const startEmbed = brandEmbed(interaction.guild, { color: BRAND.pixel })
      .setTitle(`${ICON.lightning}  MassLink Started`)
      .setDescription(
        `Pipeline berjalan di ${thread}.\n\n` +
        `${ICON.player} Triggered by: <@${interaction.user.id}>\n` +
        `${ICON.scroll} File: \`${attachment.name}\` (${(attachment.size / 1024).toFixed(1)} KB)\n` +
        `${ICON.target} Mode: ${onlyCheckSteam ? '`check_only`' : '`full pipeline`'}`,
      )
      .setFooter(guildFooter(interaction.guild, 'Lihat thread untuk progress live'))
      .setTimestamp();
    await interaction.editReply({ embeds: [startEmbed] });

    const tracker = new MassLinkTracker(thread);
    botLog.info(`admin ${interaction.user.tag} started masslink (size=${attachment.size}, check_only=${onlyCheckSteam}) in thread ${thread.id}`);

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
        dmFiles = [logAttachment(tracker.getFullLog())];
      } else if (result.steamCheckOnly) {
        summaryEmbed = buildResultEmbed(interaction.guild, 'check-ok', [
          { name: `${ICON.product}  Total checked`, value: `\`${result.totalRows}\``, inline: true },
          { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
        ]);
        dmFiles = [logAttachment(tracker.getFullLog())];
      } else {
        const { link, totalRows, skipped = [] } = result;
        const allFailed = [
          ...skipped.map((s) => ({ ...s, stage: 'unlink' })),
          ...link.failed.map((f) => ({ ...f, stage: 'link' })),
        ];

        if (allFailed.length === 0) {
          summaryEmbed = buildResultEmbed(interaction.guild, 'success', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
          dmFiles = [logAttachment(tracker.getFullLog())];
        } else {
          const failedTxt = allFailed
            .map((f) =>
              `${f.row.nickname}|${f.row.pw_email}|${f.row.pw_pass}|${f.row.steam_user}|${f.row.steam_pass}  # [${f.stage}] ${f.err}`,
            )
            .join('\n');
          const failedAttach = new AttachmentBuilder(Buffer.from(failedTxt, 'utf8'), { name: 'masslink-failed.txt' });
          summaryEmbed = buildResultEmbed(interaction.guild, 'partial', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.shield}  Skipped (unlink stuck)`, value: `\`${skipped.length}\``, inline: true },
            { name: `${ICON.boom}  Failed (link step)`, value: `\`${link.failed.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
          dmFiles = [failedAttach, logAttachment(tracker.getFullLog())];
        }
      }
    } catch (e) {
      botLog.error('pipeline crashed:', e);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      summaryEmbed = buildResultEmbed(interaction.guild, 'crashed', [
        { name: `${ICON.scroll}  Error`, value: `\`${(e.message || String(e)).slice(0, 500)}\``, inline: false },
        { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
      ]);
      dmFiles = [logAttachment(tracker.getFullLog())];
    }

    await tracker.finalize(summaryEmbed);
    const dmResult = await sendResultDm(interaction.user, summaryEmbed, dmFiles);

    try {
      const finalReply = brandEmbed(interaction.guild, { color: summaryEmbed?.data?.color ?? BRAND.pixel })
        .setTitle(`${ICON.trophy}  MassLink Selesai`)
        .setDescription(
          `Lihat detail di ${thread}.\n\n` +
          (dmResult.sent
            ? `📩 _Full report dikirim ke DM kamu._`
            : `⚠️ _Tidak bisa kirim DM (DM tertutup). Buka DM lalu retry untuk dapat full log._`),
        )
        .setFooter(guildFooter(interaction.guild, 'Mass-link pipeline'))
        .setTimestamp();
      await interaction.editReply({ embeds: [finalReply] });
    } catch { /* ignore */ }
  },
};
