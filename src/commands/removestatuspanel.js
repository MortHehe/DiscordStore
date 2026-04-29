const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { removeStatusPanel } = require('../services/statusPanel');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed } = require('../utils/embeds');

const log = createLogger('cmd:removestatuspanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removestatuspanel')
    .setDescription('[Admin] Hapus live status panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const removed = await removeStatusPanel(interaction.client);

    const embed = brandEmbed(interaction.guild, { color: removed ? BRAND.success : BRAND.warning })
      .setTitle(removed ? `${ICON.sparkle}  Status Panel Dihapus` : `${ICON.fire}  Tidak Ada Panel Aktif`);

    await interaction.editReply({ embeds: [embed] });
    if (removed) log.info(`admin ${interaction.user.tag} removed status panel`);
  },
};
