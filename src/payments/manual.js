async function createPayment({ orderId, amount, userId }) {
  return {
    ref: `MANUAL-${orderId}`,
    instructions:
      '**Hubungi admin** untuk instruksi pembayaran.\n' +
      'Sertakan **Order ID** di atas saat konfirmasi payment.\n\n' +
      '_Setelah admin verifikasi payment, item akan dikirim otomatis via DM._',
    qrImageUrl: null,
    checkoutUrl: null,
    amount,
    fee: 0,
  };
}

async function verifyPayment() {
  return { paid: false, cancelled: false, pending: true, status: 'manual' };
}

module.exports = { createPayment, verifyPayment };
