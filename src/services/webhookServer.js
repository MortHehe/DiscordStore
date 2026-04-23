const http = require('node:http');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');
const { deliverOrder, DeliveryError } = require('./delivery');
const { releaseReservation } = require('./inventory');
const { markPaymentCancelled } = require('./invoiceUpdater');
const { schedulePanelUpdate } = require('./panel');

const log = createLogger('webhook');

let server = null;

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleAutoGoPay(req, res, client) {
  const rawBody = await readRawBody(req);
  const event = req.headers['x-callback-event'];
  const signatureHeader = req.headers['x-signature'];

  const { verifyCallbackSignature } = require('../payments/autogopay');
  if (!verifyCallbackSignature({ rawBody, signatureHeader })) {
    log.warn(`invalid signature (event=${event}, ip=${req.socket.remoteAddress})`);
    return jsonResponse(res, 403, { success: false, error: 'invalid signature' });
  }

  let data;
  try { data = JSON.parse(rawBody); }
  catch { return jsonResponse(res, 400, { success: false, error: 'invalid json' }); }

  if (event === 'verification.challenge') {
    log.info('webhook verification challenge OK');
    return jsonResponse(res, 200, { success: true });
  }

  if (event === 'transaction.received') {
    const tx = data.transaction || {};
    const ref = tx.id;
    const status = tx.status;
    log.info(`webhook: tx=${ref} status=${status}`);

    const order = await collections.orders().findOne({ paymentRef: ref });
    if (!order) {
      log.warn(`no order for paymentRef=${ref}`);
      return jsonResponse(res, 200, { success: true });
    }

    if (order.status !== 'pending') {
      log.info(`order ${order._id} already ${order.status}, ignoring`);
      return jsonResponse(res, 200, { success: true });
    }

    if (status === 'settlement') {
      try {
        await deliverOrder(client, order._id, { paymentRef: ref });
        schedulePanelUpdate(client);
      } catch (err) {
        if (err instanceof DeliveryError) {
          log.warn(`webhook delivery skipped: [${err.code}] ${err.message}`);
        } else {
          log.error('webhook delivery failed:', err);
        }
      }
    } else if (status === 'cancel' || status === 'expire') {
      await collections.orders().updateOne(
        { _id: order._id, status: 'pending' },
        { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: `webhook_${status}` } },
      );
      await releaseReservation(order._id);
      markPaymentCancelled(client, order, status === 'expire' ? 'expired' : 'dibatalkan').catch(() => {});
      schedulePanelUpdate(client);
    }

    return jsonResponse(res, 200, { success: true });
  }

  log.warn(`unknown event: ${event}`);
  return jsonResponse(res, 200, { success: true });
}

function startWebhookServer(client) {
  const provider = (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();
  if (provider !== 'autogopay') return;

  const mode = (process.env.AUTOGOPAY_CONFIRM_MODE || 'polling').toLowerCase();
  if (mode !== 'webhook' && mode !== 'both') {
    log.info(`webhook server disabled (mode=${mode})`);
    return;
  }

  const port = Number(process.env.AUTOGOPAY_WEBHOOK_PORT) || 3000;
  const path = process.env.AUTOGOPAY_WEBHOOK_PATH || '/autogopay/callback';

  server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return jsonResponse(res, 200, { ok: true });
      }

      const urlPath = req.url.split('?')[0];
      if (req.method === 'POST' && urlPath === path) {
        return handleAutoGoPay(req, res, client);
      }

      jsonResponse(res, 404, { error: 'not found' });
    } catch (err) {
      log.error('request handler error:', err);
      jsonResponse(res, 500, { error: 'internal error' });
    }
  });

  server.listen(port, () => {
    log.info(`webhook server listening on :${port} (path=${path}, mode=${mode})`);
    log.info(`→ expose via ngrok/vps and register at AutoGoPay: https://<public>:${port}${path}`);
  });

  server.on('error', (err) => log.error('server error:', err));
}

function stopWebhookServer() {
  if (server) {
    server.close();
    server = null;
    log.info('webhook server stopped');
  }
}

module.exports = { startWebhookServer, stopWebhookServer };
