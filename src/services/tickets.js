const {
  ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { ObjectId } = require('mongodb');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, DIVIDER, brandEmbed } = require('../utils/embeds');

const log = createLogger('tickets');

async function getOpenTicketForUser(guildId, userId) {
  return collections.tickets().findOne({ guildId, userId, status: 'open' });
}

async function openTicket(client, guild, user, { categoryId, supportRoleId } = {}) {
  const existing = await getOpenTicketForUser(guild.id, user.id);
  if (existing) {
    const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) return { existing: true, channel, ticket: existing };
    await collections.tickets().updateOne(
      { _id: existing._id },
      { $set: { status: 'closed', closedAt: new Date(), closeReason: 'channel missing' } },
    );
  }

  const ticketId = new ObjectId();

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  if (supportRoleId) {
    overwrites.push({
      id: supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'player';
  const channelName = `ticket-${safeName}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: `Ticket for ${user.tag} (${user.id}) • ID: ${ticketId}`,
    permissionOverwrites: overwrites,
  });

  await collections.tickets().insertOne({
    _id: ticketId,
    userId: user.id,
    guildId: guild.id,
    channelId: channel.id,
    status: 'open',
    createdAt: new Date(),
  });

  const welcomeEmbed = brandEmbed(guild, { color: BRAND.gem })
    .setAuthor({
      name: `${guild?.name ?? 'Pixel Shop'}  •  Support Ticket`,
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`${ICON.scroll}  Ticket Support`)
    .setDescription([
      `${ICON.player}  Halo <@${user.id}>!`,
      `Terima kasih telah menghubungi support team **${guild?.name ?? 'kami'}**.`,
      '',
      DIVIDER,
      '',
      `${ICON.sparkle}  Silakan jelaskan **masalah atau pertanyaan** kamu di channel ini.`,
      `Admin akan segera membalas.`,
      '',
      `${ICON.lightning}  **Tips cepat:**`,
      `• Sertakan Order ID jika terkait pembelian`,
      `• Lampirkan screenshot jika ada`,
      `• Jelaskan sedetail mungkin`,
    ].join('\n'))
    .setFooter({
      text: `Ticket ID: ${ticketId}`,
      iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
    });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  const mention = supportRoleId ? `<@&${supportRoleId}> ` : '';
  await channel.send({
    content: `${mention}<@${user.id}>`,
    embeds: [welcomeEmbed],
    components: [closeRow],
  });

  log.info(`ticket opened: ${ticketId} for ${user.tag} in #${channel.name}`);
  return { existing: false, channel, ticket: { _id: ticketId } };
}

async function closeTicket(client, channelId, closedBy, reason = '') {
  const ticket = await collections.tickets().findOne({ channelId, status: 'open' });
  if (!ticket) return { notFound: true };

  await collections.tickets().updateOne(
    { _id: ticket._id },
    { $set: { status: 'closed', closedAt: new Date(), closedBy, closeReason: reason || null } },
  );

  try {
    const channel = await client.channels.fetch(channelId);
    await channel.delete(`Ticket closed by ${closedBy}${reason ? ` — ${reason}` : ''}`);
  } catch (err) {
    log.warn(`failed to delete ticket channel ${channelId}: ${err.message}`);
  }

  log.info(`ticket ${ticket._id} closed by ${closedBy}`);
  return { closed: true, ticket };
}

function buildTicketPanelEmbed(guild) {
  return brandEmbed(guild, { color: BRAND.pixel })
    .setAuthor({
      name: `${guild?.name ?? 'Pixel Shop'}  •  Support Center`,
      iconURL: guild?.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`${ICON.scroll}  SUPPORT TICKETS  ${ICON.scroll}`)
    .setDescription([
      `${ICON.player}  _Butuh bantuan? Admin siap membantu!_`,
      '',
      DIVIDER,
      '',
      `${ICON.sparkle}  **Klik tombol di bawah** untuk membuka private ticket dengan admin.`,
      '',
      `${ICON.key}  **Contoh topik yang dapat di-ticket:**`,
      `${ICON.crystal}  Pembayaran tidak terkonfirmasi`,
      `${ICON.crystal}  Item yang diterima bermasalah`,
      `${ICON.crystal}  Pertanyaan seputar produk`,
      `${ICON.crystal}  Request item baru / custom`,
      '',
      DIVIDER,
    ].join('\n'))
    .setFooter({
      text: `${guild?.name ?? 'Pixel Shop'}  •  1 player = 1 ticket aktif`,
      iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
    });
}

function buildTicketPanelButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:create')
      .setLabel('Buat Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );
}

module.exports = {
  openTicket,
  closeTicket,
  getOpenTicketForUser,
  buildTicketPanelEmbed,
  buildTicketPanelButton,
};
