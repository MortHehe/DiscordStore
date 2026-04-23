const crypto = require('node:crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('payment:paydisini');

const BASE_URL = 'https://paydisini.co.id/api/';
const SERVICE_QRIS = '11';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

async function apiPost(body) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; PixelShopBot/1.0; +https://discord.com)',
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Paydisini HTTP ${res.status}: ${snippet}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Paydisini returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function requireApiKey() {
  const key = process.env.PAYDISINI_API_KEY;
  if (!key || key.startsWith('your_') || key === 'paste_here') {
    throw new Error('PAYDISINI_API_KEY not set in .env');
  }
  return key;
}

async function createPayment({ orderId, amount, userId }) {
  const apiKey = requireApiKey();
  const validTime = String(Number(process.env.PAYDISINI_VALID_TIME) || 840);
  const uniqueCode = orderId.toString();
  const service = SERVICE_QRIS;
  const amountStr = String(Math.round(amount));

  const signature = md5(apiKey + uniqueCode + service + amountStr + validTime + 'NewTransaction');

  const body = {
    key: apiKey,
    request: 'new',
    unique_code: uniqueCode,
    service,
    amount: amountStr,
    note: `Pixel Shop order #${uniqueCode.slice(-8)}`,
    valid_time: validTime,
    type_fee: '1',
    signature,
  };

  const callbackUrl = process.env.PAYDISINI_CALLBACK_URL;
  if (callbackUrl) body.return_url = callbackUrl;

  const response = await apiPost(body);
  if (!response.success) {
    log.warn(`createPayment failed: ${response.msg || 'unknown'}`);
    throw new Error(`Paydisini: ${response.msg || 'unknown error'}`);
  }

  const data = response.data || {};
  const checkoutUrl = data.checkout_url_v2 || data.checkout_url || null;

  log.info(`paydisini trx created: ${uniqueCode} amount=${data.amount} fee=${data.fee}`);

  return {
    ref: uniqueCode,
    instructions: [
      `**Scan QRIS** di bawah untuk bayar, atau buka:`,
      checkoutUrl ? `🔗  ${checkoutUrl}` : '',
      '',
      `_Payment akan otomatis terkonfirmasi dalam beberapa detik setelah dibayar._`,
    ].filter(Boolean).join('\n'),
    qrImageUrl: data.qrcode_url || null,
    checkoutUrl,
    amount: Number(data.amount) || Number(amountStr),
    fee: Number(data.fee) || 0,
  };
}

async function verifyPayment(ref) {
  const apiKey = requireApiKey();
  const signature = md5(apiKey + ref + 'StatusTransaction');

  const response = await apiPost({
    key: apiKey,
    request: 'status',
    unique_code: ref,
    signature,
  });

  if (!response.success) {
    return { paid: false, cancelled: false, pending: false, status: 'error', error: response.msg };
  }

  const status = response.data?.status;
  return {
    paid: status === 'Success',
    cancelled: status === 'Canceled',
    pending: status === 'Pending',
    status,
  };
}

async function cancelPayment(ref) {
  const apiKey = requireApiKey();
  const signature = md5(apiKey + ref + 'CancelTransaction');

  const response = await apiPost({
    key: apiKey,
    request: 'cancel',
    unique_code: ref,
    signature,
  });

  return response;
}

function verifyCallbackSignature({ key, unique_code, signature }) {
  if (!key || !unique_code || !signature) return false;
  const expected = md5(key + unique_code + 'CallbackStatus');
  return expected === signature;
}

module.exports = { createPayment, verifyPayment, cancelPayment, verifyCallbackSignature };
