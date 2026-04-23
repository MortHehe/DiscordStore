const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createLogger } = require('../utils/logger');

const log = createLogger('imap');

function requireImapConfig() {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  if (!host || !user || !pass || pass.startsWith('paste_')) {
    throw new Error('IMAP not configured — set IMAP_HOST, IMAP_USER, IMAP_PASSWORD in .env');
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: (process.env.IMAP_SECURE || 'true').toLowerCase() !== 'false',
    auth: { user, pass },
    logger: false,
  };
}

function extractLinks(text) {
  if (!text) return { passwordReset: [], emailChange: [], verify: [], all: [] };
  const urlRegex = /https?:\/\/[^\s<>"'\]]+/g;
  const all = [...new Set(text.match(urlRegex) || [])];

  const passwordReset = all.filter(url =>
    /reset.*password|password.*reset|resettitle|recover|forgot.*password|reset.*title/i.test(url),
  );
  const emailChange = all.filter(url =>
    /change.*email|email.*change|update.*email/i.test(url)
    && !passwordReset.includes(url),
  );
  const verify = all.filter(url =>
    /verify|verification|confirm|activate|validat/i.test(url)
    && !passwordReset.includes(url)
    && !emailChange.includes(url),
  );

  return { passwordReset, emailChange, verify, all };
}

async function searchEmails({ to, from, limit = 5, days = 30, keyword = null }) {
  const client = new ImapFlow(requireImapConfig());
  await client.connect();

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const criteria = { since };
      if (to) criteria.to = to;
      if (from) criteria.from = from;
      if (keyword) {
        criteria.or = [{ subject: keyword }, { body: keyword }];
      }

      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];

      const latestUids = uids.slice(-limit).reverse();
      const results = [];

      for await (const msg of client.fetch(
        latestUids,
        { envelope: true, source: true },
        { uid: true },
      )) {
        let parsed;
        try {
          parsed = await simpleParser(msg.source);
        } catch (err) {
          log.warn(`parse failed uid=${msg.uid}: ${err.message}`);
          continue;
        }

        const text = (parsed.text || parsed.html || '').replace(/\s+/g, ' ').trim();
        results.push({
          uid: msg.uid,
          subject: parsed.subject || '(no subject)',
          from: parsed.from?.text || '',
          to: parsed.to?.text || '',
          date: parsed.date || new Date(),
          preview: text.slice(0, 300),
          links: extractLinks(parsed.text || parsed.html || ''),
        });
      }

      return results;
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); }
    catch { /* ignore */ }
  }
}

module.exports = { searchEmails };
