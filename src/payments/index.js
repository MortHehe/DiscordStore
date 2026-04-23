const paydisini = require('./paydisini');
const manual = require('./manual');
const autogopay = require('./autogopay');

const providers = { paydisini, manual, autogopay };
const active = (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();

function getProvider() {
  const provider = providers[active];
  if (!provider) throw new Error(`Unknown payment provider: ${active}`);
  return provider;
}

async function createPayment(order) {
  return getProvider().createPayment(order);
}

async function verifyPayment(ref) {
  return getProvider().verifyPayment(ref);
}

async function cancelPayment(ref) {
  const provider = getProvider();
  if (provider.cancelPayment) return provider.cancelPayment(ref);
  return null;
}

module.exports = { createPayment, verifyPayment, cancelPayment, getProvider };
