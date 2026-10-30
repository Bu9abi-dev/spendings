// Money owed, on screen: Settings → People, the Home line, the People sheet (balances, recent
// entries, Settle up), the split sheet and the "this is half of a split" question.
// The maths lives in people.js; this file talks to the store.
import { PEOPLE_ACCOUNTS, isPerson, accountMeta, balances, fmt, money, dayKey, dayLabel, toAED } from './model.js';
import { state, getExtra, saveExtra, batch, addAccount, updateAccount, removeAccount, nameTaken, undo } from './store.js';
import {
  PEOPLE_KEY, SPLIT_PARTS, peopleBalances, withPerson, renamedPerson, splitShares, recentPeople, personEntries, settleUpPreset,
  owedText, balanceWords, personOf, splitPartner, lentFrom, settleUpTitle, rescaledPartner,
} from './people.js';
import { openEntry } from './entry.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';

// the sheet's Accounts tab keeps at most 20 rows (accounts and people together)
const MAX_ACCOUNTS = 20;
const warn = (text) => toast(text, { tone: 'warn', icon: icon('warn', { size: 18 }) });
const initial = (name) => esc([...String(name).trim()][0]?.toUpperCase() || '?');
const cleanName = (raw) => String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 24);

/* ───────────────────────── Store wiring ───────────────────────── */

/** Add someone. One undo step: the account (so the sheet's Accounts tab has it) and the `people` flag.
    A person removed earlier comes back with their history. Returns { name } or { error }. */
export function addPerson(raw) {
  const name = cleanName(raw);
  if (!name) return { error: 'Type their name' };
  if (name.toLowerCase() === 'all') return { error: '“All” is taken by the total. Pick another name.' };
  const same = state.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (same) {
    if (isPerson(same.name) && same.archived) { batch(`Added ${same.name}`, () => updateAccount(same.name, { archived: false })); return { name: same.name }; }
    return { error: isPerson(same.name) ? `${same.name} is already in People` : `You have an account called ${same.name}. Pick another name.` };
  }
  if (state.accounts.length >= MAX_ACCOUNTS) return { error: `Your sheet keeps up to ${MAX_ACCOUNTS} accounts and people. Remove one first.` };
  batch(`Added ${name}`, () => {
    // flag first, so the new account never shows up as one of your own, even for a moment
    saveExtra(PEOPLE_KEY, withPerson(getExtra(PEOPLE_KEY, null), name));
    addAccount({ name, note: 'Person', color: 'graphite', wallet: '' });
  });
  return { name };
}

/** Rename someone: every entry follows (updateAccount), and so does the `people` list. One undo step. */
export function renamePerson(from, raw) {
  const to = cleanName(raw);
  if (!to) return { error: 'Type their name' };
  if (to === from) return { name: to };
  if (to.toLowerCase() === 'all') return { error: '“All” is taken by the total. Pick another name.' };
  if (nameTaken(to, from)) return { error: `${to} is already taken by an account or a person` };
  batch(`Renamed ${from} to ${to}`, () => {
    saveExtra(PEOPLE_KEY, renamedPerson(getExtra(PEOPLE_KEY, null), from, to));
    updateAccount(from, { name: to });
  });
  return { name: to };
}

/** Remove someone, only when nothing is owed either way: a person's balance isn't money you can move. */
export function removePerson(name) {
  const bal = balances(state.entries, state.settings).get(name)?.balance || 0;
  if (Math.abs(bal) >= 0.005) return { error: `Settle up with ${name} first` };
  removeAccount(name, '');
  return { name };
}

/* ───────────────────────── Settings → People ───────────────────────── */

export function peopleSettingsBlock() {
  const { people } = peopleBalances(state.entries, state.settings);
  const active = people.filter((p) => !p.archived);
  return `${active.map((p) => {
    const w = balanceWords(p.balance);
    return `<button type="button" class="row link-row person-row" data-person-edit="${esc(p.id)}">
      <span class="person-avatar" aria-hidden="true">${initial(p.name)}</span>
      <span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub owed-${w.tone || 'none'}">${esc(w.text)}</span></span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
  }).join('')}
  <button type="button" class="row link-row" data-person-new="1">
    <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">Add a person</span><span class="row-sub">Someone you split bills with or lend to</span></span></button>`;
}

/** Clicks in the main view that belong to People. */
export function peopleClick(t) {
  const ed = t.closest('[data-person-edit]');
  if (ed) { haptic(); openPersonEdit(ed.dataset.personEdit); return true; }
  if (t.closest('[data-person-new]')) { haptic(); openPersonEdit(null); return true; }
  if (t.closest('[data-act="people"]')) { haptic(); openPeople(); return true; }
  return false;
}

/** Add, rename or remove one person. */
export function openPersonEdit(name, { onSaved } = {}) {
  const existing = name ? state.accounts.find((a) => a.name === name) : null;
  const bal = existing ? balances(state.entries, state.settings).get(name)?.balance || 0 : 0;
  const owed = Math.abs(bal) >= 0.005;
  const w = balanceWords(bal);
  openSheet({
    label: existing ? `Edit ${name}` : 'New person', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? 'Edit person' : 'New person'}</h2><button class="text-btn strong" data-act="save" type="button">${existing ? 'Save' : 'Add'}</button></header>
      <div class="sheet-scroll acct-form">
        <section class="group form">
          <label class="row input-row"><span>Name</span><input id="pf-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${esc(existing ? existing.name : '')}" placeholder="e.g. Ahmed"></label>
        </section>
        <p class="group-foot">${existing ? `${esc(name)} ${esc(w.text)}. A new name follows through every past entry and your sheet.` : 'People aren’t part of your money. What they owe you, or you owe them, shows on Home.'}</p>
        ${existing ? `<div class="acct-danger">
          ${owed ? `<p class="remove-q">${esc(name)} ${esc(w.text)}. Settle up first, then you can remove them.</p>`
            : `<button type="button" class="dup-btn danger-btn" data-act="remove">Remove ${esc(name)}</button>`}
        </div>` : ''}
      </div>`,
    onMount(sheet, close) {
      const input = sheet.querySelector('#pf-name');
      if (!existing) setTimeout(() => input.focus({ preventScroll: true }), 320);
      const save = () => {
        const r = existing ? renamePerson(name, input.value) : addPerson(input.value);
        if (r.error) { input.focus(); warn(esc(r.error)); return; }
        haptic(); close();
        toast(existing ? `Saved ${esc(r.name)}` : `Added ${esc(r.name)}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
        onSaved?.(r.name);
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
      sheet.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'save') save();
        if (act === 'remove') {
          const r = removePerson(name);
          if (r.error) { warn(esc(r.error)); return; }
          haptic(); close();
          toast(`Removed ${esc(name)}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
        }
      });
    },
  });
}

/* ───────────────────────── Home ───────────────────────── */

/** "Owed to you AED X · You owe AED Y", opening the People sheet; '' when nothing is owed.
    Home shows it inside "Where your money is", under the total it isn't part of ({ inCard: true }).
    Without that card on screen it's Home's one notice line, at the lowest rank. */
export function owedLineHTML({ inCard = false } = {}) {
  const sum = peopleBalances(state.entries, state.settings);
  const text = owedText(sum);
  if (!text) return '';
  return `<button type="button" class="${inCard ? 'where-owed' : 'sub-line'} owed-line" data-act="people">${icon('people', { size: 16 })}<span>${esc(text)}</span>${icon('chevR', { size: 14, cls: 'chev' })}</button>`;
}

/** How an entry changed what a person owes: + they owe you more, − you owe them more. */
function effectOn(e, name) {
  const v = toAED(e, state.settings);
  if (e.type === 'Transfer') return e.toAccount === name ? v : e.account === name ? -v : 0;
  if (e.type === 'Spend' && e.account === name) return -v;
  if ((e.type === 'Income' || e.type === 'Adjustment') && e.account === name) return v;
  return 0;
}
function entryWords(e, name) {
  if (e.type === 'Spend') return `${esc(name)} paid · ${esc(e.merchant || e.category || 'payment')}`;
  if (e.note && e.note.startsWith('Split: ')) return esc(e.note);
  if (e.type === 'Transfer') return e.toAccount === name ? `${esc(e.merchant || 'Lent')} · from ${esc(e.account)}` : `${esc(e.merchant || 'Paid back')} · into ${esc(e.toAccount)}`;
  return esc(e.merchant || e.type);
}

/** Everyone you split with or lend to: what each owes, their latest entries, and Settle up. */
export function openPeople() {
  const body = () => {
    const sum = peopleBalances(state.entries, state.settings);
    const order = recentPeople(state.entries, sum.people);
    if (!order.length) return `<div class="empty">${icon('people', { size: 28 })}<p>No one yet.</p><p class="muted">Split a payment from its entry, or log a Transfer to someone you lend to.</p></div>`;
    return order.map((p) => {
      const w = balanceWords(p.balance);
      const recent = personEntries(state.entries, p.id, 4);
      return `<section class="person-card" data-person="${esc(p.id)}">
        <div class="pc-head"><span class="person-avatar" aria-hidden="true">${initial(p.name)}</span>
          <span class="pc-name"><b>${esc(p.name)}</b><span class="owed-${w.tone || 'none'}">${esc(w.text)}</span></span>
          ${w.tone ? `<button type="button" class="pc-settle" data-settle="${esc(p.id)}">Settle up</button>` : ''}</div>
        ${recent.length ? `<ul class="pc-list">${recent.map((e) => {
          const v = effectOn(e, p.id);
          return `<li><span class="pc-what">${entryWords(e, p.id)}<small>${dayLabel(dayKey(e.date))}</small></span><b class="num ${v > 0 ? 'owed-in' : v < 0 ? 'owed-out' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), { fixed: true })}</b></li>`;
        }).join('')}</ul>` : ''}
      </section>`;
    }).join('');
  };
  const lede = () => owedText(peopleBalances(state.entries, state.settings)) || 'Nothing owed either way.';
  openSheet({
    label: 'People',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">People</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <p class="sheet-lede people-lede">${esc(lede())}</p>
      <div class="sheet-scroll people-list">${body()}
        <button type="button" class="dup-btn" data-act="add-person">${icon('plus', { size: 18 })}Add a person</button>
        <p class="group-foot center">+ means they owe you more, − means you owe them more.</p></div>`,
    onMount(sheet, close) {
      const redraw = () => {
        sheet.querySelector('.people-lede').textContent = lede();
        const list = sheet.querySelector('.people-list');
        list.querySelectorAll('.person-card, .empty').forEach((n) => n.remove());
        list.insertAdjacentHTML('afterbegin', body());
      };
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        if (ev.target.closest('[data-act="add-person"]')) { haptic(); openPersonEdit(null, { onSaved: redraw }); return; }
        const st = ev.target.closest('[data-settle]');
        if (st) {
          const name = st.dataset.settle;
          const bal = balances(state.entries, state.settings).get(name)?.balance || 0;
          // paid back into the account the money was lent from (the allowance card: Safe to spend recovers)
          const into = bal > 0 ? lentFrom(state.entries, name, state.settings.emergencyAccount) : state.settings.emergencyAccount;
          const preset = settleUpPreset(name, bal, into);
          if (!preset) return redraw();
          haptic(); close();
          setTimeout(() => openEntry(null, preset, { title: settleUpTitle(name, bal) }), 280);
        }
      });
    },
  });
}

/* ───────────────────────── Split ───────────────────────── */

/** Pick a person and their share of `amount`. Calls onDone({ person, mine, theirs }) in the entry's currency. */
export function openSplit({ amount, currency = 'AED', label = '' }, onDone) {
  let person = recentPeople(state.entries)[0]?.id || '';
  let part = 'half', custom = '';
  const shares = () => splitShares(amount, part === 'custom' ? { theirs: +custom || 0 } : part);
  const chips = () => `${recentPeople(state.entries).map((p) => `<button type="button" class="chip person-chip${p.id === person ? ' on' : ''}" aria-pressed="${p.id === person}" data-split-person="${esc(p.id)}"><span class="person-avatar sm" aria-hidden="true">${initial(p.name)}</span>${esc(p.name)}</button>`).join('')}
    <button type="button" class="chip person-chip new" data-act="new-person">${icon('plus', { size: 16 })}New</button>`;

  openSheet({
    label: 'Split', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Split ${esc(money(amount, currency, { fixed: true }))}</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <div class="sheet-scroll split-form">
        ${label ? `<p class="sheet-lede">${esc(label)}</p>` : ''}
        <div class="block-label">With</div>
        <div class="chips people-chips" role="group" aria-label="Person">${chips()}</div>
        <div class="np-row" hidden>
          <label class="field"><input id="np-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Their name"></label>
          <button type="button" class="np-add" data-act="add-new">Add</button>
        </div>
        <div class="block-label">Their share</div>
        <div class="chips part-chips" role="radiogroup" aria-label="Their share">
          ${SPLIT_PARTS.map((p) => `<button type="button" role="radio" class="chip part-chip${p.id === part ? ' on' : ''}" aria-checked="${p.id === part}" data-part="${p.id}">${p.label}</button>`).join('')}
        </div>
        <div class="custom-row" hidden><label class="field"><span class="cur">${esc(currency)}</span><input id="sp-custom" class="num" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Their share"></label></div>
        <p class="split-sum" aria-live="polite"></p>
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const show = () => {
        const s = shares();
        const who = person ? esc(accountMeta(person).name) : 'They';
        $('.split-sum').innerHTML = !person ? 'Choose who you split it with.'
          : !s ? (part === 'custom' ? `Type ${who}’s share, less than ${esc(money(amount, currency, { fixed: true }))}.` : 'This amount is too small to split.')
          : `You pay <b class="num">${esc(money(s.mine, currency, { fixed: true }))}</b> · ${who} owes you <b class="num">${esc(money(s.theirs, currency, { fixed: true }))}</b>`;
        $('[data-act="done"]').classList.toggle('off', !(person && s));
      };
      const redrawChips = () => { $('.people-chips').innerHTML = chips(); };
      const addNew = () => {
        const r = addPerson($('#np-name').value);
        if (r.error) { warn(esc(r.error)); $('#np-name').focus(); return; }
        person = r.name;
        $('#np-name').value = '';
        $('.np-row').hidden = true;
        haptic(); redrawChips(); show();
      };
      $('#np-name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addNew(); } });
      $('#sp-custom').addEventListener('input', (ev) => {
        let v = ev.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        const [i, ...rest] = v.split('.');
        v = (i || '').slice(0, 7) + (rest.length ? '.' + rest.join('').slice(0, 2) : '');
        if (v !== ev.target.value) ev.target.value = v;
        custom = v; show();
      });
      sheet.addEventListener('click', (ev) => {
        const pc = ev.target.closest('[data-split-person]');
        if (pc) { person = pc.dataset.splitPerson; haptic(); redrawChips(); show(); return; }
        const pt = ev.target.closest('[data-part]');
        if (pt) {
          part = pt.dataset.part;
          sheet.querySelectorAll('[data-part]').forEach((b) => { b.classList.toggle('on', b === pt); b.setAttribute('aria-checked', String(b === pt)); });
          $('.custom-row').hidden = part !== 'custom';
          if (part === 'custom') setTimeout(() => $('#sp-custom').focus({ preventScroll: true }), 50);
          haptic(); show(); return;
        }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'new-person') { $('.np-row').hidden = false; $('#np-name').focus(); haptic(); }
        if (act === 'add-new') addNew();
        if (act === 'done') {
          const s = shares();
          if (!person) { warn('Choose who you split it with'); return; }
          if (!s) { warn(part === 'custom' ? 'Their share must be more than 0 and less than the whole amount' : 'This amount is too small to split'); return; }
          haptic(); close();
          onDone({ person, mine: s.mine, theirs: s.theirs });
        }
      });
      show();
    },
  });
}

/* ───────────────────────── Linked halves ───────────────────────── */

const person0 = (entry, partner) => personOf(entry) || personOf(partner);

/** One half of a split is being changed or deleted: ask whether the other half goes too.
    choose('both' | 'one') runs on a tap; Cancel does nothing. */
export function askLinked(entry, mode, choose, onCancel, edited = null) {
  const partner = splitPartner(entry, state.entries);
  // an amount change: say what "Change both" does to the other half's amount
  const r = edited ? rescaledPartner(entry, edited, partner) : null;
  const cur = (edited || entry).currency;
  const otherName = partner.type === 'Transfer' ? `${esc(person0(entry, partner))}’s share` : 'your share';
  const bothFoot = r
    ? (r.keepsTotal
      ? `Both keeps the bill at ${esc(money(r.total, cur, { fixed: true }))}: ${otherName} becomes ${esc(money(r.amount, cur, { fixed: true }))}. Date, currency and card match too.`
      : `Both keeps the same split: ${otherName} becomes ${esc(money(r.amount, cur, { fixed: true }))}, a bill of ${esc(money(r.total, cur, { fixed: true }))}. Date, currency and card match too.`)
    : 'Both keeps the date, currency and card the same on each half. Each keeps its own amount.';
  const person = personOf(entry) || personOf(partner);
  const other = partner.type === 'Transfer' ? `${esc(person)}’s share (${esc(money(partner.amount, partner.currency, { fixed: true }))})` : `your share (${esc(money(partner.amount, partner.currency, { fixed: true }))}${partner.merchant ? ` at ${esc(partner.merchant)}` : ''})`;
  const del = mode === 'delete';
  let chosen = false;
  openSheet({
    label: 'Split payment', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Split payment</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <p class="reset-lede">This is half of a payment split with <b>${esc(person)}</b>. The other half is ${other}.</p>
        <button type="button" class="dup-btn${del ? ' danger-btn solid' : ''} linked-btn" data-act="both">${del ? 'Delete both' : 'Change both'}</button>
        <button type="button" class="dup-btn linked-btn" data-act="one">${del ? 'Delete only this one' : 'Only this one'}</button>
        <p class="group-foot center">${del ? 'Deleting only this one leaves the other half as it is.' : bothFoot}</p>
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        haptic();
        if (act === 'cancel') { close(); return; }
        chosen = true;
        close();
        choose(act);
      });
    },
    onClose() { if (!chosen) onCancel?.(); },
  });
}
