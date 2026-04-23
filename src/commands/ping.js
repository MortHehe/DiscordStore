const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db');
const { BRAND, ICON, DIVIDER, brandEmbed, guildFooter } = require('../utils/embeds');

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function latencyIcon(ms) {
  if (ms < 0) return '❌';
  if (ms < 100) return '🟢';
  if (ms < 300) return '🟡';
  return '🔴';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Cek status, latency, dan health bot'),

  async execute(interaction) {
    const reply = await interaction.reply({ content: `${ICON.lightning} Pinging...`, fetchReply: true });
    const apiLatency = reply.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = interaction.client.ws.ping;

    let dbLatency = -1;
    let dbStatus = '❌ Error';
    try {
      const start = Date.now();
      await getDb().admin().ping();
      dbLatency = Date.now() - start;
      dbStatus = '✅ Connected';
    } catch (err) {
      dbStatus = `❌ ${err.message.slice(0, 60)}`;
    }

    const uptimeStr = formatUptime(process.uptime());
    const mem = process.memoryUsage();
    const memUsedMB = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);

    const paymentProvider = (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();
    const confirmMode = paymentProvider === 'autogopay'
      ? (process.env.AUTOGOPAY_CONFIRM_MODE || 'polling')
      : 'n/a';

    const overallBad = dbLatency < 0 || wsLatency > 500;
    const overallWarn = wsLatency > 200 || (dbLatency > 0 && dbLatency > 500);
    const color = overallBad ? BRAND.danger : overallWarn ? BRAND.warning : BRAND.success;

    const embed = brandEmbed(interaction.guild, { color })
      .setAuthor({
        name: `${interaction.guild?.name ?? 'Pixel Shop'}  •  Bot Status`,
        iconURL: interaction.guild?.iconURL({ size: 64 }) ?? undefined,
      })
      .setTitle(`${ICON.controller}  BOT STATUS`)
      .setDescription([
        `${ICON.sparkle}  _Cek health & latency realtime._`,
        DIVIDER,
      ].join('\n'))
      .addFields(
        {
          name: `${ICON.lightning}  Latency`,
          value: [
            `${latencyIcon(wsLatency)} **Discord WS** — \`${wsLatency}ms\``,
            `${latencyIcon(apiLatency)} **Discord API** — \`${apiLatency}ms\``,
            `${latencyIcon(dbLatency)} **MongoDB** — \`${dbLatency < 0 ? 'n/a' : `${dbLatency}ms`}\``,
          ].join('\n'),
          inline: false,
        },
        {
          name: `${ICON.shield}  Services`,
          value: [
            `🗄️  **Database** — ${dbStatus}`,
            `💳  **Payment** — \`${paymentProvider}\`${confirmMode !== 'n/a' ? ` (${confirmMode})` : ''}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: `${ICON.clock}  Runtime`,
          value: [
            `⏱️  **Uptime** — \`${uptimeStr}\``,
            `💾  **Memory** — \`${memUsedMB} MB\` (heap: \`${heapUsedMB} MB\`)`,
            `🔧  **Node** — \`${process.version}\``,
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter(guildFooter(interaction.guild, 'Realtime check'))
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [embed] });
  },
};
