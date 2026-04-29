let proxyIndex = 0;
let cachedRaw = null;
let cachedParsed = null;

function loadProxies() {
  if (cachedRaw !== null) return cachedParsed;

  const parsed = [];

  const raw = process.env.MASSLINK_PROXIES || '';
  for (const url of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    parsed.push(parseProxy(url));
  }

  const host = process.env.MASSLINK_PROXY_HOST;
  const portFrom = Number(process.env.MASSLINK_PROXY_PORT_FROM);
  const portTo = Number(process.env.MASSLINK_PROXY_PORT_TO);
  if (host && portFrom && portTo) {
    if (portFrom > portTo) {
      throw new Error(`MASSLINK_PROXY_PORT_FROM (${portFrom}) > PORT_TO (${portTo})`);
    }
    const protocol = (process.env.MASSLINK_PROXY_PROTOCOL || 'socks5').toLowerCase();

    const username = process.env.MASSLINK_PROXY_USERNAME || '';
    const password = process.env.MASSLINK_PROXY_PASSWORD || '';
    const legacyAuth = process.env.MASSLINK_PROXY_AUTH || '';
    let auth = '';
    if (username || password) {
      auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
    } else if (legacyAuth) {
      auth = legacyAuth;
    }

    parsed.push({
      rotating: true,
      protocol,
      auth,
      host,
      fromPort: portFrom,
      toPort: portTo,
      raw: `${protocol}://${auth ? auth + '@' : ''}${host}:${portFrom}-${portTo}`,
    });
  }

  cachedRaw = raw;
  cachedParsed = parsed;
  return cachedParsed;
}

function parseProxy(url) {
  const range = url.match(/^(socks[45]h?|https?):\/\/(?:([^@]+)@)?([^:/?#]+):(\d+)-(\d+)$/i);
  if (range) {
    const [, protocol, auth, host, fromPort, toPort] = range;
    return {
      rotating: true,
      protocol,
      auth: auth || '',
      host,
      fromPort: Number(fromPort),
      toPort: Number(toPort),
      raw: url,
    };
  }
  return { rotating: false, raw: url };
}

function materializeProxy(p) {
  if (!p.rotating) return p.raw;
  const range = p.toPort - p.fromPort + 1;
  const port = p.fromPort + Math.floor(Math.random() * range);
  return `${p.protocol}://${p.auth ? p.auth + '@' : ''}${p.host}:${port}`;
}

function nextProxy() {
  const proxies = loadProxies();
  if (!proxies.length) return null;
  const p = proxies[proxyIndex % proxies.length];
  proxyIndex++;
  return materializeProxy(p);
}

function isSocks(url) {
  return /^socks[45]h?:\/\//i.test(url);
}

function makeAgent(proxyUrl) {
  if (!proxyUrl) return null;
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const { SocksProxyAgent } = require('socks-proxy-agent');
  if (isSocks(proxyUrl)) return new SocksProxyAgent(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

module.exports = { nextProxy, makeAgent, isSocks, loadProxies };
