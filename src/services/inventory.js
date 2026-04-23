const { ObjectId } = require('mongodb');
const { collections } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('inventory');

const MAX_RESERVE_ATTEMPTS = 3;
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const BACKOFF_MIN_MS = 40;
const BACKOFF_MAX_MS = 120;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter() {
  return BACKOFF_MIN_MS + Math.random() * (BACKOFF_MAX_MS - BACKOFF_MIN_MS);
}

async function reserveStock({ productId, userId, orderId, quantity }) {
  let raceDetails = null;

  for (let attempt = 1; attempt <= MAX_RESERVE_ATTEMPTS; attempt++) {
    const candidates = await collections.stock()
      .find(
        { productId, sold: false, reservedBy: { $exists: false } },
        { projection: { _id: 1 } },
      )
      .limit(quantity)
      .toArray();

    if (candidates.length < quantity) {
      return {
        success: false,
        reason: 'INSUFFICIENT_STOCK',
        available: candidates.length,
        requested: quantity,
      };
    }

    const ids = candidates.map(c => c._id);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

    const res = await collections.stock().updateMany(
      { _id: { $in: ids }, sold: false, reservedBy: { $exists: false } },
      {
        $set: {
          reservedBy: userId,
          reservedAt: now,
          reservationOrderId: orderId,
          reservationExpiresAt: expiresAt,
        },
      },
    );

    if (res.modifiedCount === quantity) {
      const reservedStockIds = (await collections.stock()
        .find({ reservationOrderId: orderId }, { projection: { _id: 1 } })
        .toArray()).map(s => s._id);

      if (attempt > 1) {
        log.info(`reserved ${quantity} stock on attempt ${attempt} for order ${orderId}`);
      }
      return { success: true, stockIds: reservedStockIds, expiresAt, attempt };
    }

    raceDetails = `attempt ${attempt}: got ${res.modifiedCount}/${quantity}`;
    log.warn(`race detected on order ${orderId} — ${raceDetails}`);

    await releaseReservation(orderId);

    if (attempt < MAX_RESERVE_ATTEMPTS) {
      await sleep(jitter() * attempt);
    }
  }

  return {
    success: false,
    reason: 'RACE_EXHAUSTED',
    detail: raceDetails,
    attempts: MAX_RESERVE_ATTEMPTS,
  };
}

async function releaseReservation(orderId) {
  const res = await collections.stock().updateMany(
    { reservationOrderId: orderId, sold: false },
    {
      $unset: {
        reservedBy: '',
        reservedAt: '',
        reservationOrderId: '',
        reservationExpiresAt: '',
      },
    },
  );
  return res.modifiedCount;
}

async function cleanupExpiredReservations(client = null) {
  const now = new Date();

  const expiredStocks = await collections.stock()
    .find(
      { sold: false, reservationExpiresAt: { $lt: now } },
      { projection: { reservationOrderId: 1 } },
    )
    .toArray();

  if (expiredStocks.length === 0) {
    return { releasedStocks: 0, cancelledOrders: 0 };
  }

  const orderIdSet = new Set();
  for (const s of expiredStocks) {
    if (s.reservationOrderId) orderIdSet.add(s.reservationOrderId.toString());
  }

  const released = await collections.stock().updateMany(
    { sold: false, reservationExpiresAt: { $lt: now } },
    {
      $unset: {
        reservedBy: '',
        reservedAt: '',
        reservationOrderId: '',
        reservationExpiresAt: '',
      },
    },
  );

  let cancelledCount = 0;
  if (orderIdSet.size > 0) {
    const orderObjectIds = [...orderIdSet].map(id => new ObjectId(id));

    const ordersToCancel = await collections.orders()
      .find({ _id: { $in: orderObjectIds }, status: 'pending' })
      .toArray();

    const orderRes = await collections.orders().updateMany(
      { _id: { $in: orderObjectIds }, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: 'reservation_expired',
        },
      },
    );
    cancelledCount = orderRes.modifiedCount;

    if (client) {
      const { markPaymentExpired } = require('./invoiceUpdater');
      await Promise.all(
        ordersToCancel
          .filter(o => o.invoiceInteractionToken)
          .map(o => markPaymentExpired(client, o).catch(() => {})),
      );
    }
  }

  log.info(`cleanup: released ${released.modifiedCount} stock(s), cancelled ${cancelledCount} expired order(s)`);
  return { releasedStocks: released.modifiedCount, cancelledOrders: cancelledCount };
}

let cleanupInterval = null;

function startCleanupJob(client, { onRelease } = {}) {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(async () => {
    try {
      const result = await cleanupExpiredReservations(client);
      if (result.releasedStocks > 0 && onRelease) {
        await onRelease(client, result);
      }
    } catch (err) {
      log.warn(`cleanup job failed: ${err.message}`);
    }
  }, 60_000);

  log.info('cleanup job started (every 60s, TTL 15min)');
}

function stopCleanupJob() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

module.exports = {
  reserveStock,
  releaseReservation,
  cleanupExpiredReservations,
  startCleanupJob,
  stopCleanupJob,
  RESERVATION_TTL_MS,
};
