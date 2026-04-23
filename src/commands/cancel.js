const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ObjectId } = require('mongodb');
const { cancelOrder, DeliveryError } = require('../services/delivery');
const { schedulePanelUpdate } = require('../services/panel');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:cancel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('[Admin] Batalkan order pending & lepas reservasi stok')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('order').setDescription('Order ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(false)),

  async execute(interaction) {
    const orderStr = interaction.options.getString('order');
    const reason = interaction.options.getString('reason') || 'cancelled by admin';

    let orderId;
    try {
      orderId = new ObjectId(orderStr);
    } catch {
      return interaction.reply({ content: `❌ Order ID tidak valid: \`${orderStr}\``, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await cancelOrder(orderId, reason);
      await interaction.editReply(`✅ Order \`${orderId}\` dibatalkan. Stok dilepas kembali.`);
      log.info(`admin ${interaction.user.tag} cancelled order ${orderId}`);
      schedulePanelUpdate(interaction.client);
    } catch (err) {
      if (err instanceof DeliveryError) {
        return interaction.editReply(`❌ **${err.code}** — ${err.message}`);
      }
      throw err;
    }
  },
};
