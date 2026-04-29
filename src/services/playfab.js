const https = require('node:https');
const { makeAgent } = require('./proxyPool');

const TITLE_ID = process.env.PIXELWORLD_TITLE_ID || '11EF5C';
const PLAYFAB_BASE = `https://${TITLE_ID.toLowerCase()}.playfabapi.com`;

function commonHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-PlayFabSDK': process.env.PLAYFAB_SDK || 'UnitySDK-2.178.230929',
    'X-ReportErrorAsSuccess': 'true',
    'X-Unity-Version': process.env.UNITY_VERSION || '6000.3.11f1',
  };
}

function httpsViaAgent(url, opts, agent) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method: opts.method,
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: opts.headers,
      agent,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(txt)); }
        catch { reject(new Error(`playfab non-json HTTP ${res.statusCode}: ${txt.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('playfab request timeout')));
    req.write(opts.body);
    req.end();
  });
}

async function playfabPost(endpoint, body, extraHeaders = {}, proxy = null) {
  const url = `${PLAYFAB_BASE}${endpoint}`;
  const headers = { ...commonHeaders(), ...extraHeaders };
  const opts = { method: 'POST', headers, body: JSON.stringify(body) };
  const agent = makeAgent(proxy);

  if (agent) {
    return httpsViaAgent(url, opts, agent);
  }

  const res = await fetch(url, opts);
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch { throw new Error(`playfab non-json HTTP ${res.status}: ${txt.slice(0, 200)}`); }
}

async function loginWithEmail(email, password, proxy) {
  const j = await playfabPost('/Client/LoginWithEmailAddress', {
    Email: email, Password: password, TitleId: TITLE_ID,
  }, {}, proxy);
  if (j.code !== 200) {
    throw new Error(`LoginWithEmail code=${j.code} ${(j.errorMessage || j.error || '').toString().slice(0, 150)}`);
  }
  return j.data.SessionTicket;
}

async function loginWithSteam(steamTicketHex, createAccount, proxy) {
  return playfabPost('/Client/LoginWithSteam', {
    CreateAccount: createAccount,
    SteamTicket: steamTicketHex,
    TitleId: TITLE_ID,
  }, {}, proxy);
}

async function unlinkSteam(sessionTicket, proxy) {
  const j = await playfabPost('/Client/UnlinkSteamAccount', {}, {
    'X-Authorization': sessionTicket,
  }, proxy);
  if (j.code !== 200) {
    throw new Error(`UnlinkSteam code=${j.code} ${(j.errorMessage || j.error || '').toString().slice(0, 150)}`);
  }
}

async function linkSteam(sessionTicket, steamTicketHex, proxy) {
  const j = await playfabPost('/Client/LinkSteamAccount', {
    ForceLink: true,
    SteamTicket: steamTicketHex,
  }, { 'X-Authorization': sessionTicket }, proxy);
  if (j.code !== 200) {
    throw new Error(`LinkSteam code=${j.code} ${(j.errorMessage || j.error || '').toString().slice(0, 150)}`);
  }
}

module.exports = { loginWithEmail, loginWithSteam, unlinkSteam, linkSteam };
