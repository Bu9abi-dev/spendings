// Monthly report: one pay cycle on a single printable page (income, spending, categories, top
// merchants, allowance, budgets), saved as a PDF from the iPhone's print or share sheet, plus that
// cycle's entries as CSV. The report is plain HTML with its own light "paper" styles, so the
// preview, the printout and the shared file all look the same.
import { cleanMerchant } from './categorize.js';
import { detectRecurring, monthlyTotal } from './recurring.js';
import {
  categoryMeta, accountMeta, apportion, cycleOf, shiftCycle, cycleName, cycleRange, cycleBounds, summarize, balances, toAED, toCSV, fmt, dubaiParts,
  isPerson, moneyTotal, peopleBalances,
} from './model.js';
import { state, getExtra } from './store.js';
import { openSheet, toast, haptic, esc } from './ui.js';
import { icon } from './icons.js';

/* ───────────────────────── The numbers (pure) ───────────────────────── */

// Paper colours: the light-mode chart palette, fixed so a printout never comes out dark.
const SERIES = ['#8e8e93', '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
// Name and colour come from the category list (custom categories too); unknown ones are grey.
const catColor = (id) => SERIES[categoryMeta(id)?.slot || 0] || SERIES[0];
const catName = (id) => (id === 'Uncategorised' ? 'Needs category' : categoryMeta(id)?.label || id);

/** Shop name without store/MCC numbers or the city: "CARREFOUR MCC 5411 ABU DHABI" → "CARREFOUR". */
// tidies a bank-style name for display; grouping uses categorize.cleanMerchant, shared with Needs review
function cleanShop(m) {
  let t = String(m || '').trim().replace(/\s+/g, ' ');
  for (let prev = ''; prev !== t;) {
    prev = t;
    t = t.replace(/[\s,\-–]*\b(abu\s*dhabi|dubai|sharjah|ae|uae|are)$/i, '').replace(/[\s,\-–]*\bmcc\s*#?\d+$/i, '').replace(/[\s,\-–]*(#|no\.?\s*|store\s*|branch\s*)?\d+$/i, '').trim();
  }
  return t;
}
const merchantKey = (m) => cleanMerchant(m) || cleanShop(m).toLowerCase();
const shopName = (m) => { const t = cleanShop(m); return t && t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : t; };

/** A budget limit: a positive number of dirhams, otherwise none. */
const budgetLimit = (b) => (typeof b === 'number' && b > 0 ? b : 0);

/** Everything the report shows for one cycle. Transfers are kept apart: moving money between
    accounts is never spending. Bank matches (Adjustments) only move "Total money". */
export function cycleReport(entries, cycle, settings, plan = [], budgetsExtra = null, now = new Date(), ignoredSubs = []) {
  const budgets = budgetsExtra?.limits || {}; // saved as { v: 1, limits: { <categoryId>: <AED> } }
  const s = settings;
  const sum = summarize(entries, cycle, s, plan);
  const prev = summarize(entries, shiftCycle(cycle, -1), s, plan);
  const { start, end } = cycleBounds(cycle, s.cycleStart);
  const isCurrent = cycle === cycleOf(now, s.cycleStart);

  // Same rules as Insights: Spent is gross (a refund is income, not netted off). Money in includes
  // refunds; "refunds" is shown on its own as the part of it that was money back.
  const refunds = sum.byIncome.get('Refund') || 0;
  const income = sum.income;
  const spent = sum.spent;

  // whole dirhams that add up: Money in − Spent = Kept, and every list sums to Spent
  const whole = { income: Math.round(income), spent: Math.round(spent), refunds: Math.round(refunds) };
  whole.kept = whole.income - whole.spent;
  const rowsOf = (items, top, restLabel) => {
    const head = items.slice(0, top), restV = items.slice(top).reduce((a, x) => a + x.value, 0);
    const rows = items.length > top ? [...head, { id: restLabel, name: 'Everything else', value: restV, rest: true }] : head;
    const shown = apportion(rows.map((x) => x.value), whole.spent), pct = apportion(rows.map((x) => (spent ? (x.value / spent) * 100 : 0)), spent ? 100 : 0);
    return rows.map((x, i) => ({ ...x, shown: shown[i], pct: pct[i] }));
  };

  const cats = [...sum.byCategory].map(([id, v]) => ({ id, name: catName(id), value: v, prev: prev.byCategory.get(id) || 0 }))
    .sort((a, b) => b.value - a.value);
  const categories = rowsOf(cats, 8, '_rest');

  // shops, grouped by one shared name cleaner
  const shops = new Map();
  let moved = 0, moves = 0;
  for (const e of sum.entries) {
    if (e.type === 'Transfer') { moved += toAED(e, s); moves++; continue; }
    if (e.type !== 'Spend') continue;
    const k = merchantKey(e.merchant) || '(no merchant)';
    const g = shops.get(k) || shops.set(k, { id: k, name: shopName(e.merchant) || 'No merchant', value: 0, count: 0, category: e.category }).get(k);
    g.value += toAED(e, s);
    g.count++;
  }
  const merchants = rowsOf([...shops.values()].sort((a, b) => b.value - a.value), 8, '_rest');
  const biggest = sum.entries.filter((e) => e.type === 'Spend').sort((a, b) => toAED(b, s) - toAED(a, s)).slice(0, 5);

  // total money when the cycle ended (or now, for the cycle we're in)
  const asOf = isCurrent ? now : end;
  const bals = balances(entries.filter((e) => new Date(e.date) < asOf), s);
  // people's balances are money owed, not money you hold: listed apart
  const totalMoney = moneyTotal(bals);
  const owed = peopleBalances([], s, bals);

  const budgetRows = Object.entries(budgets).map(([id, b]) => ({ id, name: catName(id), limit: budgetLimit(b), spent: sum.byCategory.get(id) || 0 }))
    .filter((b) => b.limit > 0).sort((a, b) => b.spent / b.limit - a.spent / a.limit);

  // subscriptions as they stood when the cycle ended (or now): charges up to then, same detector as Insights
  const subsAt = detectRecurring(entries.filter((e) => new Date(e.date) < asOf), s, { now: asOf, ignored: ignoredSubs });
  const subsMonthly = monthlyTotal(subsAt);
  const subsCount = subsAt.filter((x) => !x.isLate).length;

  return {
    subsMonthly, subsCount,
    cycle, isCurrent, start, end, asOf,
    income, refunds, spent, whole, saved: income - spent, prevSpent: prev.spent,
    byIncome: [...sum.byIncome].filter(([k]) => k !== 'Refund').sort((a, b) => b[1] - a[1]),
    byAccount: [...sum.byAccount].map(([id, a]) => ({ id, spent: a.spent })).filter((a) => a.spent > 0).sort((a, b) => b.spent - a.spent),
    categories, merchants, biggest, moved, moves,
    allowance: { account: s.allowanceAccount, pot: sum.allowancePot, base: s.allowance, topUps: sum.topUps, carryIn: sum.carryIn, used: sum.allowanceUsed, left: sum.allowanceLeft },
    totalMoney, accounts: [...bals].filter(([id]) => !isPerson(id)).map(([id, b]) => ({ id, balance: b.balance })).filter((a) => Math.abs(a.balance) >= 0.005),
    owedToYou: owed.owedToYou, youOwe: owed.youOwe,
    budgets: budgetRows, review: sum.review, count: sum.entries.filter((e) => e.type !== 'Adjustment').length,
  };
}

/** One cycle's entries, oldest first, in the same columns as the full export. */
export function cycleCSV(entries, cycle) {
  return toCSV(entries.filter((e) => e.cycle === cycle).sort((a, b) => (a.date < b.date ? -1 : 1)));
}

/* ───────────────────────── The page ───────────────────────── */

const aed = (n) => `AED ${fmt(n, { whole: true })}`; // whole dirhams; exact amounts are in the CSV
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d) => { const p = dubaiParts(d); return `${p.d} ${MON[p.m - 1]}`; };
const bar = (w, color) => `<span class="rp-bar"><i style="width:${Math.max(0, Math.min(100, w * 100)).toFixed(1)}%;background:${color}"></i></span>`;
/** "↑ 120" / "↓ 40" against last cycle, for spending (up is the bad direction). */
const change = (now, before) => {
  const d = Math.round(now - before);
  if (!before || Math.abs(d) < 1) return '';
  return `<small class="${d > 0 ? 'rp-up' : 'rp-down'}">${d > 0 ? '↑' : '↓'} ${fmt(Math.abs(d), { whole: true })}</small>`;
};

/** The report as HTML (no app styles needed; REPORT_CSS styles it). */
export function reportHTML(r, settings) {
  const a = r.allowance;
  const tile = (label, v, cls = '') => `<div class="rp-tile"><span>${label}</span><b class="${cls}">${aed(v)}</b></div>`;
  const section = (title, body) => `<section class="rp-sec"><h2>${title}</h2>${body}</section>`;
  const empty = (t) => `<p class="rp-muted">${t}</p>`;
  const maxCat = Math.max(1, ...r.categories.map((c) => c.value));
  const dot = (c) => (c.rest ? '#c7c7cc' : catColor(c.id));
  const maxShop = Math.max(1, ...r.merchants.map((m) => m.value));

  return `<article class="rp-page">
    <header class="rp-head">
      <div><p class="rp-kicker">Spendings · monthly report</p><h1>${cycleName(r.cycle, true)} ${r.cycle.slice(0, 4)}</h1>
        <p class="rp-muted">${cycleRange(r.cycle, settings.cycleStart)}${r.isCurrent ? ' · cycle still running, numbers so far' : ''}</p></div>
    </header>

    <div class="rp-tiles">
      ${tile('Money in', r.whole.income, 'rp-in')}
      ${tile('Spent', r.whole.spent)}
      ${tile(r.whole.kept >= 0 ? 'Kept' : 'Overspent', Math.abs(r.whole.kept), r.whole.kept >= 0 ? 'rp-in' : 'rp-neg')}
      ${tile('Refunds (money back)', r.whole.refunds)}
      ${tile(r.isCurrent ? 'Total money now' : 'Total money at the end', r.totalMoney)}
    </div>
    <p class="rp-note">${r.count} ${r.count === 1 ? 'entry' : 'entries'}.
      Spent is everything paid out; refunds count as money in, not taken off Spent.${r.prevSpent > 0 ? `Last cycle you spent ${aed(r.prevSpent)}.` : ''}
      ${r.review ? `<b>${r.review} still need a category.</b>` : ''}</p>

    ${section(`Allowance · ${esc(a.account)}`, `
      <div class="rp-allow">${bar(a.pot ? a.used / a.pot : 0, a.used > a.pot ? '#c4332b' : '#2a78d6')}
        <p><b>${aed(a.used)}</b> used of <b>${aed(a.pot)}</b> · ${a.left >= 0 ? `${aed(a.left)} left` : `<span class="rp-neg">${aed(-a.left)} over</span>`}</p>
        ${a.topUps || a.carryIn ? `<p class="rp-muted">Allowance ${aed(a.base)}${a.topUps ? ` + top-ups ${aed(a.topUps)}` : ''}${a.carryIn ? ` + ${aed(a.carryIn)} carried in` : ''}</p>` : ''}
      </div>`)}

    ${r.subsCount ? `<p class="rp-note">Subscriptions ${aed(r.subsMonthly)}/month across ${r.subsCount}.</p>` : ''}
    ${section('Where it went', r.categories.length ? `<table class="rp-table">${r.categories.map((c) => `<tr>
        <td class="rp-name"><i class="rp-dot" style="background:${dot(c)}"></i>${esc(c.name)}</td>
        <td class="rp-wide">${bar(c.value / maxCat, dot(c))}</td>
        <td class="rp-num">${fmt(c.shown)}${c.rest ? '' : change(c.value, c.prev)}</td>
        <td class="rp-pct">${c.pct}%</td></tr>`).join('')}</table>` : empty('No spending in this cycle.'))}

    ${r.budgets.length ? section('Budgets', `<table class="rp-table">${r.budgets.map((b) => `<tr>
        <td class="rp-name">${esc(b.name)}</td>
        <td class="rp-wide">${bar(b.spent / b.limit, b.spent > b.limit ? '#c4332b' : b.spent >= b.limit * 0.8 ? '#b5530f' : '#2d7a45')}</td>
        <td class="rp-num">${fmt(b.spent, { whole: true })} / ${fmt(b.limit, { whole: true })}</td></tr>`).join('')}</table>`) : ''}

    ${section('Top shops', r.merchants.length ? `<table class="rp-table">${r.merchants.map((m) => `<tr>
        <td class="rp-name">${esc(m.name)}${m.count ? `<small>${m.count}×</small>` : ''}</td>
        <td class="rp-wide">${bar(m.value / maxShop, m.rest ? '#c7c7cc' : catColor(m.category))}</td>
        <td class="rp-num">${fmt(m.shown)}</td></tr>`).join('')}</table>` : empty('No shops yet.'))}

    ${r.biggest.length ? section('Biggest payments', `<table class="rp-table">${r.biggest.map((e) => `<tr>
        <td class="rp-name">${esc(e.merchant || e.category || 'Payment')}<small>${day(e.date)} · ${esc(e.account)}</small></td>
        <td class="rp-num">${fmt(toAED(e, settings), { fixed: true })}</td></tr>`).join('')}</table>`) : ''}

    <div class="rp-cols">
      ${section('Money in', r.byIncome.length ? `<table class="rp-table">${r.byIncome.map(([k, v]) => `<tr><td class="rp-name">${esc(k)}</td><td class="rp-num">${fmt(v, { whole: true })}</td></tr>`).join('')}</table>` : empty('No income logged.'))}
      ${section('Spent by account', r.byAccount.length ? `<table class="rp-table">${r.byAccount.map((x) => `<tr><td class="rp-name">${esc(accountMeta(x.id).name)}</td><td class="rp-num">${fmt(x.spent, { whole: true })}</td></tr>`).join('')}</table>` : empty('Nothing spent.'))}
    </div>

    ${section(r.isCurrent ? 'Accounts now' : 'Accounts at the end', `<table class="rp-table">${r.accounts.map((x) => `<tr><td class="rp-name">${esc(accountMeta(x.id).name)}</td><td class="rp-num">${fmt(x.balance, { fixed: true })}</td></tr>`).join('')}
      <tr class="rp-total"><td class="rp-name">Total</td><td class="rp-num">${fmt(r.totalMoney, { fixed: true })}</td></tr></table>
      ${r.owedToYou || r.youOwe ? `<p class="rp-muted rp-owed">${[r.owedToYou ? `Owed to you ${aed(r.owedToYou)}` : '', r.youOwe ? `You owe ${aed(r.youOwe)}` : ''].filter(Boolean).join(' · ')}. Not counted in the total.</p>` : ''}
      ${r.moves ? `<p class="rp-muted">${r.moves} ${r.moves === 1 ? 'move' : 'moves'} between accounts (${aed(r.moved)}). Moving money isn’t spending, so it’s not counted above.</p>` : ''}`)}

    <footer class="rp-foot">Made by Spendings on ${day(new Date())} ${dubaiParts(new Date()).y} · amounts in AED</footer>
  </article>`;
}

// Fixed light styles, so the page prints the same in light or dark mode.
export const REPORT_CSS = `
.rp-page { --ink:#1c1c1e; --ink-2:#6e6e73; --line:#e5e5ea; background:#fff; color:var(--ink); font:15px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  padding:22px 20px; border-radius:20px; max-width:720px; margin:0 auto; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.rp-page h1 { font-size:28px; font-weight:700; letter-spacing:-0.02em; margin:2px 0; }
.rp-page h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-2); margin:0 0 8px; }
.rp-kicker { font-size:13px; font-weight:600; color:#1f66bd; margin:0; }
.rp-muted, .rp-note { color:var(--ink-2); font-size:13px; margin:4px 0 0; }
.rp-note b { color:#b5530f; }
.rp-tiles { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:16px 0 6px; }
.rp-tile { border:1px solid var(--line); border-radius:14px; padding:10px 12px; display:flex; flex-direction:column; gap:2px; }
.rp-tile span { font-size:12px; color:var(--ink-2); }
.rp-tile b { font-size:19px; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
.rp-in { color:#2d7a45; } .rp-neg { color:#c4332b; }
.rp-sec { border-top:1px solid var(--line); padding-top:14px; margin-top:16px; break-inside:avoid; page-break-inside:avoid; }
.rp-allow p { margin:6px 0 0; }
.rp-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.rp-table td { padding:5px 0; vertical-align:middle; }
.rp-name { max-width:0; width:42%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px !important; }
.rp-name small { color:var(--ink-2); margin-left:6px; font-size:12px; }
.rp-wide { width:34%; padding-right:10px !important; }
.rp-num { text-align:right; font-weight:600; white-space:nowrap; }
.rp-num small { display:block; font-weight:500; font-size:11px; }
.rp-up { color:#c4332b; } .rp-down { color:#2d7a45; }
.rp-pct { text-align:right; color:var(--ink-2); font-size:12px; width:38px; }
.rp-total td { border-top:1px solid var(--line); font-weight:700; padding-top:7px; }
.rp-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:7px; vertical-align:1px; }
.rp-bar { display:block; height:8px; border-radius:4px; background:#f2f2f7; overflow:hidden; }
.rp-bar i { display:block; height:100%; border-radius:4px; }
.rp-allow .rp-bar { height:12px; border-radius:6px; }
.rp-cols { display:grid; grid-template-columns:1fr 1fr; gap:0 18px; }
.rp-foot { margin-top:20px; font-size:11px; color:var(--ink-2); text-align:center; }
@media (min-width:560px) { .rp-tiles { grid-template-columns:repeat(4, 1fr); } }
@media print {
  @page { margin:12mm; }
  .rp-page { padding:0; border-radius:0; max-width:none; }
  .rp-tiles { grid-template-columns:repeat(4, 1fr); }
}`;

/* ───────────────────────── Saving and sharing ───────────────────────── */

const fileName = (cycle, ext) => `spendings-${cycle}-${cycleName(cycle, true).toLowerCase()}.${ext}`;

/** Hand a file to the iPhone share sheet (Save to Files, AirDrop, Print…); elsewhere, download it. */
async function deliver(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The report as a stand-alone web page, for sharing. */
const standalone = (r, html, hint = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spendings · ${cycleName(r.cycle, true)} ${r.cycle.slice(0, 4)}</title><style>body{margin:0;background:#fff}${REPORT_CSS}</style></head><body>${hint ? '<p style="font:14px -apple-system,Arial,sans-serif;color:#6e6e73;text-align:center;margin:12px 16px">To save a PDF: tap Share → Print, then pinch out on the preview.</p>' : ''}${html}</body></html>`;

/** Is this the Home Screen app, where the print sheet often doesn't open? */
const standaloneApp = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/** Open the report as its own page in a new tab, where Share → Print (pinch out) makes a PDF. */
function openPrintView(r, html) {
  const url = URL.createObjectURL(new Blob([standalone(r, html, true)], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return !!w;
}

/** Print just the report: iPhone's print sheet has "Save to Files" as PDF (or pinch the preview).
    From a Home Screen app, or where printing isn't there, open the report page instead. */
function printReport(r, html) {
  if (typeof window.print !== 'function' || standaloneApp()) {
    const opened = openPrintView(r, html);
    toast(opened ? 'Use Share → Print → pinch out to save a PDF' : 'Couldn’t open the report. Try Share report instead', { icon: icon('warn', { size: 18 }), tone: opened ? undefined : 'warn' });
    return;
  }
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = html;
  document.body.append(root);
  document.documentElement.classList.add('printing');
  const done = () => { root.remove(); document.documentElement.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 60_000); // in case afterprint never fires
}

/** Inject the report styles once, plus the print rule that hides the app while printing. */
function ensureStyles() {
  if (document.getElementById('report-css')) return;
  const st = document.createElement('style');
  st.id = 'report-css';
  st.textContent = `${REPORT_CSS}
#print-root { display:none; }
@media print { html.printing body > *:not(#print-root) { display:none !important; } html.printing #print-root { display:block; } html.printing, html.printing body { background:#fff !important; } }`;
  document.head.append(st);
}

/* ───────────────────────── The sheet ───────────────────────── */

/** Open the report for `cycle` (default: the cycle we're in). Arrows step through past cycles. */
export function openReport(cycle) {
  ensureStyles();
  const current = () => cycleOf(new Date(), state.settings.cycleStart);
  let cyc = cycle && cycle <= current() ? cycle : current();
  const build = () => cycleReport(state.entries, cyc, state.settings, state.plan, getExtra('budgets', null), new Date(), getExtra('recurring', { v: 1, ignored: [] }).ignored || []);
  let r = build();

  openSheet({
    label: 'Monthly report',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Monthly report</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <div class="cycle-switch report-switch glass">
        <button type="button" class="icon-btn" data-rcyc="-1" aria-label="Previous cycle">${icon('chevL', { size: 20 })}</button>
        <div class="cs-label"><b></b><span></span></div>
        <button type="button" class="icon-btn" data-rcyc="1" aria-label="Next cycle">${icon('chevR', { size: 20 })}</button>
      </div>
      <div class="sheet-scroll report-scroll"><div class="report-paper"></div></div>
      <div class="report-actions">
        <button type="button" class="btn-primary" data-act="pdf">${icon('download', { size: 18 })}Save as PDF</button>
        <button type="button" class="btn-tinted" data-act="share-report">${icon('link', { size: 18 })}Share report</button>
        <button type="button" class="btn-tinted" data-act="csv">${icon('sheet', { size: 18 })}Export CSV</button>
      </div>`,
    onMount(sheet, close) {
      const paint = () => {
        r = build();
        sheet.querySelector('.cs-label b').textContent = cycleName(cyc, false);
        sheet.querySelector('.cs-label span').textContent = cycleRange(cyc, state.settings.cycleStart);
        sheet.querySelector('[data-rcyc="1"]').disabled = cyc >= current();
        sheet.querySelector('.report-paper').innerHTML = reportHTML(r, state.settings);
        sheet.querySelector('.report-scroll').scrollTop = 0;
      };
      paint();
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        const step = ev.target.closest('[data-rcyc]');
        if (step) { cyc = shiftCycle(cyc, +step.dataset.rcyc); if (cyc > current()) cyc = current(); haptic(); return paint(); }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'pdf') { haptic(); printReport(r, reportHTML(r, state.settings)); }
        if (act === 'share-report') { haptic(); deliver(fileName(cyc, 'html'), standalone(r, reportHTML(r, state.settings)), 'text/html'); }
        if (act === 'csv') {
          haptic();
          if (!r.count) return toast('No entries in this cycle yet', { icon: icon('warn', { size: 18 }), tone: 'warn' });
          deliver(fileName(cyc, 'csv'), cycleCSV(state.entries, cyc), 'text/csv');
        }
      });
    },
  });
}
