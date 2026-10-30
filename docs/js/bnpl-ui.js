// Buy now, pay later on screen: the Home line, the plans sheet, the plan editor, "Link existing payment",
// the Settings row and the Insights panel. The maths lives in bnpl.js.
//
// Money rule: a plan never changes a balance. "Mark paid" logs a normal Spend entry through addEntry()
// (so balances, undo and the sheet sync work as for any payment); what's still owed is shown on its own.
import { ACCOUNTS, SPEND_CATEGORIES, accountMeta, money, fmt, dayKey, dayLabel, timeLabel, toAED, cycleBounds } from './model.js';
import { state, subscribe, getExtra, saveExtra, addEntry, together, undo } from './store.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';
import {
  PROVIDERS, CADENCES, readBnpl, bnplSummary, planState, dueBetween, instalmentAmounts, dueDates, paymentEntry,
  withPaid, withUnlinked, autoLink, linkCandidates, normalizePlan, shortDay, daysBetween,
} from './bnpl.js';

const KEY = 'bnpl';
const plans = () => readBnpl(getExtra(KEY, null)).plans;
const save = (list, label) => saveExtra(KEY, { v: 1, plans: list }, label);
const today = () => dayKey(new Date());
const title = (p) => [p.provider, p.merchant].filter(Boolean).join(' · ');
const aed = (n) => money(n); // "AED 600", "AED 224.75"
const whenText = (due) => {
  const d = daysBetween(today(), due);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${shortDay(due)}`;
};

/* ───── "Sync": link payments already in the ledger ─────
   Runs after every change to entries or extras (so before the screen that shows them settles).
   autoLink() is pure; it's only saved when it found something new, so this settles in one pass. */
function linkFound() {
  const cur = plans();
  if (!cur.length) return;
  const { plans: next, linked } = autoLink(cur, state.entries, state.settings);
  // the app did this, not you: it doesn't take a place in the Undo history
  if (linked) saveExtra(KEY, { v: 1, plans: next }, 'Linked BNPL payments', { undoable: false });
}
let queued = false;
subscribe((reason) => {
  if (reason === 'prefs' || reason === 'history' || queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; linkFound(); });
});
queueMicrotask(linkFound);

/* ───── Home ───── */

/** "BNPL: AED 624.75 owed · next AED 200 on 9 Nov". Nothing at all until a plan exists. */
export function bnplHomeRow() {
  const list = plans();
  if (!list.length) return '';
  const s = bnplSummary(list, state.entries, today());
  if (!s.owed) {
    return `<button type="button" class="bnpl-row" data-bnpl="open">
      <span class="row-icon" style="--tint:var(--good)">${icon('check', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">BNPL: all paid off</span><span class="row-sub">${list.length} ${list.length === 1 ? 'plan' : 'plans'} · nothing owed</span></span>
      ${icon('chevR', { size: 18, cls: 'chev' })}</button>`;
  }
  const late = s.overdue.length;
  const sub = late
    ? `<span class="warn-text">${aed(s.overdueAmount)} overdue since ${shortDay(s.overdue[0].due)}</span> · ${esc(s.overdue[0].plan.provider)}`
    : `Next ${aed(s.next.amount)} ${whenText(s.next.due)} · ${esc(s.next.plan.provider)}`;
  return `<button type="button" class="bnpl-row${late ? ' overdue' : ''}" data-bnpl="open">
    <span class="row-icon" style="--tint:${late ? 'var(--warn)' : 'var(--tint-text)'}">${icon(late ? 'warn' : 'calendar', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">BNPL: <b class="num">${aed(s.owed)}</b> owed</span><span class="row-sub">${sub}</span></span>
    ${icon('chevR', { size: 18, cls: 'chev' })}</button>`;
}

/** Clicks that open BNPL screens (from Home or Settings). Returns true when handled. */
export function bnplClick(t) {
  const b = t.closest('[data-bnpl]');
  if (!b) return false;
  haptic();
  if (b.dataset.bnpl === 'open') openBnpl();
  if (b.dataset.bnpl === 'new') openPlanEditor(null);
  return true;
}

/* ───── Settings ───── */

export function bnplSettingsBlock() {
  const list = plans();
  const s = bnplSummary(list, state.entries, today());
  return `<button type="button" class="row link-row" data-bnpl="open">
      <span class="row-icon" style="--tint:var(--tint-text)">${icon('calendar', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">Buy now, pay later</span>
        <span class="row-sub">${list.length ? `${list.length} ${list.length === 1 ? 'plan' : 'plans'} · ${aed(s.owed)} owed` : 'Tabby, Tamara, Postpay, card instalments'}</span></span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
}

/* ───── Insights ───── */

/** Owed now, and the instalments that fall due in the cycle on screen. */
export function bnplInsightsPanel(cyc, isCurrent) {
  const list = plans();
  if (!list.length) return '';
  const { start, end } = cycleBounds(cyc, state.settings.cycleStart);
  const due = dueBetween(list, state.entries, dayKey(start), dayKey(end), today());
  const s = bnplSummary(list, state.entries, today());
  const dueTotal = due.reduce((a, x) => a + x.amount, 0), paidTotal = due.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0);
  return `<section class="panel bnpl-panel">
    <h3 class="panel-title">Buy now, pay later</h3>
    <p class="panel-sub">${isCurrent ? `<b>${aed(s.owed)}</b> still owed. It isn’t spending until an instalment is paid, so it’s not in your balances. ` : ''}${due.length ? `${aed(dueTotal)} due ${isCurrent ? 'this cycle' : 'in this cycle'}, ${aed(paidTotal)} paid.` : `Nothing due ${isCurrent ? 'this cycle' : 'in this cycle'}.`}</p>
    ${due.length ? `<div class="bn-due">${due.map((x) => `<div class="bn-due-row">
        <span class="bn-when num">${shortDay(x.due)}</span>
        <span class="bn-what"><b>${esc(title(x.plan))}</b><small>${x.i + 1} of ${x.plan.count}</small></span>
        <span class="bn-amt num">${fmt(x.amount, { fixed: true })}</span>
        <span class="bn-state ${x.paid ? 'paid' : x.overdue ? 'late' : ''}">${x.paid ? icon('check', { size: 16, label: 'Paid' }) : x.overdue ? 'Overdue' : 'Due'}</span></div>`).join('')}</div>` : ''}
  </section>`;
}

/* ───── The plans sheet ───── */

function planCard(st) {
  const p = st.plan, n = st.list.length;
  const meta = [p.item, p.category, accountMeta(p.account).name].filter(Boolean).map(esc).join(' · ');
  return `<article class="bn-plan${st.overdue.length ? ' overdue' : ''}" data-plan="${esc(p.id)}">
    <div class="bn-head">
      <div class="bn-title"><b>${esc(title(p))}</b><span>${meta}</span></div>
      <button type="button" class="text-btn" data-bn-act="edit">Edit</button>
    </div>
    <div class="bn-progress" role="img" aria-label="${st.paidCount} of ${n} paid">${st.list.map((x) => `<i class="${x.paid ? 'paid' : x.overdue ? 'late' : ''}"></i>`).join('')}</div>
    <p class="bn-sum"><b>${st.paidCount} of ${n} paid</b> · ${st.done ? 'all paid off' : `${aed(st.owed)} left`} · ${aed(p.total)} in ${n}</p>
    <div class="bn-list">${st.list.map((x) => {
      const rec = p.paid?.[x.i];
      const how = !x.paid ? (x.overdue ? `<span class="warn-text">Overdue · was due ${shortDay(x.due)}</span>` : `Due ${whenText(x.due)}`)
        : rec?.entry === '' ? 'Paid before tracking' : rec?.auto ? 'Found in your payments' : 'Paid';
      const right = x.paid
        ? `<span class="bn-done">${icon('check', { size: 16 })}</span><button type="button" class="text-btn bn-small" data-bn-act="unlink" data-i="${x.i}" aria-label="Mark instalment ${x.i + 1} as not paid">${rec?.entry ? 'Unlink' : 'Unmark'}</button>`
        : `<button type="button" class="icon-btn bn-link" data-bn-act="link" data-i="${x.i}" aria-label="Link an existing payment to instalment ${x.i + 1}">${icon('link', { size: 18 })}</button><button type="button" class="pd-btn" data-bn-act="pay" data-i="${x.i}">Mark paid</button>`;
      return `<div class="bn-inst${x.paid ? ' paid' : ''}">
        <span class="bn-n num">${x.i + 1}</span>
        <span class="bn-main"><b class="num">${aed(x.amount)}</b><span>${how}${x.paid ? ` · ${shortDay(x.due)}` : ''}</span></span>
        ${right}</div>`;
    }).join('')}</div>
  </article>`;
}

function sheetBody() {
  const list = plans();
  if (!list.length) {
    return `<div class="empty">${icon('calendar', { size: 30 })}<p>No plans yet.</p><p class="muted">Add a Tabby, Tamara or card instalment plan to see what’s still owed and when.</p></div>`;
  }
  const s = bnplSummary(list, state.entries, today());
  // plans still running first (earliest next instalment first), finished ones at the end
  const order = [...s.states].sort((a, b) => (a.done - b.done) || ((a.next?.due || '') < (b.next?.due || '') ? -1 : 1));
  return `<div class="bn-total"><span>Still owed</span><b class="num">${aed(s.owed)}</b>${s.next ? `<small>Next ${aed(s.next.amount)} ${whenText(s.next.due)}</small>` : ''}</div>
    ${order.map(planCard).join('')}`;
}

export function openBnpl() {
  let off = null;
  openSheet({
    label: 'Buy now, pay later',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Buy now, pay later</h2><button class="text-btn strong" data-bn-act="done" type="button">Done</button></header>
      <p class="sheet-lede">Instalments count as spending when they’re paid. Payments already logged (Apple Pay, bank) are linked by themselves when the name and amount match.</p>
      <div class="sheet-scroll bn-sheet">
        <div class="bn-body">${sheetBody()}</div>
        <button type="button" class="dup-btn" data-bn-act="new">${icon('plus', { size: 18 })}Add BNPL plan</button>
      </div>`,
    onClose: () => off?.(),
    onMount(sheet, close) {
      const body = sheet.querySelector('.bn-body');
      // keep the list current while it's open (a payment logged, a link found, an undo)
      off = subscribe((r) => { if (r !== 'prefs' && r !== 'history') body.innerHTML = sheetBody(); });
      sheet.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-bn-act]');
        if (!b) return;
        const act = b.dataset.bnAct, id = b.closest('[data-plan]')?.dataset.plan, i = +b.dataset.i;
        const p = plans().find((x) => x.id === id);
        if (act === 'done') return close();
        if (act === 'new') { haptic(); return openPlanEditor(null); }
        if (!p) return;
        if (act === 'edit') { haptic(); openPlanEditor(p); }
        if (act === 'pay') markPaid(p, i);
        if (act === 'link') { haptic(); openLink(p, i); }
        if (act === 'unlink') unmark(p, i);
      });
    },
  });
}

/* ───── Paying ───── */

/** Logs the instalment as a normal Spend (balances, sheet and undo as usual) and links it. One Undo reverses both. */
function markPaid(p, i) {
  haptic();
  const label = `Paid ${title(p)} ${i + 1} of ${p.count}`;
  const e = together(label, () => {
    const entry = addEntry(paymentEntry(p, i));
    save(plans().map((x) => (x.id === p.id ? withPaid(x, i, entry.id, dayKey(entry.date)) : x)), label);
    return entry;
  });
  toast(`Paid ${aed(e.amount)} · ${esc(title(p))} ${i + 1} of ${p.count}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
}

/** Back to unpaid. The payment entry stays in the ledger (it's a real payment); delete it in Activity if it was a mistake. */
function unmark(p, i) {
  haptic();
  const rec = p.paid?.[i];
  save(plans().map((x) => (x.id === p.id ? withUnlinked(x, i) : x)), `Unlinked ${title(p)} ${i + 1} of ${p.count}`);
  toast(rec?.entry ? 'Not paid any more. The payment itself is still in Activity.' : 'Marked as not paid', { action: 'Undo', onAction: () => undo(), icon: icon('undo', { size: 18 }) });
}

/* ───── Link an existing payment ───── */

function openLink(p, i) {
  const amount = instalmentAmounts(p.total, p.count)[i], due = dueDates(p.first, p.count, p.cadence)[i];
  const found = linkCandidates(p, i, plans(), state.entries, state.settings);
  openSheet({
    label: 'Link a payment', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Instalment ${i + 1} of ${p.count}</h2><span class="icon-btn-spacer"></span></header>
      <p class="sheet-lede">${aed(amount)} due ${shortDay(due)}. Pick the payment that paid it, so it isn’t counted twice.</p>
      <div class="sheet-scroll">
        <section class="group bn-cands">${found.length ? found.map((e) => `<button type="button" class="row link-row" data-entry="${esc(e.id)}">
            <span class="row-main"><span class="row-title">${esc(e.merchant || e.category || 'Payment')}</span><span class="row-sub">${esc(accountMeta(e.account).name)} · ${dayLabel(dayKey(e.date))}, ${timeLabel(e.date)}</span></span>
            <b class="num">${fmt(toAED(e, state.settings), { fixed: true })}</b></button>`).join('')
          : `<div class="empty"><p>No payments near ${shortDay(due)}.</p><p class="muted">Payments within a month of the due day show here.</p></div>`}</section>
        <button type="button" class="dup-btn" data-entry="">${icon('check', { size: 18 })}Paid before I started tracking</button>
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="cancel"]')) return close();
        const b = ev.target.closest('[data-entry]');
        if (!b) return;
        haptic();
        const entryId = b.dataset.entry, e = state.entries.find((x) => x.id === entryId);
        save(plans().map((x) => (x.id === p.id ? withPaid(x, i, entryId, e ? dayKey(e.date) : today()) : x)), `Linked ${title(p)} ${i + 1} of ${p.count}`);
        close();
        toast(entryId ? `Linked · ${title(p)} ${i + 1} of ${p.count}` : `Marked paid · nothing logged`, { icon: icon('link', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
      });
    },
  });
}

/* ───── Plan editor ───── */

export function openPlanEditor(existing) {
  const p = existing ? { ...existing } : {
    id: 'bn-' + Math.random().toString(36).slice(2, 10), provider: 'Tabby', merchant: '', item: '', category: 'Shopping',
    total: 0, count: 4, cadence: '2w', first: today(), account: state.settings.allowanceAccount, paid: [], skip: [],
  };
  const accOpts = ACCOUNTS.map((a) => `<option ${a.id === p.account ? 'selected' : ''}>${esc(a.id)}</option>`).join('')
    + (p.account && !ACCOUNTS.some((a) => a.id === p.account) ? `<option selected>${esc(p.account)}</option>` : '');
  openSheet({
    label: 'BNPL plan', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? 'Edit plan' : 'New BNPL plan'}</h2><button class="text-btn strong" data-act="save" type="button">Save</button></header>
      <div class="sheet-scroll plan-form bn-form">
        <section class="group form">
          <label class="row input-row"><span>Provider</span><input id="bn-provider" type="text" list="bn-providers" value="${esc(p.provider)}" placeholder="Tabby" maxlength="30" autocomplete="off" autocapitalize="words"></label>
          <datalist id="bn-providers">${PROVIDERS.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
          <label class="row input-row"><span>Shop</span><input id="bn-merchant" type="text" value="${esc(p.merchant)}" placeholder="e.g. Noon" maxlength="40" autocomplete="off" autocapitalize="words"></label>
          <label class="row input-row"><span>What was it</span><input id="bn-item" type="text" value="${esc(p.item)}" placeholder="e.g. AirPods" maxlength="60" autocomplete="off"></label>
          <label class="row input-row"><span>Category</span><select id="bn-category">${SPEND_CATEGORIES.map((c) => `<option ${c.id === p.category ? 'selected' : ''}>${esc(c.id)}</option>`).join('')}</select></label>
        </section>
        <section class="group form">
          <label class="row input-row"><span>Total</span><span class="suffix-input"><em>AED</em><input id="bn-total" type="number" inputmode="decimal" min="0" step="any" value="${p.total || ''}" placeholder="0"></span></label>
          <label class="row input-row"><span>Instalments</span><select id="bn-count">${Array.from({ length: 12 }, (_, k) => k + 1).map((k) => `<option ${k === +p.count ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label class="row input-row"><span>How often</span><select id="bn-cadence">${CADENCES.map((c) => `<option value="${c.id}" ${c.id === p.cadence ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
          <label class="row input-row"><span>First due</span><input id="bn-first" type="date" value="${esc(p.first)}"></label>
          <label class="row input-row"><span>Paid from</span><select id="bn-account">${accOpts}</select></label>
          ${existing ? '' : `<label class="row input-row"><span>Already paid</span><select id="bn-already"><option value="0">None yet</option></select></label>`}
        </section>
        <p class="group-foot bn-preview"></p>
        ${existing ? '<button type="button" class="dup-btn danger-btn" data-act="delete">Delete plan</button>' : ''}
      </div>`,
    onMount(sheet, close) {
      const $ = (s) => sheet.querySelector(s);
      const read = () => normalizePlan({
        ...p, provider: $('#bn-provider').value, merchant: $('#bn-merchant').value, item: $('#bn-item').value,
        category: $('#bn-category').value, total: parseFloat($('#bn-total').value) || 0, count: +$('#bn-count').value,
        cadence: $('#bn-cadence').value, first: $('#bn-first').value, account: $('#bn-account').value,
      });
      // the schedule as you type: "4 × AED 224.75, every 2 weeks · last on 6 Dec"
      const preview = () => {
        const q = read(), a = instalmentAmounts(q.total, q.count), d = dueDates(q.first, q.count, q.cadence);
        const already = $('#bn-already');
        if (already) {
          const keep = Math.min(+already.value || 0, q.count - 1);
          // the first instalment is usually taken at the till: those can be marked paid now, with nothing logged
          already.innerHTML = Array.from({ length: q.count }, (_, k) => `<option value="${k}" ${k === keep ? 'selected' : ''}>${k === 0 ? 'None yet' : `First ${k} · before tracking`}</option>`).join('');
        }
        const same = a.every((x) => x === a[0]);
        $('.bn-preview').textContent = !(q.total > 0) ? 'Type the total you’ll pay, fees included.'
          : `${same ? `${a.length} × ${aed(a[0])}` : `${a.length - 1} × ${aed(a[0])}, then ${aed(a[a.length - 1])}`}, ${q.cadence === '1m' ? 'monthly' : 'every 2 weeks'} · ${a.length > 1 ? `last on ${shortDay(d[d.length - 1])}` : `due ${shortDay(d[0])}`}. Your balances don’t change until you pay.`;
      };
      sheet.addEventListener('input', preview);
      sheet.addEventListener('change', preview);
      preview();
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a === 'cancel') close();
        if (a === 'delete') {
          haptic();
          save(plans().filter((x) => x.id !== p.id), `Deleted ${title(p)} plan`);
          close();
          toast(`Deleted ${esc(title(p))} plan · payments stay in Activity`, { action: 'Undo', onAction: () => undo(), icon: icon('trash', { size: 18 }) });
        }
        if (a === 'save') {
          const q = read();
          if (!(q.total > 0)) { haptic(); $('#bn-total').focus(); $('.bn-preview').textContent = 'Type the total first.'; return; }
          if (!existing) {
            const already = +($('#bn-already')?.value || 0);
            for (let k = 0; k < already; k++) q.paid[k] = { entry: '', on: today() };
          }
          const list = existing ? plans().map((x) => (x.id === p.id ? q : x)) : [...plans(), q];
          save(list, existing ? `Edited ${title(q)} plan` : `Added ${title(q)} plan`);
          haptic();
          close();
          toast(`${existing ? 'Saved' : 'Added'} ${esc(title(q))} · ${aed(planState(q, state.entries).owed)} to pay`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
        }
      });
    },
  });
}
