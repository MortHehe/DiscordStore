const { collections } = require('../db');
const { verifyPayment } = require('../payments');
const { deliverOrder, DeliveryError } = require('./delivery');
const { schedulePanelUpdate } = require('./panel');
const { createLogger } = require('../utils/logger');

const log = createLogger('payment:poller');

let pollInterval = null;
let isPolling = false;

async function pollOnce(client) {
  if (isPolling) return;
  isPolling = true;

  try {
    const pendingOrders = await collections.orders()
      .find({
        status: 'pending',
        paymentRef: { $exists: true, $ne: null },
      })
      .toArray();

    if (pendingOrders.length === 0) return;

    log.debug(`checking ${pendingOrders.length} pending order(s)`);

    for (const order of pendingOrders) {
      try {
        const result = await verifyPayment(order.paymentRef);

        if (result.paid) {
          log.info(`payment confirmed for ${order._id} (${order.paymentRef}) — delivering`);
          try {
            await deliverOrder(client, order._id, { paymentRef: order.paymentRef });
            schedulePanelUpdate(client);
          } catch (err) {
            if (err instanceof DeliveryError) {
              log.warn(`delivery skipped ${order._id}: [${err.code}] ${err.message}`);
            } else {
              log.error(`delivery failed ${order._id}:`, err);
            }
          }
        } else if (result.cancelled) {
          log.info(`paydisini cancelled ${order._id}, syncing local state`);
          await collections.orders().updateOne(
            { _id: order._id, status: 'pending' },
            { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'paydisini_cancelled' } },
          );
          await collections.stock().updateMany(
            { reservationOrderId: order._id, sold: false },
            { $unset: { reservedBy: '', reservedAt: '', reservationOrderId: '', reservationExpiresAt: '' } },
          );
          schedulePanelUpdate(client);
        }
      } catch (err) {
        log.warn(`status check failed for ${order._id}: ${err.message}`);
      }
    }
  } finally {
    isPolling = false;
  }
}

function startPaymentPoller(client) {
  if (pollInterval) return;
  const provider = (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();
  if (provider === 'manual' || provider === 'none' || provider === 'off') {
    log.info(`payment poller disabled (provider=${provider}) — use /confirm to deliver manually`);
    return;
  }

  if (provider === 'autogopay') {
    const mode = (process.env.AUTOGOPAY_CONFIRM_MODE || 'polling').toLowerCase();
    if (mode === 'webhook') {
      log.info('payment poller disabled (autogopay mode=webhook) — using webhook only');
      return;
    }
  }

  const seconds = Math.max(5, Number(process.env.PAYMENT_POLL_INTERVAL) || 15);
  pollInterval = setInterval(() => {
    pollOnce(client).catch(err => log.warn(`poll loop error: ${err.message}`));
  }, seconds * 1000);
  log.info(`payment poller started (every ${seconds}s, provider=${provider})`);
}

function stopPaymentPoller() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = { startPaymentPoller, stopPaymentPoller, pollOnce };
