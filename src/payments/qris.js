async function createPayment({ orderId, amount, userId }) {
  return {
    ref: `QRIS-${orderId}`,
    instructions:
      'Scan QRIS untuk membayar. Setelah transfer, admin akan konfirmasi order.\n' +
      '_(Integrasi QRIS otomatis belum aktif — ini placeholder.)_',
    qrImageUrl: null,
  };
}

async function verifyPayment(ref) {
  return { paid: false };
}

module.exports = { createPayment, verifyPayment };
