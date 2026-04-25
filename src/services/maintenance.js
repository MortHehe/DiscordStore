const { collections } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('maintenance');
const MAINTENANCE_ID = 'maintenance';

async function getMaintenanceStatus() {
  const doc = await collections.settings().findOne({ _id: MAINTENANCE_ID });
  return {
    enabled: Boolean(doc?.enabled),
    reason: doc?.reason || null,
    setAt: doc?.setAt || null,
    setBy: doc?.setBy || null,
  };
}

async function setMaintenance({ enabled, reason = null, userId }) {
  await collections.settings().updateOne(
    { _id: MAINTENANCE_ID },
    {
      $set: {
        enabled,
        reason: enabled ? reason : null,
        setAt: new Date(),
        setBy: userId,
      },
    },
    { upsert: true },
  );
  log.info(`maintenance ${enabled ? 'ENABLED' : 'DISABLED'} by ${userId}${reason ? ` (${reason})` : ''}`);
}

module.exports = { getMaintenanceStatus, setMaintenance };
