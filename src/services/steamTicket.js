const SteamUser = require('steam-user');
const { isSocks } = require('./proxyPool');

const APP_ID = Number(process.env.PIXELWORLD_APP_ID) || 871980;

function fetchSteamTicket(username, password, proxy) {
  return new Promise((resolve, reject) => {
    const opts = { autoRelogin: false, picsCacheAll: false, enablePicsCache: false };
    if (proxy && isSocks(proxy)) opts.socksProxy = proxy;

    const client = new SteamUser(opts);
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
      try { client.logOff(); } catch { /* ignore */ }
      err ? reject(err) : resolve(val);
    };

    const loginTimer = setTimeout(() => finish(new Error('steam login timeout')), 30000);
    const ticketTimer = setTimeout(() => finish(new Error('steam ticket timeout')), 75000);

    client.on('error', (err) => finish(new Error(`steam: ${err?.message || err}`)));
    client.on('steamGuard', (_d, cb) => {
      try { cb(''); } catch { /* ignore */ }
      finish(new Error('Steam Guard required (must be disabled)'));
    });

    const requestTicket = (retry) => {
      client.createAuthSessionTicket(APP_ID, (err, result) => {
        if (err) {
          const msg = err.message || String(err);
          if (retry && /AccessDenied/i.test(msg)) {
            client.requestFreeLicense([APP_ID], (lErr, _pkgs, apps) => {
              if (lErr) return finish(new Error(`requestFreeLicense: ${lErr.message || lErr}`));
              if (!apps?.includes(APP_ID)) return finish(new Error('free license not granted'));
              setTimeout(() => requestTicket(false), 1500);
            });
            return;
          }
          return finish(new Error(`createAuthSessionTicket: ${msg}`));
        }
        const buf = result?.sessionTicket || result?.ticket || result;
        if (!Buffer.isBuffer(buf)) return finish(new Error('ticket not buffer'));
        clearTimeout(loginTimer);
        clearTimeout(ticketTimer);
        finish(null, {
          steamId: client.steamID?.getSteamID64() ?? null,
          ticket: buf.toString('hex'),
        });
      });
    };

    client.on('loggedOn', () => {
      try { client.gamesPlayed([]); } catch { /* ignore */ }
      requestTicket(true);
    });

    try {
      client.logOn({
        accountName: username,
        password,
        machineName: 'pixel-shop-bot',
        rememberPassword: false,
      });
    } catch (e) {
      finish(new Error(`logOn threw: ${e.message || e}`));
    }
  });
}

module.exports = { fetchSteamTicket };
