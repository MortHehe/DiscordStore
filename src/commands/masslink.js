const {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, AttachmentBuilder,
} = require('discord.js');
const { runMassLinkPipeline } = require('../services/massLink');
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

function makeReporter(interaction) {
  let last = Date.now();
  let pending = null;
  let buffer = '';
  let inFlight = false;

  async function flush() {
    inFlight = true;
    try {
      const text = buffer.length > 1900 ? buffer.slice(-1900) : buffer;
      await interaction.editReply({ content: '```\n' + text + '\n```' });
    } catch {
      try {
        await interaction.followUp({
          content: '```\n' + buffer.slice(-1900) + '\n```',
          flags: MessageFlags.Ephemeral,
        });
      } catch { /* ignore */ }
    } finally {
      inFlight = false;
      pending = null;
    }
  }

  return {
    log(line) {
      const ts = new Date().toISOString().split('T')[1].slice(0, 8);
      buffer += `[${ts}] ${line}\n`;
      botLog.info(line);
      const now = Date.now();
      if (!pending && now - last >= 2500 && !inFlight) {
        last = now;
        pending = setImmediate(flush);
      }
    },
    async final(content, files) {
      if (pending) clearImmediate(pending);
      try {
        await interaction.editReply({
          content: content.length > 1900 ? content.slice(0, 1900) : content,
          files,
        });
      } catch {
        try { await interaction.followUp({ content, files, flags: MessageFlags.Ephemeral }); }
        catch { /* ignore */ }
      }
    },
    getBuffer() { return buffer; },
  };
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let text;
    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      return interaction.editReply(`${ICON.boom} Failed to download attachment: ${e.message}`);
    }

    const reporter = makeReporter(interaction);
    botLog.info(`admin ${interaction.user.tag} started masslink (size=${attachment.size}, check_only=${onlyCheckSteam})`);

    const startedAt = Date.now();
    let dmEmbed = null;
    let dmFiles = [];
    let summaryText = '';

    try {
      const result = await runMassLinkPipeline(text, { onlyCheckSteam }, reporter.log);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (result.aborted) {
        summaryText = `${ICON.boom} **Aborted** — ${result.reason}\n\nLihat log di atas / DM untuk detail.`;
        dmEmbed = buildResultEmbed(interaction.guild, 'aborted', [
          { name: `${ICON.scroll}  Reason`, value: `\`${result.reason}\``, inline: false },
          { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          { name: `${ICON.player}  Triggered by`, value: `<@${interaction.user.id}>`, inline: true },
        ]);
        dmFiles = [logAttachment(reporter.getBuffer())];
      } else if (result.steamCheckOnly) {
        summaryText = `${ICON.sparkle} **Steam Check OK.** Semua ${result.totalRows} steam account masih free.`;
        dmEmbed = buildResultEmbed(interaction.guild, 'check-ok', [
          { name: `${ICON.product}  Total checked`, value: `\`${result.totalRows}\``, inline: true },
          { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
        ]);
        dmFiles = [logAttachment(reporter.getBuffer())];
      } else {
        const { link, totalRows, skipped = [] } = result;
        const allFailed = [
          ...skipped.map((s) => ({ ...s, stage: 'unlink' })),
          ...link.failed.map((f) => ({ ...f, stage: 'link' })),
        ];

        if (allFailed.length === 0) {
          summaryText = `${ICON.trophy} **Done.** Semua ${link.linked.length} account ter-link ke Steam.`;
          dmEmbed = buildResultEmbed(interaction.guild, 'success', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
          dmFiles = [logAttachment(reporter.getBuffer())];
        } else {
          const failedTxt = allFailed
            .map((f) =>
              `${f.row.nickname}|${f.row.pw_email}|${f.row.pw_pass}|${f.row.steam_user}|${f.row.steam_pass}  # [${f.stage}] ${f.err}`,
            )
            .join('\n');
          const failedAttach = new AttachmentBuilder(Buffer.from(failedTxt, 'utf8'), { name: 'masslink-failed.txt' });
          summaryText =
            `${ICON.fire} **Partial success.** ${link.linked.length}/${totalRows} ter-link.\n` +
            `${skipped.length} skipped (unlink stuck), ${link.failed.length} gagal di link step. Detail di DM.`;
          dmEmbed = buildResultEmbed(interaction.guild, 'partial', [
            { name: `${ICON.target}  Total`, value: `\`${totalRows}\``, inline: true },
            { name: `${ICON.sparkle}  Linked`, value: `\`${link.linked.length}\``, inline: true },
            { name: `${ICON.shield}  Skipped (unlink stuck)`, value: `\`${skipped.length}\``, inline: true },
            { name: `${ICON.boom}  Failed (link step)`, value: `\`${link.failed.length}\``, inline: true },
            { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
          ]);
          dmFiles = [failedAttach, logAttachment(reporter.getBuffer())];
        }
      }
    } catch (e) {
      botLog.error('pipeline crashed:', e);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      summaryText = `${ICON.boom} Pipeline crashed: ${e.message || e}`;
      dmEmbed = buildResultEmbed(interaction.guild, 'crashed', [
        { name: `${ICON.scroll}  Error`, value: `\`${(e.message || String(e)).slice(0, 500)}\``, inline: false },
        { name: `${ICON.clock}  Duration`, value: `\`${elapsed}s\``, inline: true },
      ]);
      dmFiles = [logAttachment(reporter.getBuffer())];
    }

    const dmResult = await sendResultDm(interaction.user, dmEmbed, dmFiles);
    const finalText = dmResult.sent
      ? `${summaryText}\n\n📩 _Full report dikirim ke DM kamu._`
      : `${summaryText}\n\n⚠️ _Tidak bisa kirim DM (DM tertutup). Buka DM lalu jalankan ulang untuk dapat full log._`;

    try {
      await reporter.final(finalText);
    } catch { /* ignore */ }
  },
};
