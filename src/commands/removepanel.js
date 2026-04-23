const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { removePanel } = require('../services/panel');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:removepanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removepanel')
    .setDescription('[Admin] Hapus live stock panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const removed = await removePanel(interaction.client);
    if (removed) {
      await interaction.editReply('✅ Panel dihapus.');
      log.info(`admin ${interaction.user.tag} removed panel`);
    } else {
      await interaction.editReply('Tidak ada panel yang aktif.');
    }
  },
};
