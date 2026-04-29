const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { postStatusPanel, removeStatusPanel, getStatusConfig } = require('../services/statusPanel');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:setstatuspanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setstatuspanel')
    .setDescription('[Admin] Post live bot status panel (auto-refresh tiap 30s)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel untuk panel status')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const existing = await getStatusConfig();
    if (existing) {
      try { await removeStatusPanel(interaction.client); }
      catch (err) { log.warn(`failed to remove old: ${err.message}`); }
    }

    try {
      const message = await postStatusPanel(interaction.client, channel);
      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  Status Panel Posted`)
        .setDescription(`Panel di <#${channel.id}>: ${message.url}\n\nAuto-refresh tiap **30 detik**.`);
      await interaction.editReply({ embeds: [embed] });
      log.info(`admin ${interaction.user.tag} set status panel in #${channel.name}`);
    } catch (err) {
      log.error('setstatuspanel failed:', err);
      await interaction.editReply(`${ICON.boom} Gagal: ${err.message}`);
    }
  },
};
