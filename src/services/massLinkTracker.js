const { EmbedBuilder } = require('discord.js');
const { BRAND, ICON } = require('../utils/embeds');

const VISIBLE_ROWS = 25;
const UPDATE_INTERVAL_MS = 2500;

class MassLinkTracker {
  constructor(editFn) {
    this.editFn = editFn;
    this.totalRows = 0;
    this.currentStepName = '';
    this.notes = [];
    this.rowStatus = new Map();
    this.lastUpdate = 0;
    this.pendingUpdate = null;
    this.fullLog = '';
  }

  setTotalRows(n) {
    this.totalRows = n;
  }

  note(line) {
    const ts = new Date().toISOString().split('T')[1].slice(0, 8);
    this.notes.push(line);
    this.fullLog += `[${ts}] ${line}\n`;
    if (this.notes.length > 5) this.notes = this.notes.slice(-5);
    this.scheduleUpdate();
  }

  async startStep(name, count) {
    this.currentStepName = name;
    this.rowStatus = new Map();
    this.notes = [];
    this.fullLog += `\n=== ${name} (${count} items) ===\n`;
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    await this.flush();
  }

  updateRow(index, status, label) {
    this.rowStatus.set(index, { status, label, time: Date.now() });
    const icon = status === 'success' ? '✓'
               : status === 'retry'   ? '↻'
               : status === 'skipped' ? '⊘'
               : '✗';
    this.fullLog += `[${index}] ${icon} ${label}\n`;
    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (this.pendingUpdate) return;
    const elapsed = Date.now() - this.lastUpdate;
    const delay = Math.max(0, UPDATE_INTERVAL_MS - elapsed);
    this.pendingUpdate = setTimeout(() => {
      this.pendingUpdate = null;
      this.flush().catch(() => {});
    }, delay);
  }

  async flush() {
    this.lastUpdate = Date.now();
    try {
      await this.editFn({ embeds: [this.buildEmbed()] });
    } catch {
      /* rate limit / interaction expired */
    }
  }

  buildEmbed() {
    const all = [...this.rowStatus.entries()];
    const success = all.filter(([, v]) => v.status === 'success').length;
    const failed = all.filter(([, v]) => v.status === 'failed').length;
    const skipped = all.filter(([, v]) => v.status === 'skipped').length;
    const retrying = all.filter(([, v]) => v.status === 'retry').length;
    const done = success + failed + skipped;

    const color = failed > 0 ? BRAND.warning : retrying > 0 ? BRAND.info : BRAND.success;

    const sortedByTime = all.sort((a, b) => b[1].time - a[1].time).slice(0, VISIBLE_ROWS);
    const rowsList = sortedByTime
      .sort((a, b) => a[0] - b[0])
      .map(([idx, v]) => {
        const icon = v.status === 'success' ? '✅'
                   : v.status === 'retry'   ? '🔁'
                   : v.status === 'skipped' ? '🛡️'
                   : '❌';
        return `\`[${String(idx).padStart(3, ' ')}]\` ${icon} ${v.label}`;
      })
      .join('\n');

    const header = `\`\`\`\nprocess: ${done}/${this.totalRows}  |  success: ${success}  |  failed: ${failed}${skipped ? `  |  skipped: ${skipped}` : ''}${retrying ? `  |  retry: ${retrying}` : ''}\n\`\`\``;
    const notesBlock = this.notes.length
      ? `**Notes:**\n${this.notes.map((n) => `> ${n}`).join('\n')}\n\n`
      : '';

    return new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ICON.lightning}  ${this.currentStepName || 'MassLink'}`)
      .setDescription(header + '\n' + notesBlock + (rowsList || '_(menunggu hasil pertama...)_'))
      .setFooter({ text: `Auto-update tiap 2.5s • ${this.totalRows} total rows` })
      .setTimestamp();
  }

  async finalize(summaryEmbed) {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    if (summaryEmbed) {
      try { await this.editFn({ embeds: [summaryEmbed] }); }
      catch { /* ignore */ }
    } else {
      await this.flush();
    }
  }

  getFullLog() {
    return this.fullLog;
  }
}

module.exports = { MassLinkTracker };
