// In-memory fake of the Apps Script services Code.gs uses.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const code = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function a1(ref) {
  const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(ref);
  const col = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const r1 = m[2] ? +m[2] : 1, c1 = col(m[1]);
  const r2 = m[3] ? (m[4] ? +m[4] : 1000) : m[2] ? r1 : 1000, c2 = m[3] ? col(m[3]) : c1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

class Sheet {
  constructor(name) { this.name = name; this.cells = []; this.charts = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.cells.length; r > 0; r--) if ((this.cells[r - 1] || []).some((v) => v !== '' && v != null)) return r;
    return 0;
  }
  getMaxRows() { return 1000; }
  get(r, c) { return (this.cells[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) { (this.cells[r - 1] ||= [])[c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') [r, c, nr, nc] = a1(r);
    const sh = this;
    const range = new Proxy({}, {
      get(_, k) {
        if (k === 'getValues') return () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.get(r + i, c + j)));
        if (k === 'getValue') return () => sh.get(r, c);
        if (k === 'setValues') return (v) => { v.forEach((row, i) => row.forEach((x, j) => sh.set(r + i, c + j, x))); return range; };
        if (k === 'setValue' || k === 'setFormula') return (v) => { sh.set(r, c, v); return range; };
        if (k === 'clearContent') return () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.set(r + i, c + j, ''); return range; };
        return () => range;
      },
    });
    return range;
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), 3); }
  appendRow(row) { this.cells[this.getLastRow()] = row.slice(); }
  deleteRow(r) { this.cells.splice(r - 1, 1); }
  clear() { this.cells = []; }
  getCharts() { return this.charts; }
  removeChart() {}
  insertChart(c) { this.charts.push(c); }
  newChart() { const b = new Proxy({}, { get: (_, k) => (k === 'build' ? () => ({}) : () => b) }); return b; }
}
for (const m of ['setFrozenRows', 'setColumnWidth', 'setColumnWidths', 'setHiddenGridlines', 'hideSheet']) Sheet.prototype[m] = function () { return this; };

export function makeEnv() {
  const sheets = [new Sheet('Sheet1')];
  const props = {};
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, i) => { const s = new Sheet(n); sheets.splice(i ?? sheets.length, 0, s); return s; },
    getSheets: () => sheets,
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    setSpreadsheetTimeZone() {}, setSpreadsheetLocale() {}, setActiveSheet() {}, moveActiveSheet() {},
    getName: () => 'My Spendings', getUrl: () => 'https://docs.google.com/x',
  };
  const ctx = {
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => { throw new Error('no ui'); },
      newDataValidation: () => { const b = new Proxy({}, { get: (_, k) => (k === 'build' ? () => ({}) : () => b) }); return b; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => delete props[k] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
          .formatToParts(d).map((x) => [x.type, x.value]));
        return f.replace('yyyy', p.year).replace('MM', p.month.padStart(2, '0')).replace('M', p.month).replace('dd', p.day.padStart(2, '0')).replace('d', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
      computeDigest: (_, s) => [...crypto.createHash('sha1').update(s).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_1: 'sha1' },
    },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, ss, props };
}

