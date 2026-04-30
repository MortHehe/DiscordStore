const SteamUser = require('steam-user');
const { isSocks } = require('./proxyPool');
const { createLogger } = require('../utils/logger');

const log = createLogger('steam-ticket');

const APP_ID = Number(process.env.GAME_STEAM_APP_ID) || Number(process.env.PIXELWORLD_APP_ID) || 636040;
const LICENSE_RETRY_ATTEMPTS = Number(process.env.STEAM_LICENSE_RETRIES) || 3;
const LICENSE_RETRY_DELAY_MS = Number(process.env.STEAM_LICENSE_DELAY_MS) || 2500;
const POST_LICENSE_WAIT_MS = Number(process.env.STEAM_POST_LICENSE_WAIT_MS) || 3000;
const SKIP_FREE_LICENSE = (process.env.STEAM_SKIP_FREE_LICENSE || 'false').toLowerCase() === 'true';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    const ticketTimer = setTimeout(() => finish(new Error('steam ticket timeout (>120s)')), 120000);

    client.on('error', (err) => finish(new Error(`steam: ${err?.message || err}`)));
    client.on('steamGuard', (_d, cb) => {
      try { cb(''); } catch { /* ignore */ }
      finish(new Error('Steam Guard required (must be disabled)'));
    });

    const tryClaimFreeLicense = (attempt = 1) => {
      client.requestFreeLicense([APP_ID], (lErr, packages, apps) => {
        if (lErr) {
          log.warn(`[${username}] license claim error: ${lErr.message || lErr}`);
          if (attempt < LICENSE_RETRY_ATTEMPTS) {
            return setTimeout(() => tryClaimFreeLicense(attempt + 1), LICENSE_RETRY_DELAY_MS);
          }
          return finish(new Error(`requestFreeLicense: ${lErr.message || lErr}`));
        }
        log.info(`[${username}] requestFreeLicense returned: pkgs=${JSON.stringify(packages)} apps=${JSON.stringify(apps)}`);
        if (!apps?.includes(APP_ID)) {
          if (attempt < LICENSE_RETRY_ATTEMPTS) {
            return setTimeout(() => tryClaimFreeLicense(attempt + 1), LICENSE_RETRY_DELAY_MS);
          }
          return finish(new Error(
            `free license not granted after ${LICENSE_RETRY_ATTEMPTS} attempts. ` +
            `Possible: limited/region-restricted account, or app needs manual claim. ` +
            `Set STEAM_SKIP_FREE_LICENSE=true if accounts already own PixelWorlds.`,
          ));
        }
        log.info(`[${username}] free license granted for ${APP_ID}`);
        setTimeout(() => requestTicket(false), POST_LICENSE_WAIT_MS);
      });
    };

    const requestTicket = (allowLicenseClaim) => {
      client.createAuthSessionTicket(APP_ID, (err, result) => {
        if (err) {
          const msg = err.message || String(err);
          if (allowLicenseClaim && /AccessDenied/i.test(msg) && !SKIP_FREE_LICENSE) {
            return tryClaimFreeLicense();
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
