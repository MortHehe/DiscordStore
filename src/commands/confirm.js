const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ObjectId } = require('mongodb');
const { deliverOrder, DeliveryError } = require('../services/delivery');
const { schedulePanelUpdate } = require('../services/panel');
const { formatIDR } = require('../utils/format');
const { createLogger } = require('../utils/logger');
const { BRAND, ICON, brandEmbed, guildFooter } = require('../utils/embeds');

const log = createLogger('cmd:confirm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('[Admin] Konfirmasi payment & kirim loot ke buyer')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('order').setDescription('Order ID').setRequired(true))
    .addStringOption(o => o.setName('ref').setDescription('Referensi payment (opsional)').setRequired(false)),

  async execute(interaction) {
    const orderStr = interaction.options.getString('order');
    const ref = interaction.options.getString('ref');

    let orderId;
    try { orderId = new ObjectId(orderStr); }
    catch {
      const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
        .setTitle(`${ICON.boom}  Order ID Tidak Valid`)
        .setDescription(`\`${orderStr}\` bukan format Order ID yang valid.`);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const { product, user, order } = await deliverOrder(interaction.client, orderId, { paymentRef: ref });

      const embed = brandEmbed(interaction.guild, { color: BRAND.success })
        .setTitle(`${ICON.trophy}  Quest Completed`)
        .setDescription(`Loot telah dikirim ke player.`)
        .addFields(
          { name: `${ICON.scroll}  Order`, value: `\`${order._id}\``, inline: false },
          { name: `${ICON.product}  Item`, value: product.name, inline: true },
          { name: `${ICON.crystal}  Total`, value: formatIDR(order.price), inline: true },
          { name: `${ICON.player}  Player`, value: `${user.tag}\n\`${user.id}\``, inline: true },
          { name: `${ICON.lightning}  Payment Ref`, value: ref ? `\`${ref}\`` : '_(tidak diset)_', inline: false },
        )
        .setFooter(guildFooter(interaction.guild, 'DM sudah dikirim ke player'));

      await interaction.editReply({ embeds: [embed] });
      log.info(`admin ${interaction.user.tag} confirmed order ${orderId}`);
      schedulePanelUpdate(interaction.client);
    } catch (err) {
      if (err instanceof DeliveryError) {
        const embed = brandEmbed(interaction.guild, { color: BRAND.danger })
          .setTitle(`${ICON.boom}  ${err.code}`)
          .setDescription(err.message);
        return interaction.editReply({ embeds: [embed] });
      }
      log.error('confirm failed:', err);
      await interaction.editReply('❌ Error tidak terduga — cek log.');
    }
  },
};
