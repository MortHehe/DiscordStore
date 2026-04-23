function formatIDR(amount) {
  return `Rp${Number(amount).toLocaleString('id-ID')}`;
}

module.exports = { formatIDR };
