const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { postPanel, getPanelConfig, removePanel } = require('../services/panel');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:setpanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setpanel')
    .setDescription('[Admin] Post live stock panel di channel (auto-update)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel untuk panel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const existing = await getPanelConfig();
    if (existing) {
      try {
        await removePanel(interaction.client);
      } catch (err) {
        log.warn(`failed to remove old panel: ${err.message}`);
      }
    }

    try {
      const message = await postPanel(interaction.client, channel);
      await interaction.editReply(
        `✅ Panel dibuat di <#${channel.id}>: ${message.url}\n` +
        `Panel akan otomatis update ketika produk/stock/order berubah.`
      );
      log.info(`admin ${interaction.user.tag} set panel in #${channel.name}`);
    } catch (err) {
      log.error('setpanel failed:', err);
      await interaction.editReply(`❌ Gagal post panel: ${err.message}`);
    }
  },
};
