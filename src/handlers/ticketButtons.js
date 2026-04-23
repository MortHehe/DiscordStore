const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { openTicket, closeTicket } = require('../services/tickets');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed } = require('../utils/embeds');

const log = createLogger('ticket:btn');

async function getTicketConfig() {
  return collections.settings().findOne({ _id: 'ticketConfig' });
}

async function handleTicketButton(interaction, action, rest) {
  if (action === 'create') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await getTicketConfig();
    const supportRoleId = config?.supportRoleId || process.env.ADMIN_ROLE_ID || null;

    try {
      const result = await openTicket(
        interaction.client,
        interaction.guild,
        interaction.user,
        { categoryId: config?.categoryId ?? null, supportRoleId },
      );

      if (result.existing) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.warning })
          .setTitle(`${ICON.fire}  Ticket Sudah Ada`)
          .setDescription(`Kamu sudah punya ticket aktif: <#${result.channel.id}>\n\n_Tutup ticket yang ada dulu untuk membuka yang baru._`);
        return interaction.editReply({ embeds: [embed] });
      }

      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.sparkle}  Ticket Dibuat`)
        .setDescription(`Ticket kamu sudah siap: <#${result.channel.id}>\n\n_Silakan ke channel tersebut untuk chat dengan admin._`);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      log.error('openTicket failed:', err);
      return interaction.editReply({
        content: `${ICON.boom} Gagal membuat ticket: ${err.message}`,
      });
    }
  }

  if (action === 'close') {
    const ticket = await collections.tickets().findOne({ channelId: interaction.channel.id });
    if (!ticket) {
      return interaction.reply({
        content: 'Ticket tidak ditemukan di channel ini.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (ticket.status !== 'open') {
      return interaction.reply({
        content: 'Ticket sudah ditutup.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = ticket.userId === interaction.user.id;
    if (!isAdmin && !isOwner) {
      return interaction.reply({
        content: 'Hanya admin atau pemilik ticket yang bisa menutup.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
      .setTitle(`${ICON.shield}  Ticket Ditutup`)
      .setDescription(
        `Ticket ini ditutup oleh **${interaction.user.tag}**.\n\n` +
        `Channel akan dihapus dalam 5 detik...`,
      );
    await interaction.reply({ embeds: [embed] });

    setTimeout(async () => {
      try {
        await closeTicket(interaction.client, interaction.channel.id, interaction.user.tag);
      } catch (err) {
        log.error('close on timeout failed:', err);
      }
    }, 5000);
    return;
  }
}

module.exports = { handleTicketButton };
