const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getMaintenanceStatus, setMaintenance } = require('../services/maintenance');
const { schedulePanelUpdate } = require('../services/panel');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('[Admin] Set maintenance mode — blokir /buy selama aktif')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('on')
        .setDescription('Aktifkan maintenance — customer tidak bisa /buy')
        .addStringOption(o =>
          o.setName('reason').setDescription('Alasan maintenance (ditampilkan ke customer)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('off')
        .setDescription('Matikan maintenance — shop kembali normal'))
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Cek status maintenance saat ini')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'on') {
      const reason = interaction.options.getString('reason') || 'Sedang update / restock stock.';
      await setMaintenance({ enabled: true, reason, userId: interaction.user.id });
      schedulePanelUpdate(interaction.client);

      const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
        .setTitle('🛠️  Maintenance Mode — ON')
        .setDescription(
          `Shop sekarang dalam **maintenance mode**.\n\n` +
          `Customer (non-admin) **tidak bisa /buy** selama mode aktif. Panel akan tampilkan notif maintenance.`,
        )
        .addFields({ name: 'Alasan', value: reason, inline: false })
        .setFooter(guildFooter(interaction.guild, `By ${interaction.user.tag}`));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'off') {
      await setMaintenance({ enabled: false, userId: interaction.user.id });
      schedulePanelUpdate(interaction.client);

      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  Maintenance Mode — OFF`)
        .setDescription('Shop kembali normal. Customer bisa `/buy` lagi.')
        .setFooter(guildFooter(interaction.guild, `By ${interaction.user.tag}`));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'status') {
      const status = await getMaintenanceStatus();
      const embed = brandEmbed(interaction.guild, { color: status.enabled ? BRAND.warning : BRAND.success })
        .setTitle(status.enabled ? '🛠️  Maintenance — ACTIVE' : `${ICON.sparkle}  Shop Normal`);

      if (status.enabled) {
        const setAtUnix = status.setAt ? Math.floor(new Date(status.setAt).getTime() / 1000) : null;
        const fields = [
          { name: 'Reason', value: status.reason || '_(no reason)_', inline: false },
        ];
        if (setAtUnix) fields.push({ name: 'Since', value: `<t:${setAtUnix}:R>`, inline: true });
        if (status.setBy) fields.push({ name: 'Set by', value: `<@${status.setBy}>`, inline: true });
        embed.addFields(fields);
      } else {
        embed.setDescription('Shop beroperasi normal — tidak ada maintenance aktif.');
      }

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
