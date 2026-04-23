const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { collections } = require('../db');
const { buildTicketPanelEmbed, buildTicketPanelButton } = require('../services/tickets');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed } = require('../utils/embeds');

const log = createLogger('cmd:ticketpanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('[Admin] Post ticket panel dengan tombol Buat Ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel untuk panel ticket')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addChannelOption(o =>
      o.setName('category')
        .setDescription('Category untuk ticket channels yang baru dibuat (opsional)')
        .addChannelTypes(ChannelType.GuildCategory)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const category = interaction.options.getChannel('category');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const embed = buildTicketPanelEmbed(interaction.guild);
      const row = buildTicketPanelButton();
      const msg = await channel.send({ embeds: [embed], components: [row] });

      await collections.settings().updateOne(
        { _id: 'ticketConfig' },
        {
          $set: {
            panelChannelId: channel.id,
            panelMessageId: msg.id,
            categoryId: category?.id ?? null,
            supportRoleId: process.env.ADMIN_ROLE_ID || null,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      const successEmbed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  Ticket Panel Posted`)
        .addFields(
          { name: `${ICON.scroll}  Channel`, value: `<#${channel.id}>`, inline: true },
          { name: `${ICON.block}  Category`, value: category ? `<#${category.id}>` : '_(none — root)_', inline: true },
          { name: `${ICON.key}  Support Role`, value: process.env.ADMIN_ROLE_ID ? `<@&${process.env.ADMIN_ROLE_ID}>` : '_(not set)_', inline: false },
          { name: `${ICON.lightning}  Message`, value: msg.url, inline: false },
        );
      await interaction.editReply({ embeds: [successEmbed] });

      log.info(`admin ${interaction.user.tag} set ticket panel in #${channel.name}`);
    } catch (err) {
      log.error('ticketpanel failed:', err);
      await interaction.editReply(`${ICON.boom} Gagal: ${err.message}`);
    }
  },
};
