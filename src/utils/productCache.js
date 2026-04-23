const { collections } = require('../db');
const { createLogger } = require('./logger');

const log = createLogger('cache:products');
const TTL_MS = 30_000;

let cache = [];
let lastFetch = 0;
let inflight = null;

async function refresh() {
  try {
    const rows = await collections.products()
      .find({}, { projection: { name: 1 } })
      .toArray();
    cache = rows.map(r => r.name).sort((a, b) => a.localeCompare(b));
    lastFetch = Date.now();
    log.debug(`refreshed (${cache.length} products)`);
  } catch (err) {
    log.warn('refresh failed, keeping stale cache:', err.message);
  }
}

async function getProductNames() {
  if (Date.now() - lastFetch < TTL_MS) return cache;
  if (!inflight) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  await inflight;
  return cache;
}

function invalidateProductCache() {
  lastFetch = 0;
}

function filterMatches(query, limit = 25) {
  const q = (query || '').toLowerCase();
  if (!q) return cache.slice(0, limit);
  return cache.filter(n => n.toLowerCase().includes(q)).slice(0, limit);
}

module.exports = { getProductNames, invalidateProductCache, filterMatches };
