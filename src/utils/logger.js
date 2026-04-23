const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const C = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  tag: '\x1b[35m',
  time: '\x1b[90m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function currentLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${date}.log`);
}

let fileStream = fs.createWriteStream(currentLogPath(), { flags: 'a' });
let currentDate = new Date().toISOString().slice(0, 10);

function rotateIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDate) {
    fileStream.end();
    currentDate = today;
    fileStream = fs.createWriteStream(currentLogPath(), { flags: 'a' });
  }
}

function stringifyArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

function timestamp() {
  const d = new Date();
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function log(level, tag, args) {
  if (LEVELS[level] < minLevel) return;
  rotateIfNeeded();

  const msg = args.map(stringifyArg).join(' ');
  const ts = timestamp();
  const isoTs = new Date().toISOString();

  const levelLabel = level.toUpperCase().padEnd(5);
  const styled =
    `${C.time}${ts}${C.reset} ` +
    `${C[level]}${C.bold}${levelLabel}${C.reset} ` +
    `${C.tag}[${tag}]${C.reset} ` +
    `${msg}`;

  (level === 'error' ? console.error : console.log)(styled);
  fileStream.write(`[${isoTs}] [${levelLabel.trim()}] [${tag}] ${msg}\n`);
}

function createLogger(tag) {
  return {
    debug: (...args) => log('debug', tag, args),
    info: (...args) => log('info', tag, args),
    warn: (...args) => log('warn', tag, args),
    error: (...args) => log('error', tag, args),
    child: (subtag) => createLogger(`${tag}:${subtag}`),
  };
}

process.on('unhandledRejection', (reason) => {
  log('error', 'process', ['unhandledRejection:', reason]);
});

process.on('uncaughtException', (err) => {
  log('error', 'process', ['uncaughtException:', err]);
});

module.exports = { createLogger };
