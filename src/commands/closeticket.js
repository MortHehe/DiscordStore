const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { collections } = require('../db');
const { closeTicket } = require('../services/tickets');
const { BRAND, ICON, brandEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('closeticket')
    .setDescription('[Admin] Tutup ticket yang aktif di channel ini')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('reason').setDescription('Alasan penutupan').setRequired(false)),

  async execute(interaction) {
    const ticket = await collections.tickets().findOne({
      channelId: interaction.channel.id,
      status: 'open',
    });
    if (!ticket) {
      return interaction.reply({
        content: 'Ini bukan ticket channel atau sudah ditutup.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const reason = interaction.options.getString('reason') ?? '';

    const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
      .setTitle(`${ICON.shield}  Ticket Ditutup`)
      .setDescription(
        `Ditutup oleh **${interaction.user.tag}**${reason ? `\n\n_Alasan:_ ${reason}` : ''}\n\n` +
        `Channel akan dihapus dalam 5 detik...`,
      );
    await interaction.reply({ embeds: [embed] });

    setTimeout(() => {
      closeTicket(interaction.client, interaction.channel.id, interaction.user.tag, reason)
        .catch(() => { /* log inside service */ });
    }, 5000);
  },
};
