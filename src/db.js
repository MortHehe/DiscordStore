const { MongoClient } = require('mongodb');
const { createLogger } = require('./utils/logger');

const log = createLogger('db');

let client;
let db;

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'discord_store';
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  const redactedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  log.info(`connecting to ${redactedUri} (db=${dbName})`);

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  await db.collection('products').createIndex({ name: 1 }, { unique: true });
  await db.collection('stock').createIndex({ productId: 1, sold: 1 });
  await db.collection('orders').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('tickets').createIndex({ userId: 1, guildId: 1, status: 1 });
  await db.collection('tickets').createIndex({ channelId: 1 });
  await db.collection('stock').createIndex({ reservationExpiresAt: 1 }, { sparse: true });
  await db.collection('stock').createIndex({ reservationOrderId: 1 }, { sparse: true });

  log.info(`connected (db=${dbName}, indexes ok)`);
}

function getDb() {
  if (!db) throw new Error('Database not connected — call connectDatabase() first');
  return db;
}

const collections = {
  products: () => getDb().collection('products'),
  stock: () => getDb().collection('stock'),
  orders: () => getDb().collection('orders'),
  settings: () => getDb().collection('settings'),
  tickets: () => getDb().collection('tickets'),
};

async function closeDatabase() {
  if (client) {
    await client.close();
    log.info('connection closed');
  }
}

module.exports = { connectDatabase, closeDatabase, getDb, collections };
