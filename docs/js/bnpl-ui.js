// Buy now, pay later on screen: the Home line, the plans sheet, the plan editor, "Link a payment",
// the Settings row and the Insights panel. The maths lives in bnpl.js.
//
// Money rule: a plan never changes a balance. "Mark paid" logs a normal Spend entry through addEntry()
// (so balances, undo and the sheet sync work as for any payment); what's still to pay is shown on its own.
// On screen it's "Buy now, pay later" and "payment", never "BNPL" or "instalment".
import { ACCOUNTS, accountMeta, categoryMeta, pickerCategories, money, fmt, dayKey, dayLabel, timeLabel, toAED, cycleBounds, cycleOf } from './model.js';
import { state, subscribe, getExtra, saveExtra, addEntry, batch, topUndoId } from './store.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';
import { doUndo } from './views.js';
import {
  PROVIDERS, CADENCES, readBnpl, bnplSummary, bnplNotice, planState, dueBetween, instalmentAmounts, dueDates, paymentEntry,
  withPaid, withUnlinked, autoLink, likelyPayment, linkCandidates, normalizePlan, shortDay, daysBetween,
} from './bnpl.js';

const KEY = 'bnpl';
const plans = () => readBnpl(getExtra(KEY, null)).plans;
const pack = (list) => ({ v: 1, plans: list });
const today = () => dayKey(new Date());
const title = (p) => [p.provider, p.merchant].filter(Boolean).join(' · ');
const aed = (n) => money(n); // "AED 600", "AED 224.75"
const catLabel = (id) => categoryMeta(id)?.label || id;
const whenText = (due) => {
  const d = daysBetween(today(), due);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${shortDay(due)}`;
};
/** The next cycle's first day (payday), for "AED X due before payday". */
const payday = () => { const cs = state.settings.cycleStart; return dayKey(cycleBounds(cycleOf(new Date(), cs), cs).end); };
/** Toast Undo that only undoes the step it was made for (same as activity.js): if something else happened
    since, a stale toast says so instead of undoing that other thing. Call with topUndoId() right after the change. */
const undoThis = (tok) => () => { if (topUndoId() === tok) doUndo(); else toast('Something changed since, so this Undo is off.'); };
const patch = (list, id, f) => list.map((x) => (x.id === id ? f(x) : x));

/* ───── Saving, with an Undo that touches only what changed ─────
   The plans are one Extras value, and the app links payments into it by itself between your changes.
   saveExtra's default Undo would put the whole old list back and wipe those links, so every change here
   passes its own reverse: a function of the plans AS THEY ARE at undo time that takes back only this change
   (one plan's fields, one link, one added or deleted plan). */
function change(label, apply, reverse) {
  saveExtra(KEY, pack(apply(plans())), label, { reverse: () => saveExtra(KEY, pack(reverse(plans())), label) });
}

/** Link payment i of plan `id` to an entry ('' = paid before tracking). Undo clears it only if it still points there. */
function linkTo(id, i, entryId, on, label) {
  change(label,
    (list) => patch(list, id, (x) => withPaid(x, i, entryId, on)),
    (list) => patch(list, id, (x) => (x.paid?.[i]?.entry === entryId ? withPaid(x, i, null) : x)));
}

/** "Not this payment" for several links at once ({ planId, i, entry }). Each is unpaid again and its entry is
    never auto-linked to that plan again. Undo puts back the links whose places are still empty. */
function unlinkMany(links, label) {
  const was = links.map((l) => {
    const p = plans().find((x) => x.id === l.planId);
    return { ...l, rec: p?.paid?.[l.i] || null, hadSkip: (p?.skip || []).includes(l.entry) };
  }).filter((l) => l.rec && l.rec.entry === l.entry);
  if (!was.length) return 0;
  change(label,
    (list) => was.reduce((acc, l) => patch(acc, l.planId, (x) => withUnlinked(x, l.i)), list),
    (list) => was.reduce((acc, l) => patch(acc, l.planId, (x) => {
      if (x.paid?.[l.i]) return x; // filled again since: leave it
      const back = withPaid(x, l.i, l.rec.entry, l.rec.on, l.rec.auto ? { auto: true } : {});
      return l.hadSkip ? back : { ...back, skip: (x.skip || []).filter((s) => s !== l.entry) };
    }), list));
  return was.length;
}

/* ───── "Sync": link payments already in the ledger ─────
   Runs after every change to entries or extras. autoLink() is pure; it's only saved when it found
   something new, so this settles in one pass. Every new link is announced with an Unlink action. */
function linkFound() {
  const cur = plans();
  if (!cur.length) return;
  const { plans: next, links } = autoLink(cur, state.entries, state.settings);
  if (!links.length) return;
  // the app did this, not you: it doesn't take a place in the Undo history (the toast's Unlink takes it back)
  saveExtra(KEY, pack(next), 'Linked payments', { undoable: false });
  // demo mode links its own made-up payments on every start: nothing new to tell anyone
  if (state.prefs.demo && links.every((l) => l.entry.startsWith('d-'))) return;
  announce(links, next);
}
function announce(links, list) {
  let text;
  if (links.length === 1) {
    const l = links[0], p = list.find((x) => x.id === l.planId), e = state.entries.find((x) => x.id === l.entry);
    text = `Linked ${esc(e?.merchant || 'a payment')} ${aed(e ? toAED(e, state.settings) : 0)} to ${esc(p.merchant || p.provider)} · ${l.i + 1} of ${p.count}`;
  } else {
    const names = [...new Set(links.map((l) => { const p = list.find((x) => x.id === l.planId); return p.merchant || p.provider; }))];
    text = `Linked ${links.length} payments to ${esc(names.join(', '))}`;
  }
  toast(text, {
    icon: icon('link', { size: 18 }), tone: 'good', duration: 8000, action: 'Unlink',
    onAction: () => { if (unlinkMany(links, links.length === 1 ? 'Unlinked a payment' : `Unlinked ${links.length} payments`)) toast('Unlinked. It stays in Activity as a normal payment.', { icon: icon('undo', { size: 18 }) }); },
  });
}
let queued = false;
subscribe((reason) => {
  if (reason === 'prefs' || reason === 'history' || queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; linkFound(); });
});
queueMicrotask(linkFound);

/* ───── Home ───── */

/** "Buy now, pay later: AED 624.75 still to pay · next AED 200 on 9 Nov", only when a payment is due within
    7 days or overdue (see bnplNotice). "AED X due before payday" is information only: it's never taken off a
    balance or Safe to spend. */
export function bnplHomeRow() {
  const n = bnplNotice(plans(), state.entries, today(), payday());
  if (!n) return '';
  const late = n.priority === 'overdue';
  return `<button type="button" class="bnpl-row${late ? ' overdue' : ''}" data-bnpl="open">
    <span class="row-icon" style="--tint:${late ? 'var(--warn)' : 'var(--tint-text)'}">${icon(late ? 'warn' : 'calendar', { size: 20 })}</span>
    <span class="row-main"><span class="row-title num${late ? ' warn-text' : ''}">${esc(n.text)}</span>${n.sub ? `<span class="row-sub num">${esc(n.sub)}</span>` : ''}</span>
    ${icon('chevR', { size: 18, cls: 'chev' })}</button>`;
}

/** Clicks that open these screens (from Home or Settings). Returns true when handled. */
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
        <span class="row-sub">${list.length ? `${list.length} ${list.length === 1 ? 'plan' : 'plans'} · ${aed(s.owed)} still to pay` : 'Tabby, Tamara, Postpay, card plans'}</span></span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
}

/* ───── Insights ───── */

/** Still to pay now, and the payments that fall due in the cycle on screen. */
export function bnplInsightsPanel(cyc, isCurrent) {
  const list = plans();
  if (!list.length) return '';
  const { start, end } = cycleBounds(cyc, state.settings.cycleStart);
  const due = dueBetween(list, state.entries, dayKey(start), dayKey(end), today());
  const s = bnplSummary(list, state.entries, today());
  const dueTotal = due.reduce((a, x) => a + x.amount, 0), paidTotal = due.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0);
  return `<section class="panel bnpl-panel">
    <h3 class="panel-title">Buy now, pay later</h3>
    <p class="panel-sub">${isCurrent ? `<b>${aed(s.owed)}</b> still to pay. It isn’t spending until a payment is made, so it’s not in your balances. ` : ''}${due.length ? `${aed(dueTotal)} due ${isCurrent ? 'this cycle' : 'in this cycle'}, ${aed(paidTotal)} paid.` : `Nothing due ${isCurrent ? 'this cycle' : 'in this cycle'}.`}</p>
    ${due.length ? `<div class="bn-due">${due.map((x) => `<div class="bn-due-row">
        <span class="bn-when num">${shortDay(x.due)}</span>
        <span class="bn-what"><b>${esc(title(x.plan))}</b><small>${x.i + 1} of ${x.plan.count}</small></span>
        <span class="bn-amt num">${fmt(x.amount, { fixed: true })}</span>
        <span class="bn-state ${x.paid ? 'paid' : x.overdue ? 'late' : ''}">${x.paid ? icon('check', { size: 16, label: 'Paid' }) : x.overdue ? 'Overdue' : 'Due'}</span></div>`).join('')}</div>` : ''}
  </section>`;
}

/* ───── The plans sheet ───── */

/** "TABBY*NOON · AED 224.75 · 2 Oct": the ledger payment a paid row is linked to. */
const paidWith = (e) => [e.merchant || catLabel(e.category) || 'Payment', aed(toAED(e, state.settings)), shortDay(dayKey(e.date))].map(esc).join(' · ');

function planCard(st) {
  const p = st.plan, n = st.list.length;
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  const meta = [p.item, catLabel(p.category), accountMeta(p.account).name].filter(Boolean).map(esc).join(' · ');
  return `<article class="bn-plan${st.overdue.length ? ' overdue' : ''}" data-plan="${esc(p.id)}">
    <div class="bn-head">
      <div class="bn-title"><b>${esc(title(p))}</b><span>${meta}</span></div>
      <button type="button" class="text-btn" data-bn-act="edit">Edit</button>
    </div>
    <div class="bn-progress" role="img" aria-label="${st.paidCount} of ${n} paid">${st.list.map((x) => `<i class="${x.paid ? 'paid' : x.overdue ? 'late' : ''}"></i>`).join('')}</div>
    <p class="bn-sum"><b>${st.paidCount} of ${n} paid</b> · ${st.done ? 'all paid off' : `${aed(st.owed)} left`} · ${aed(p.total)} in ${n} ${n === 1 ? 'payment' : 'payments'}</p>
    <div class="bn-list">${st.list.map((x) => {
      const rec = p.paid?.[x.i], e = x.paid && rec?.entry ? byId.get(rec.entry) : null;
      const how = !x.paid ? (x.overdue ? `<span class="warn-text">Overdue · was due ${shortDay(x.due)}</span>` : `Due ${whenText(x.due)}`)
        : !e ? 'Paid before tracking' : `${rec.auto ? 'Found: ' : 'Paid: '}${paidWith(e)}`;
      const right = x.paid
        ? `<span class="bn-done">${icon('check', { size: 16 })}</span><button type="button" class="text-btn bn-small" data-bn-act="unlink" data-i="${x.i}" aria-label="Payment ${x.i + 1}: ${e ? 'not this payment' : 'not paid'}">${e ? 'Not this payment' : 'Not paid'}</button>`
        : `<button type="button" class="icon-btn bn-link" data-bn-act="link" data-i="${x.i}" aria-label="Link a payment you already made to payment ${x.i + 1}">${icon('link', { size: 18 })}</button><button type="button" class="pd-btn" data-bn-act="pay" data-i="${x.i}">Mark paid</button>`;
      return `<div class="bn-inst${x.paid ? ' paid' : ''}">
        <span class="bn-n num">${x.i + 1}</span>
        <span class="bn-main"><b class="num">${aed(x.amount)}</b><span>${how}</span></span>
        ${right}</div>`;
    }).join('')}</div>
  </article>`;
}

function sheetBody() {
  const list = plans();
  if (!list.length) {
    return `<div class="empty">${icon('calendar', { size: 30 })}<p>No plans yet.</p><p class="muted">Add a Tabby, Tamara or card plan to see what’s still to pay and when.</p></div>`;
  }
  const s = bnplSummary(list, state.entries, today());
  // plans still running first (earliest next payment first), finished ones at the end
  const order = [...s.states].sort((a, b) => (a.done - b.done) || ((a.next?.due || '') < (b.next?.due || '') ? -1 : (a.next?.due || '') > (b.next?.due || '') ? 1 : 0));
  return `<div class="bn-total"><span>Still to pay</span><b class="num">${aed(s.owed)}</b>${s.next ? `<small>Next ${aed(s.next.amount)} ${whenText(s.next.due)}</small>` : ''}</div>
    ${order.map(planCard).join('')}`;
}

export function openBnpl() {
  let off = null;
  openSheet({
    label: 'Buy now, pay later',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Buy now, pay later</h2><button class="text-btn strong" data-bn-act="done" type="button">Done</button></header>
      <p class="sheet-lede">Each payment counts as spending when it’s paid. Payments already logged (Apple Pay, bank) are linked by themselves when the name and amount match.</p>
      <div class="sheet-scroll bn-sheet">
        <div class="bn-body">${sheetBody()}</div>
        <button type="button" class="dup-btn" data-bn-act="new">${icon('plus', { size: 18 })}Add a plan</button>
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
        if (act === 'pay') markPaid(p.id, i);
        if (act === 'link') { haptic(); openLink(p, i); }
        if (act === 'unlink') unmark(p, i);
      });
    },
  });
}

/* ───── Paying ───── */

/** Mark paid. If a payment already in the ledger is probably this one, ask first (link it, or log a new one),
    so the same money is never counted twice. */
function markPaid(id, i) {
  haptic();
  const p = plans().find((x) => x.id === id);
  if (!p || planState(p, state.entries).list[i]?.paid) return;
  const hit = likelyPayment(p, i, plans(), state.entries, state.settings);
  if (hit) askLinkOrLog(p, i, hit);
  else logPayment(p, i);
}

/** Logs the payment as a normal Spend (balances, sheet and undo as usual) and links it. One Undo reverses both. */
function logPayment(p, i) {
  const label = `Paid ${title(p)} ${i + 1} of ${p.count}`;
  let entry; // batch() returns how many changes it made, so the new entry comes out through this
  batch(label, () => {
    entry = addEntry(paymentEntry(p, i));
    linkTo(p.id, i, entry.id, dayKey(entry.date), label); // recorded into the same batch step
  });
  toast(`Paid ${aed(entry.amount)} · ${esc(title(p))} ${i + 1} of ${p.count}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: undoThis(topUndoId()) });
}

function linkExisting(p, i, e) {
  linkTo(p.id, i, e.id, dayKey(e.date), `Linked ${title(p)} ${i + 1} of ${p.count}`);
  toast(`Linked · ${esc(title(p))} ${i + 1} of ${p.count} · nothing new logged`, { icon: icon('link', { size: 18 }), tone: 'good', action: 'Undo', onAction: undoThis(topUndoId()) });
}

function askLinkOrLog(p, i, e) {
  const amount = instalmentAmounts(p.total, p.count)[i];
  openSheet({
    label: 'Already paid?', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Payment ${i + 1} of ${p.count}</h2><span class="icon-btn-spacer"></span></header>
      <p class="sheet-lede">${aed(amount)} for ${esc(title(p))}. This payment is already in Activity and looks like it. Link it, so it isn’t counted twice.</p>
      <div class="bn-ask">
        <button type="button" class="btn-primary" data-act="link">Link this payment (${paidWith(e)})</button>
        <button type="button" class="dup-btn" data-act="log">Log a new payment</button>
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (!a) return;
        haptic();
        close();
        if (a === 'link') linkExisting(p, i, e);
        if (a === 'log') logPayment(p, i);
      });
    },
  });
}

/** Back to unpaid. The payment entry stays in the ledger (it's a real payment); delete it in Activity if it was a mistake. */
function unmark(p, i) {
  haptic();
  const rec = p.paid?.[i];
  if (!rec) return;
  const label = `Unlinked ${title(p)} ${i + 1} of ${p.count}`;
  if (rec.entry) unlinkMany([{ planId: p.id, i, entry: rec.entry }], label);
  else {
    change(label,
      (list) => patch(list, p.id, (x) => withPaid(x, i, null)),
      (list) => patch(list, p.id, (x) => (x.paid?.[i] ? x : withPaid(x, i, '', rec.on))));
  }
  toast(rec.entry ? 'Not this payment. It stays in Activity as a normal payment.' : 'Marked as not paid', { action: 'Undo', onAction: undoThis(topUndoId()), icon: icon('undo', { size: 18 }) });
}

/* ───── Link a payment by hand ───── */

function openLink(p, i) {
  const amount = instalmentAmounts(p.total, p.count)[i], due = dueDates(p.first, p.count, p.cadence)[i];
  const found = linkCandidates(p, i, plans(), state.entries, state.settings);
  openSheet({
    label: 'Link a payment', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Payment ${i + 1} of ${p.count}</h2><span class="icon-btn-spacer"></span></header>
      <p class="sheet-lede">${aed(amount)} due ${shortDay(due)}. Pick the payment that paid it, so it isn’t counted twice.</p>
      <div class="sheet-scroll">
        <section class="group bn-cands">${found.length ? found.map((e) => `<button type="button" class="row link-row" data-entry="${esc(e.id)}">
            <span class="row-main"><span class="row-title">${esc(e.merchant || catLabel(e.category) || 'Payment')}</span><span class="row-sub">${esc(accountMeta(e.account).name)} · ${dayLabel(dayKey(e.date))}, ${timeLabel(e.date)}</span></span>
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
        close();
        const entryId = b.dataset.entry, e = state.entries.find((x) => x.id === entryId);
        if (e) return linkExisting(p, i, e);
        linkTo(p.id, i, '', today(), `Marked ${title(p)} ${i + 1} of ${p.count} paid`);
        toast('Marked paid · not added to spending', { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: undoThis(topUndoId()) });
      });
    },
  });
}

/* ───── Plan editor ───── */

// what the editor changes; paid and skip are never taken from the form, always from the plan as it is now
const FIELDS = ['provider', 'merchant', 'item', 'category', 'total', 'count', 'cadence', 'first', 'account'];
const pick = (o) => Object.fromEntries(FIELDS.map((k) => [k, o[k]]));
/** Once a payment is paid, the total and the number of payments are fixed, so paid amounts never change. */
const locked = (p) => !!p && planState(p, state.entries).paidCount > 0;

export function openPlanEditor(existing) {
  const p = existing ? { ...existing } : {
    id: 'bn-' + Math.random().toString(36).slice(2, 10), provider: 'Tabby', merchant: '', item: '', category: 'Shopping',
    total: 0, count: 4, cadence: '2w', first: today(), account: state.settings.allowanceAccount, paid: [], skip: [],
  };
  const lock = locked(existing);
  const accOpts = ACCOUNTS.map((a) => `<option ${a.id === p.account ? 'selected' : ''}>${esc(a.id)}</option>`).join('')
    + (p.account && !ACCOUNTS.some((a) => a.id === p.account) ? `<option selected>${esc(p.account)}</option>` : '');
  openSheet({
    label: 'Buy now, pay later plan', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? 'Edit plan' : 'New plan'}</h2><button class="text-btn strong" data-act="save" type="button">Save</button></header>
      <div class="sheet-scroll plan-form bn-form">
        <section class="group form">
          <label class="row input-row"><span>Provider</span><input id="bn-provider" type="text" list="bn-providers" value="${esc(p.provider)}" placeholder="Tabby" maxlength="30" autocomplete="off" autocapitalize="words"></label>
          <datalist id="bn-providers">${PROVIDERS.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
          <label class="row input-row"><span>Shop</span><input id="bn-merchant" type="text" value="${esc(p.merchant)}" placeholder="e.g. Noon" maxlength="40" autocomplete="off" autocapitalize="words"></label>
          <label class="row input-row"><span>What was it</span><input id="bn-item" type="text" value="${esc(p.item)}" placeholder="e.g. AirPods" maxlength="60" autocomplete="off"></label>
          <label class="row input-row"><span>Category</span><select id="bn-category">${pickerCategories('Spend', p.category).map((c) => `<option value="${esc(c.id)}" ${c.id === p.category ? 'selected' : ''}>${esc(c.label || c.id)}</option>`).join('')}</select></label>
        </section>
        <section class="group form">
          <label class="row input-row"><span>Total</span><span class="suffix-input"><em>AED</em><input id="bn-total" type="number" inputmode="decimal" min="0" step="any" value="${p.total || ''}" placeholder="0" ${lock ? 'disabled' : ''}></span></label>
          <label class="row input-row"><span>Payments</span><select id="bn-count" ${lock ? 'disabled' : ''}>${Array.from({ length: 12 }, (_, k) => k + 1).map((k) => `<option ${k === +p.count ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label class="row input-row"><span>How often</span><select id="bn-cadence">${CADENCES.map((c) => `<option value="${c.id}" ${c.id === p.cadence ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
          <label class="row input-row"><span>First due</span><input id="bn-first" type="date" value="${esc(p.first)}"></label>
          <label class="row input-row"><span>Paid from</span><select id="bn-account">${accOpts}</select></label>
          ${existing ? '' : '<label class="row input-row"><span>Already paid so far</span><select id="bn-already"><option value="0">0</option></select></label>'}
        </section>
        ${existing ? '' : '<p class="group-foot">Already paid so far: counted as paid, not added to spending.</p>'}
        ${lock ? '<p class="group-foot">Some payments are paid, so the total and the number of payments stay as they are.</p>' : ''}
        <p class="group-foot bn-preview"></p>
        ${existing ? `<div class="acct-danger"><button type="button" class="dup-btn danger-btn" data-act="delete">Delete plan</button>
          <div class="bn-del" hidden>
            <p class="remove-q">Delete this plan? Payments you already made stay in Activity: they were real spending.</p>
            <button type="button" class="dup-btn danger-btn solid" data-act="confirm-delete">${icon('trash', { size: 18 })}Delete plan</button>
          </div></div>` : ''}
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
          // the first payment is usually taken at the till: those count as paid now, with nothing logged
          const keep = Math.min(+already.value || 0, q.count - 1);
          already.innerHTML = Array.from({ length: q.count }, (_, k) => `<option value="${k}" ${k === keep ? 'selected' : ''}>${k}</option>`).join('');
        }
        const same = a.every((x) => x === a[0]);
        $('.bn-preview').textContent = !(q.total > 0) ? 'Type the total you’ll pay, fees included.'
          : `${same ? `${a.length} × ${aed(a[0])}` : `${a.length - 1} × ${aed(a[0])}, then ${aed(a[a.length - 1])}`}, ${q.cadence === '1m' ? 'monthly' : 'every 2 weeks'} · ${a.length > 1 ? `last on ${shortDay(d[d.length - 1])}` : `due ${shortDay(d[0])}`}. Your balances don’t change until you pay.`;
      };
      sheet.addEventListener('input', preview);
      sheet.addEventListener('change', preview);
      preview();
      sheet.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-act]'), a = btn?.dataset.act;
        if (a === 'cancel') close();
        if (a === 'delete') { haptic(); btn.hidden = true; $('.bn-del').hidden = false; $('.bn-del').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }
        if (a === 'confirm-delete') {
          haptic();
          const at = plans().findIndex((x) => x.id === p.id), gone = plans()[at];
          close();
          if (!gone) return;
          change(`Deleted ${title(gone)} plan`,
            (list) => list.filter((x) => x.id !== p.id),
            (list) => (list.some((x) => x.id === p.id) ? list : [...list.slice(0, at), gone, ...list.slice(at)]));
          toast(`Deleted ${esc(title(gone))} plan · payments stay in Activity`, { action: 'Undo', onAction: undoThis(topUndoId()), icon: icon('trash', { size: 18 }) });
        }
        if (a === 'save') {
          const q = read();
          if (!(q.total > 0)) { haptic(); $('#bn-total').focus(); $('.bn-preview').textContent = 'Type the total first.'; return; }
          haptic();
          if (!existing) {
            const already = +($('#bn-already')?.value || 0);
            for (let k = 0; k < already; k++) q.paid[k] = { entry: '', on: today() };
            change(`Added ${title(q)} plan`, (list) => [...list, q], (list) => list.filter((x) => x.id !== q.id));
            close();
            toast(`Added ${esc(title(q))} · ${aed(planState(q, state.entries).owed)} to pay`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: undoThis(topUndoId()) });
            return;
          }
          // merge with the plan as it is NOW: links found or undone while the editor was open are kept,
          // and if a payment got paid meanwhile the total and count stay put
          const cur = plans().find((x) => x.id === p.id);
          close();
          if (!cur) { toast('That plan was deleted in the meantime', { icon: icon('warn', { size: 18 }) }); return; }
          const fields = pick(q), keep = locked(cur);
          if (keep) { fields.total = cur.total; fields.count = cur.count; }
          const was = pick(cur);
          change(`Edited ${title(q)} plan`,
            (list) => patch(list, p.id, (x) => normalizePlan({ ...x, ...fields })),
            // Undo puts back only the fields; links made since stay
            (list) => patch(list, p.id, (x) => normalizePlan({ ...x, ...was })));
          const now = plans().find((x) => x.id === p.id);
          toast(`Saved ${esc(title(now))} · ${aed(planState(now, state.entries).owed)} to pay`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: undoThis(topUndoId()) });
        }
      });
    },
  });
}
