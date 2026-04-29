const { fetchSteamTicket } = require('./steamTicket');
const { loginWithEmail, loginWithSteam, unlinkSteam, linkSteam } = require('./playfab');
const { nextProxy } = require('./proxyPool');
const { createLogger } = require('../utils/logger');

const log = createLogger('masslink');

const CONCURRENCY = Number(process.env.MASSLINK_CONCURRENCY) || 3;
const UNLINK_RETRIES = Number(process.env.MASSLINK_UNLINK_RETRIES) || 5;
const MAX_ROWS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try { results[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (err) { results[i] = { ok: false, err: err.message || String(err) }; }
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

async function stepSteamCheck(rows, report) {
  report(`STEP 1/3 — Steam Check (${rows.length} accounts, concurrency=${CONCURRENCY})`);
  const results = await runPool(rows, CONCURRENCY, async (row) => {
    const proxy = nextProxy();
    const ticket = await fetchSteamTicket(row.steam_user, row.steam_pass, proxy);
    const json = await loginWithSteam(ticket.ticket, false, proxy);
    if (json.code === 200) {
      return { state: 'linked', playfabId: json.data?.PlayFabId };
    }
    const errMsg = (json.errorMessage || json.error || '').toString();
    if (/AccountNotFound/i.test(errMsg)) return { state: 'free' };
    throw new Error(`unexpected: code=${json.code} ${errMsg.slice(0, 150)}`);
  });

  const linked = [], free = [], failed = [];
  results.forEach((r, i) => {
    const row = rows[i];
    if (!r.ok) failed.push({ row, err: r.err });
    else if (r.value.state === 'linked') linked.push({ row, playfabId: r.value.playfabId });
    else free.push({ row });
  });

  report(`  ✓ free: ${free.length}`);
  report(`  ⚠ already linked: ${linked.length}`);
  report(`  ✗ errors: ${failed.length}`);
  if (linked.length) {
    report(`  blocked steam accounts:`);
    for (const l of linked.slice(0, 10)) report(`    - ${l.row.steam_user}`);
    if (linked.length > 10) report(`    ... +${linked.length - 10} more`);
  }
  if (failed.length) {
    report(`  errored steam accounts:`);
    for (const f of failed.slice(0, 10)) report(`    - ${f.row.steam_user}: ${f.err}`);
    if (failed.length > 10) report(`    ... +${failed.length - 10} more`);
  }

  return { linked, free, failed };
}

async function stepMassUnlink(rows, report) {
  report(`STEP 2/3 — Mass Unlink (${rows.length} accounts, retries=${UNLINK_RETRIES})`);
  let pending = rows.slice();
  const allFailed = new Map();
  const succeeded = [];

  for (let attempt = 1; attempt <= UNLINK_RETRIES; attempt++) {
    if (!pending.length) break;
    report(`  attempt ${attempt}/${UNLINK_RETRIES} — ${pending.length} remaining`);
    const results = await runPool(pending, CONCURRENCY, async (row) => {
      const proxy = nextProxy();
      const ticket = await loginWithEmail(row.pw_email, row.pw_pass, proxy);
      await unlinkSteam(ticket, proxy);
    });
    const stillPending = [];
    results.forEach((r, i) => {
      const row = pending[i];
      if (r.ok) {
        succeeded.push(row);
        allFailed.delete(row.pw_email);
      } else {
        allFailed.set(row.pw_email, r.err);
        stillPending.push(row);
      }
    });
    report(`    ✓ ${results.filter((r) => r.ok).length} succeeded · ✗ ${stillPending.length} failing`);
    pending = stillPending;
    if (pending.length) await sleep(1500);
  }

  report(`  ✓ unlinked: ${succeeded.length}`);
  report(`  ✗ stuck:    ${pending.length}`);
  if (pending.length) {
    report(`  failed pw accounts (last error):`);
    for (const row of pending.slice(0, 10)) {
      report(`    - ${row.pw_email}: ${allFailed.get(row.pw_email)}`);
    }
    if (pending.length > 10) report(`    ... +${pending.length - 10} more`);
  }
  return { succeeded, failed: pending, errors: allFailed };
}

async function stepMassLink(rows, report) {
  report(`STEP 3/3 — Mass Link (${rows.length} accounts, concurrency=${CONCURRENCY})`);
  const results = await runPool(rows, CONCURRENCY, async (row) => {
    const proxy = nextProxy();
    const sessionTicket = await loginWithEmail(row.pw_email, row.pw_pass, proxy);
    const steamTicket = await fetchSteamTicket(row.steam_user, row.steam_pass, proxy);
    await linkSteam(sessionTicket, steamTicket.ticket, proxy);
    return { steamId: steamTicket.steamId };
  });

  const linked = [], failed = [];
  results.forEach((r, i) => {
    if (r.ok) linked.push({ row: rows[i], steamId: r.value.steamId });
    else failed.push({ row: rows[i], err: r.err });
  });
  report(`  ✓ linked: ${linked.length}`);
  report(`  ✗ failed: ${failed.length}`);
  if (failed.length) {
    report(`  failed pairs:`);
    for (const f of failed.slice(0, 10)) {
      report(`    - ${f.row.pw_email} ↔ ${f.row.steam_user}: ${f.err}`);
    }
    if (failed.length > 10) report(`    ... +${failed.length - 10} more`);
  }
  return { linked, failed };
}

async function runMassLinkPipeline(text, opts, report) {
  const { rows, errors } = parseFile(text);
  if (errors.length) {
    report(`Parse errors (${errors.length}):`);
    for (const e of errors.slice(0, 5)) report(`  ${e}`);
  }
  if (!rows.length) {
    return { aborted: true, reason: 'No valid rows in file' };
  }
  if (rows.length > MAX_ROWS) {
    return { aborted: true, reason: `Too many rows (max ${MAX_ROWS}, got ${rows.length})` };
  }
  report(`Loaded ${rows.length} rows. concurrency=${CONCURRENCY}`);

  const check = await stepSteamCheck(rows, report);
  if (check.linked.length || check.failed.length) {
    report(`Step 1 gate FAILED — ${check.linked.length} already linked, ${check.failed.length} errored. Aborting.`);
    return { aborted: true, reason: 'Step 1 (Steam Check) gate failed', check };
  }

  if (opts.onlyCheckSteam) {
    return { steamCheckOnly: true, totalRows: rows.length };
  }

  const unlink = await stepMassUnlink(rows, report);
  const accountsToLink = unlink.succeeded;

  if (unlink.failed.length) {
    report(`Step 2 had ${unlink.failed.length} stuck account(s) — skipping them, lanjut ke link untuk ${accountsToLink.length} akun yang berhasil unlink.`);
  }

  if (accountsToLink.length === 0) {
    report(`Tidak ada akun yang bisa di-link (semua unlink gagal).`);
    return {
      success: true,
      link: { linked: [], failed: [] },
      unlink,
      totalRows: rows.length,
      skipped: unlink.failed.map((row) => ({ row, err: unlink.errors.get(row.pw_email) || 'unlink failed' })),
    };
  }

  const link = await stepMassLink(accountsToLink, report);
  log.info(`pipeline done: ${link.linked.length}/${rows.length} linked, unlinkStuck=${unlink.failed.length}, linkFailed=${link.failed.length}`);
  return {
    success: true,
    link,
    unlink,
    totalRows: rows.length,
    skipped: unlink.failed.map((row) => ({ row, err: unlink.errors.get(row.pw_email) || 'unlink failed' })),
  };
}

module.exports = { runMassLinkPipeline, parseFile };
