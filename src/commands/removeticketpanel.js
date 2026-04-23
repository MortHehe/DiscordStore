const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed } = require('../utils/embeds');

const log = createLogger('cmd:removeticketpanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeticketpanel')
    .setDescription('[Admin] Hapus ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const config = await collections.settings().findOne({ _id: 'ticketConfig' });
    if (!config || !config.panelMessageId) {
      return interaction.editReply('Tidak ada ticket panel yang aktif.');
    }

    let deleted = false;
    try {
      const channel = await interaction.client.channels.fetch(config.panelChannelId);
      const message = await channel.messages.fetch(config.panelMessageId);
      await message.delete();
      deleted = true;
    } catch (err) {
      log.warn(`panel message already gone or inaccessible: ${err.message}`);
    }

    await collections.settings().deleteOne({ _id: 'ticketConfig' });

    const embed = brandEmbed(interaction.guild, { color: BRAND.success })
      .setTitle(`${ICON.sparkle}  Ticket Panel Dihapus`)
      .setDescription(
        deleted
          ? 'Panel message dihapus & config dibersihkan.'
          : 'Panel message sudah tidak ada, config dibersihkan.',
      );

    await interaction.editReply({ embeds: [embed] });
    log.info(`admin ${interaction.user.tag} removed ticket panel`);
  },
};
