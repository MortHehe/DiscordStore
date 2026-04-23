const crypto = require('node:crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('payment:autogopay');
const BASE_URL = 'https://v1-gateway.autogopay.site';

function requireApiKey() {
  const key = process.env.AUTOGOPAY_API_KEY;
  if (!key || key.startsWith('paste_')) {
    throw new Error('AUTOGOPAY_API_KEY not set in .env');
  }
  return key;
}

async function apiRequest(path, body) {
  const apiKey = requireApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Mozilla/5.0 (compatible; PixelShopBot/1.0)',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`AutoGoPay non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || data.success === false) {
    throw new Error(`AutoGoPay ${path}: ${data.message || `HTTP ${res.status}`}`);
  }
  return data;
}

async function createPayment({ orderId, amount }) {
  const resp = await apiRequest('/qris/generate', {
    amount: Math.round(amount),
  });

  const d = resp.data || resp;
  const txId = d.transaction_id;
  const expiresAt = d.expiry_time ? new Date(d.expiry_time) : null;

  log.info(`trx ${txId} created for order ${orderId} amount=${amount}`);

  return {
    ref: txId,
    instructions: [
      '**Scan QRIS** di bawah untuk bayar sekarang.',
      '',
      '_Payment akan otomatis terkonfirmasi beberapa detik setelah dibayar._',
    ].join('\n'),
    qrImageUrl: d.qr_url || null,
    qrString: d.qr_string || null,
    amount: Number(d.amount) || amount,
    expiresAt,
  };
}

async function verifyPayment(ref) {
  try {
    const resp = await apiRequest('/qris/status', { transaction_id: ref });
    const d = resp.data || resp;
    const status = d.transaction_status || d.status;
    return {
      paid: status === 'settlement',
      cancelled: status === 'cancel',
      expired: status === 'expire',
      pending: status === 'pending',
      status,
    };
  } catch (err) {
    return { paid: false, status: 'error', error: err.message };
  }
}

async function cancelPayment(ref) {
  try {
    return await apiRequest('/qris/cancel', { transaction_id: ref });
  } catch (err) {
    log.warn(`cancel ${ref} failed: ${err.message}`);
    return null;
  }
}

function verifyCallbackSignature({ rawBody, signatureHeader }) {
  if (!rawBody || !signatureHeader) return false;
  const apiKey = requireApiKey();
  const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { createPayment, verifyPayment, cancelPayment, verifyCallbackSignature };
