const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ObjectId } = require('mongodb');
const { resendOrder, DeliveryError } = require('../services/delivery');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:resend');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resend')
    .setDescription('[Admin] Kirim ulang DM untuk order yang sudah completed')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('order').setDescription('Order ID').setRequired(true)),

  async execute(interaction) {
    const orderStr = interaction.options.getString('order');

    let orderId;
    try {
      orderId = new ObjectId(orderStr);
    } catch {
      return interaction.reply({ content: `❌ Order ID tidak valid: \`${orderStr}\``, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const { user, product } = await resendOrder(interaction.client, orderId);
      await interaction.editReply(`✅ DM dikirim ulang ke **${user.tag}** untuk produk **${product.name}**.`);
      log.info(`admin ${interaction.user.tag} resent order ${orderId}`);
    } catch (err) {
      if (err instanceof DeliveryError) {
        return interaction.editReply(`❌ **${err.code}** — ${err.message}`);
      }
      if (err.code === 50007) {
        return interaction.editReply('❌ Buyer masih menutup DM — minta mereka aktifkan dulu.');
      }
      log.error('resend failed:', err);
      throw err;
    }
  },
};
