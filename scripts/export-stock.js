require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const productFilter = getArg('--product');
const soldFilter = getArg('--sold');
const beforeArg = getArg('--before');
const afterArg = getArg('--after');
const fieldArg = getArg('--field');
const excludeOrdersArg = getArg('--exclude-orders');
const includeOrdersArg = getArg('--include-orders');
const outFile = getArg('--out') || `stock-export-${new Date().toISOString().slice(0, 10)}.txt`;

function parseObjectIds(csv) {
  if (!csv) return [];
  return csv.split(/[\s,]+/).filter(Boolean).map(id => {
    try { return new ObjectId(id); }
    catch { throw new Error(`Invalid ObjectId: ${id}`); }
  });
}

const excludeOrders = parseObjectIds(excludeOrdersArg);
const includeOrders = parseObjectIds(includeOrdersArg);

function parseTimeArg(input) {
  if (!input) return null;

  const isoMatch = /^\d{4}-\d{2}-\d{2}/.test(input);
  if (isoMatch) {
    const d = new Date(input);
    if (!isNaN(d)) return d;
  }

  const timeMatch = input.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (timeMatch) {
    let [, hh, mm, ap] = timeMatch;
    let hours = parseInt(hh, 10);
    const minutes = parseInt(mm, 10);
    if (ap) {
      const isPM = ap.toLowerCase() === 'pm';
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  const d = new Date(input);
  if (!isNaN(d)) return d;
  return null;
}

const before = parseTimeArg(beforeArg);
const after = parseTimeArg(afterArg);
const timeField = fieldArg || (soldFilter === 'true' ? 'soldAt' : 'createdAt');

(async () => {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'discord_store';
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  let productId = null;
  let productName = '(all products)';
  if (productFilter) {
    const product = await db.collection('products').findOne({ name: productFilter });
    if (!product) {
      console.error(`Product "${productFilter}" not found`);
      process.exit(1);
    }
    productId = product._id;
    productName = product.name;
  }

  const match = {};
  if (productId) match.productId = productId;
  if (soldFilter === 'true') match.sold = true;
  if (soldFilter === 'false') match.sold = false;

  if (before || after) {
    match[timeField] = {};
    if (before) match[timeField].$lt = before;
    if (after) match[timeField].$gte = after;
  }

  if (excludeOrders.length > 0) {
    match.soldToOrder = { ...(match.soldToOrder || {}), $nin: excludeOrders };
  }
  if (includeOrders.length > 0) {
    match.soldToOrder = { ...(match.soldToOrder || {}), $in: includeOrders };
  }

  const stocks = await db.collection('stock')
    .find(match, { projection: { content: 1, sold: 1, productId: 1, createdAt: 1, soldAt: 1 } })
    .toArray();

  const soldCount = stocks.filter(s => s.sold).length;
  const unsoldCount = stocks.length - soldCount;

  const lines = stocks.map(s => s.content);
  fs.writeFileSync(path.resolve(outFile), lines.join('\n'), 'utf8');

  console.log('─'.repeat(60));
  console.log(`Product  : ${productName}`);
  console.log(`Filter   : ${soldFilter ? `sold=${soldFilter}` : 'all (sold + unsold)'}`);
  if (before || after) {
    console.log(`Time     : ${timeField} ${after ? `>= ${after.toLocaleString()}` : ''}${before ? ` < ${before.toLocaleString()}` : ''}`);
  }
  if (excludeOrders.length > 0) {
    console.log(`Exclude  : ${excludeOrders.length} order(s) excluded via soldToOrder`);
  }
  if (includeOrders.length > 0) {
    console.log(`Include  : ${includeOrders.length} order(s) only via soldToOrder`);
  }
  console.log(`Total    : ${stocks.length}`);
  console.log(`  sold   : ${soldCount}`);
  console.log(`  unsold : ${unsoldCount}`);
  console.log(`Output   : ${path.resolve(outFile)}`);
  console.log('─'.repeat(60));

  await client.close();
})().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
