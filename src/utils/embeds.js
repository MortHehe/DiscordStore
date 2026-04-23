const { EmbedBuilder } = require('discord.js');

const BRAND = {
  primary: 0x9b59b6,
  success: 0x2ecc71,
  warning: 0xe67e22,
  danger: 0xe74c3c,
  gold: 0xf1c40f,
  gem: 0x00b4d8,
  accent: 0xe91e63,
  pixel: 0x6c5ce7,
  info: 0x1abc9c,
};

const DIVIDER = '▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰';
const SOFT_DIVIDER = '▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱';
const BLOCK_LINE = '▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂';

const ICON = {
  shop: '🏰',
  player: '🎮',
  product: '📦',
  gem: '💎',
  gift: '🎁',
  sword: '⚔️',
  shield: '🛡️',
  trophy: '🏆',
  key: '🔑',
  scroll: '📜',
  star: '🌟',
  sparkle: '✨',
  block: '🧱',
  crystal: '💠',
  fire: '🔥',
  clock: '⏰',
  target: '🎯',
  party: '🎉',
  boom: '💥',
  lightning: '⚡',
  controller: '🕹️',
  seedling: '🌱',
};

function brandEmbed(guild, { color = BRAND.pixel, thumbnail = true } = {}) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (thumbnail && guild?.iconURL()) e.setThumbnail(guild.iconURL({ size: 256 }));
  return e;
}

function guildFooter(guild, extra = '') {
  return {
    text: `${guild?.name ?? 'Pixel Shop'}${extra ? `  •  ${extra}` : ''}`,
    iconURL: guild?.iconURL({ size: 64 }) ?? undefined,
  };
}

function stockBadge(n) {
  if (n === 0) return { emoji: '🔴', label: 'Sold Out' };
  if (n < 5) return { emoji: '🟡', label: `${n} tersisa` };
  return { emoji: '🟢', label: `${n} tersedia` };
}

function orderStatusBadge(status) {
  return {
    pending:   { emoji: '⏳', label: 'Menunggu Payment', color: BRAND.warning },
    completed: { emoji: '🏆', label: 'Quest Completed',  color: BRAND.success },
    cancelled: { emoji: '💀', label: 'Quest Failed',     color: BRAND.danger  },
  }[status] ?? { emoji: '❓', label: status, color: BRAND.info };
}

module.exports = {
  BRAND, ICON, DIVIDER, SOFT_DIVIDER, BLOCK_LINE,
  brandEmbed, guildFooter, stockBadge, orderStatusBadge,
};
