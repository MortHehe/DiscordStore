const { fetchSteamTicket } = require('./steamTicket');
const { loginWithEmail, loginWithSteam, unlinkSteam, linkSteam } = require('./playfab');
const { nextProxy } = require('./proxyPool');
const { createLogger } = require('../utils/logger');

const log = createLogger('masslink');

const CONCURRENCY = Number(process.env.MASSLINK_CONCURRENCY) || 3;
const UNLINK_RETRIES = Number(process.env.MASSLINK_UNLINK_RETRIES) || 5;
const MAX_ROWS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPool(items, concurrency, worker, onItemDone) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, err: err.message || String(err) };
      }
      if (onItemDone) {
        try { onItemDone(i, results[i], items[i]); }
        catch { /* ignore */ }
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function parseFile(text) {
  const rows = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('|').map((s) => s.trim());
    if (parts.length < 5) {
      errors.push(`line ${i + 1}: expected 5 fields, got ${parts.length}`);
      return;
    }
    const [nickname, pw_email, pw_pass, steam_user, steam_pass] = parts;
    if (!pw_email || !pw_pass || !steam_user || !steam_pass) {
      errors.push(`line ${i + 1}: empty field`);
      return;
    }
    rows.push({ nickname, pw_email, pw_pass, steam_user, steam_pass });
  });
  return { rows, errors };
}

async function stepSteamCheck(rows, tracker) {
  await tracker.startStep('Step 1/3 — Steam Check', rows.length);
  const results = await runPool(rows, CONCURRENCY, async (row) => {
    const proxy = nextProxy();
    const ticket = await fetchSteamTicket(row.steam_user, row.steam_pass, proxy);
    const json = await loginWithSteam(ticket.ticket, false, proxy);
    if (json.code === 200) return { state: 'linked', playfabId: json.data?.PlayFabId };
    const errName = (json.error || '').toString();
    const errMsg = (json.errorMessage || '').toString();
    const combined = `${errName} ${errMsg}`;
    if (/AccountNotFound|LinkedAccountNotFound|UserNotFound|User\s*not\s*found/i.test(combined)) {
      return { state: 'free' };
    }
    throw new Error(`unexpected: code=${json.code} ${(errMsg || errName).slice(0, 150)}`);
  }, (i, result) => {
    if (!result.ok) {
      tracker.updateRow(i, 'failed', `error: ${truncErr(result.err)}`);
    } else if (result.value.state === 'linked') {
      tracker.updateRow(i, 'skipped', 'already linked → skip');
    } else {
      tracker.updateRow(i, 'success', 'free');
    }
  });

  const linked = [], free = [], failed = [];
  results.forEach((r, i) => {
    const row = rows[i];
    if (!r.ok) failed.push({ row, err: r.err });
    else if (r.value.state === 'linked') linked.push({ row, playfabId: r.value.playfabId });
    else free.push({ row });
  });

  return { linked, free, failed };
}

async function stepMassUnlink(rows, tracker) {
  await tracker.startStep(`Step 2/3 — Mass Unlink`, rows.length);
  let pending = rows.map((row, i) => ({ row, originalIndex: i }));
  const allFailed = new Map();
  const succeeded = [];

  for (let attempt = 1; attempt <= UNLINK_RETRIES; attempt++) {
    if (!pending.length) break;
    tracker.note(`attempt ${attempt}/${UNLINK_RETRIES} — ${pending.length} remaining`);

    const results = await runPool(pending, CONCURRENCY, async ({ row }) => {
      const proxy = nextProxy();
      const ticket = await loginWithEmail(row.pw_email, row.pw_pass, proxy);
      await unlinkSteam(ticket, proxy);
    }, (idx, result) => {
      const item = pending[idx];
      if (result.ok) {
        tracker.updateRow(item.originalIndex, 'success', 'unlinked');
      } else {
        const isLastAttempt = attempt === UNLINK_RETRIES;
        tracker.updateRow(
          item.originalIndex,
          isLastAttempt ? 'failed' : 'retry',
          isLastAttempt ? `stuck: ${truncErr(result.err)}` : `retry ${attempt}: ${truncErr(result.err)}`,
        );
      }
    });

    const stillPending = [];
    results.forEach((r, i) => {
      const item = pending[i];
      if (r.ok) {
        succeeded.push(item.row);
        allFailed.delete(item.row.pw_email);
      } else {
        allFailed.set(item.row.pw_email, r.err);
        stillPending.push(item);
      }
    });
    pending = stillPending;
    if (pending.length) await sleep(1500);
  }

  return {
    succeeded,
    failed: pending.map((p) => p.row),
    errors: allFailed,
  };
}

async function stepMassLink(rows, originalIndices, tracker) {
  await tracker.startStep(`Step 3/3 — Mass Link`, rows.length);
  const results = await runPool(rows, CONCURRENCY, async (row) => {
    const proxy = nextProxy();
    const sessionTicket = await loginWithEmail(row.pw_email, row.pw_pass, proxy);
    const steamTicket = await fetchSteamTicket(row.steam_user, row.steam_pass, proxy);
    await linkSteam(sessionTicket, steamTicket.ticket, proxy);
    return { steamId: steamTicket.steamId };
  }, (i, result) => {
    const origIdx = originalIndices ? originalIndices[i] : i;
    if (result.ok) {
      tracker.updateRow(origIdx, 'success', 'linked');
    } else {
      tracker.updateRow(origIdx, 'failed', `failed: ${truncErr(result.err)}`);
    }
  });

  const linked = [], failed = [];
  results.forEach((r, i) => {
    if (r.ok) linked.push({ row: rows[i], steamId: r.value.steamId });
    else failed.push({ row: rows[i], err: r.err });
  });
  return { linked, failed };
}

function truncErr(err) {
  const s = String(err);
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

async function runMassLinkPipeline(text, opts, tracker) {
  const { rows, errors } = parseFile(text);
  if (errors.length) tracker.note(`Parse errors: ${errors.length}`);
  if (!rows.length) {
    return { aborted: true, reason: 'No valid rows in file' };
  }
  if (rows.length > MAX_ROWS) {
    return { aborted: true, reason: `Too many rows (max ${MAX_ROWS}, got ${rows.length})` };
  }
  tracker.setTotalRows(rows.length);
  tracker.note(`Loaded ${rows.length} rows. concurrency=${CONCURRENCY}`);

  const check = await stepSteamCheck(rows, tracker);
  const freeAccounts = check.free.map((f) => f.row);

  if (check.linked.length || check.failed.length) {
    tracker.note(`Step 1 — ${check.linked.length} already linked, ${check.failed.length} errored — skipped. Lanjut ${freeAccounts.length} free.`);
  }

  if (freeAccounts.length === 0) {
    return {
      aborted: true,
      reason: 'Step 1 — tidak ada akun free yang bisa dilanjut',
      check,
    };
  }

  if (opts.onlyCheckSteam) {
    return { steamCheckOnly: true, totalRows: rows.length, freeCount: freeAccounts.length };
  }

  const unlink = await stepMassUnlink(freeAccounts, tracker);
  const accountsToLink = unlink.succeeded;

  if (unlink.failed.length) {
    tracker.note(`${unlink.failed.length} stuck di unlink — skipped, lanjut step 3 untuk ${accountsToLink.length} akun.`);
  }

  if (accountsToLink.length === 0) {
    return {
      success: true,
      link: { linked: [], failed: [] },
      unlink,
      totalRows: rows.length,
      check,
      skipped: [
        ...check.linked.map(({ row }) => ({ row, err: 'already linked', stage: 'check' })),
        ...check.failed.map(({ row, err }) => ({ row, err, stage: 'check' })),
        ...unlink.failed.map((row) => ({ row, err: unlink.errors.get(row.pw_email) || 'unlink failed', stage: 'unlink' })),
      ],
    };
  }

  const indexMap = accountsToLink.map((row) => rows.findIndex((r) => r.pw_email === row.pw_email));
  const link = await stepMassLink(accountsToLink, indexMap, tracker);

  log.info(`pipeline done: ${link.linked.length}/${rows.length} linked, checkSkipped=${check.linked.length + check.failed.length}, unlinkStuck=${unlink.failed.length}, linkFailed=${link.failed.length}`);
  return {
    success: true,
    link,
    unlink,
    check,
    totalRows: rows.length,
    skipped: [
      ...check.linked.map(({ row }) => ({ row, err: 'already linked', stage: 'check' })),
      ...check.failed.map(({ row, err }) => ({ row, err, stage: 'check' })),
      ...unlink.failed.map((row) => ({ row, err: unlink.errors.get(row.pw_email) || 'unlink failed', stage: 'unlink' })),
    ],
  };
}

module.exports = { runMassLinkPipeline, parseFile };
