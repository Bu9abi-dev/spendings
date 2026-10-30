// Money owed, on screen: Settings → People, the Home line, the People sheet (balances, recent
// entries, Settle up), the split sheet and the "this is half of a split" question.
// The maths lives in people.js; this file talks to the store.
import { PEOPLE_ACCOUNTS, isPerson, accountMeta, categoryMeta, balances, fmt, money, dayKey, dayLabel, toAED } from './model.js';
import { state, getExtra, saveExtra, batch, addAccount, updateAccount, removeAccount, nameTaken, undo } from './store.js';
import {
  PEOPLE_KEY, SPLIT_PARTS, peopleBalances, withPerson, renamedPerson, splitShares, recentPeople, personEntries, settleUpPreset,
  owedText, balanceWords, personOf, splitPartner, lentFrom, settleUpTitle, rescaledPartner,
} from './people.js';
import { openEntry } from './entry.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

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
  if (!name) return { error: t('ppl.typeName') };
  if (name.toLowerCase() === 'all') return { error: t('su.allTaken') };
  const same = state.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (same) {
    if (isPerson(same.name) && same.archived) { batch(t('undoL.added', { what: same.name }), () => updateAccount(same.name, { archived: false })); return { name: same.name }; }
    return { error: isPerson(same.name) ? t('ppl.already', { name: same.name }) : t('ppl.isAccount', { name: same.name }) };
  }
  if (state.accounts.length >= MAX_ACCOUNTS) return { error: t('ppl.max', { n: MAX_ACCOUNTS }) };
  batch(t('undoL.added', { what: name }), () => {
    // flag first, so the new account never shows up as one of your own, even for a moment
    saveExtra(PEOPLE_KEY, withPerson(getExtra(PEOPLE_KEY, null), name));
    addAccount({ name, note: t('ppl.person'), color: 'graphite', wallet: '' });
  });
  return { name };
}

/** Rename someone: every entry follows (updateAccount), and so does the `people` list. One undo step. */
export function renamePerson(from, raw) {
  const to = cleanName(raw);
  if (!to) return { error: t('ppl.typeName') };
  if (to === from) return { name: to };
  if (to.toLowerCase() === 'all') return { error: t('su.allTaken') };
  if (nameTaken(to, from)) return { error: t('ppl.taken', { name: to }) };
  batch(t('undoL.renamed', { a: from, b: to }), () => {
    saveExtra(PEOPLE_KEY, renamedPerson(getExtra(PEOPLE_KEY, null), from, to));
    updateAccount(from, { name: to });
  });
  return { name: to };
}

/** Remove someone, only when nothing is owed either way: a person's balance isn't money you can move. */
export function removePerson(name) {
  const bal = balances(state.entries, state.settings).get(name)?.balance || 0;
  if (Math.abs(bal) >= 0.005) return { error: t('ppl.settleFirst', { name }) };
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
    <span class="row-main"><span class="row-title">${t('ppl.addPerson')}</span><span class="row-sub">${t('ppl.someone')}</span></span></button>`;
}

/** Clicks in the main view that belong to People. */
export function peopleClick(tg) {
  const ed = tg.closest('[data-person-edit]');
  if (ed) { haptic(); openPersonEdit(ed.dataset.personEdit); return true; }
  if (tg.closest('[data-person-new]')) { haptic(); openPersonEdit(null); return true; }
  if (tg.closest('[data-act="people"]')) { haptic(); openPeople(); return true; }
  return false;
}

/** Add, rename or remove one person. */
export function openPersonEdit(name, { onSaved } = {}) {
  const existing = name ? state.accounts.find((a) => a.name === name) : null;
  const bal = existing ? balances(state.entries, state.settings).get(name)?.balance || 0 : 0;
  const owed = Math.abs(bal) >= 0.005;
  const w = balanceWords(bal);
  openSheet({
    label: existing ? t('cat2.editName', { name }) : t('ppl.new'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${existing ? t('ppl.edit') : t('ppl.new')}</h2><button class="text-btn strong" data-act="save" type="button">${existing ? t('common.save') : t('common.add')}</button></header>
      <div class="sheet-scroll acct-form">
        <section class="group form">
          <label class="row input-row"><span>${t('home.name')}</span><input id="pf-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${esc(existing ? existing.name : '')}" placeholder="${t('ppl.egAhmed')}"></label>
        </section>
        <p class="group-foot">${existing ? t('ppl.editFoot', { name: esc(name), state: esc(w.text) }) : t('ppl.newFoot')}</p>
        ${existing ? `<div class="acct-danger">
          ${owed ? `<p class="remove-q">${t('ppl.settleThenRemove', { name: esc(name), state: esc(w.text) })}</p>`
            : `<button type="button" class="dup-btn danger-btn" data-act="remove">${t('su.removeAcc', { name: esc(name) })}</button>`}
        </div>` : ''}
      </div>`,
    onMount(sheet, close) {
      const input = sheet.querySelector('#pf-name');
      if (!existing) setTimeout(() => input.focus({ preventScroll: true }), 320);
      const save = () => {
        const r = existing ? renamePerson(name, input.value) : addPerson(input.value);
        if (r.error) { input.focus(); warn(esc(r.error)); return; }
        haptic(); close();
        toast(existing ? t('home.savedItem', { name: esc(r.name) }) : t('undoL.added', { what: esc(r.name) }), { icon: icon('check', { size: 18 }), tone: 'good', action: t('common.undo'), onAction: () => undo() });
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
          toast(t('undoL.removed', { what: esc(name) }), { icon: icon('check', { size: 18 }), tone: 'good', action: t('common.undo'), onAction: () => undo() });
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
  if (e.type === 'Spend') return t('ppl.paid', { name: esc(name), what: esc(e.merchant || categoryMeta(e.category)?.label || e.category || t('ppl.payment')) });
  if (e.note && e.note.startsWith('Split: ')) return t('ppl.splitNote', { what: esc(e.note.slice(7)) }); // the note is saved in English ("Split: …"); shown in the current language
  if (e.type === 'Transfer') return e.toAccount === name ? t('ppl.fromAcc', { what: esc(e.merchant || t('ppl.lent')), acc: esc(e.account) }) : t('ppl.intoAcc', { what: esc(e.merchant || t('ppl.paidBack')), acc: esc(e.toAccount) });
  return esc(e.merchant || t(`type.${e.type}`));
}

/** Everyone you split with or lend to: what each owes, their latest entries, and Settle up. */
export function openPeople() {
  const body = () => {
    const sum = peopleBalances(state.entries, state.settings);
    const order = recentPeople(state.entries, sum.people);
    if (!order.length) return `<div class="empty">${icon('people', { size: 28 })}<p>${t('ppl.noOne')}</p><p class="muted">${t('ppl.noOneSub')}</p></div>`;
    return order.map((p) => {
      const w = balanceWords(p.balance);
      const recent = personEntries(state.entries, p.id, 4);
      return `<section class="person-card" data-person="${esc(p.id)}">
        <div class="pc-head"><span class="person-avatar" aria-hidden="true">${initial(p.name)}</span>
          <span class="pc-name"><b>${esc(p.name)}</b><span class="owed-${w.tone || 'none'}">${esc(w.text)}</span></span>
          ${w.tone ? `<button type="button" class="pc-settle" data-settle="${esc(p.id)}">${t('ppl.settleUp')}</button>` : ''}</div>
        ${recent.length ? `<ul class="pc-list">${recent.map((e) => {
          const v = effectOn(e, p.id);
          return `<li><span class="pc-what">${entryWords(e, p.id)}<small>${dayLabel(dayKey(e.date))}</small></span><b class="num ${v > 0 ? 'owed-in' : v < 0 ? 'owed-out' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), { fixed: true })}</b></li>`;
        }).join('')}</ul>` : ''}
      </section>`;
    }).join('');
  };
  const lede = () => owedText(peopleBalances(state.entries, state.settings)) || t('ppl.nothingOwed');
  openSheet({
    label: t('set.people'),
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">${t('set.people')}</h2><button class="text-btn strong" data-act="done" type="button">${t('common.done')}</button></header>
      <p class="sheet-lede people-lede">${esc(lede())}</p>
      <div class="sheet-scroll people-list">${body()}
        <button type="button" class="dup-btn" data-act="add-person">${icon('plus', { size: 18 })}${t('ppl.addPerson')}</button>
        <p class="group-foot center">${t('ppl.plusMinus')}</p></div>`,
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
    <button type="button" class="chip person-chip new" data-act="new-person">${icon('plus', { size: 16 })}${t('ppl.newChip')}</button>`;

  openSheet({
    label: t('ppl.split'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('ppl.splitAmt', { amt: esc(money(amount, currency, { fixed: true })) })}</h2><button class="text-btn strong" data-act="done" type="button">${t('common.done')}</button></header>
      <div class="sheet-scroll split-form">
        ${label ? `<p class="sheet-lede">${esc(label)}</p>` : ''}
        <div class="block-label">${t('ppl.with')}</div>
        <div class="chips people-chips" role="group" aria-label="${t('ppl.person')}">${chips()}</div>
        <div class="np-row" hidden>
          <label class="field"><input id="np-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="${t('ppl.theirName')}"></label>
          <button type="button" class="np-add" data-act="add-new">${t('common.add')}</button>
        </div>
        <div class="block-label">${t('ppl.theirShare')}</div>
        <div class="chips part-chips" role="radiogroup" aria-label="${t('ppl.theirShare')}">
          ${SPLIT_PARTS.map((p) => `<button type="button" role="radio" class="chip part-chip${p.id === part ? ' on' : ''}" aria-checked="${p.id === part}" data-part="${p.id}">${t(`ppl.part.${p.id}`)}</button>`).join('')}
        </div>
        <div class="custom-row" hidden><label class="field"><span class="cur">${esc(currency === 'USD' ? t('cur.usd') : currency === 'AED' ? t('cur.aed') : currency)}</span><input id="sp-custom" class="num" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="${t('ppl.theirShare')}"></label></div>
        <p class="split-sum" aria-live="polite"></p>
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const show = () => {
        const s = shares();
        const who = person ? esc(accountMeta(person).name) : t('ppl.they');
        $('.split-sum').innerHTML = !person ? t('ppl.choose')
          : !s ? (part === 'custom' ? t('ppl.typeShare', { who, amt: esc(money(amount, currency, { fixed: true })) }) : t('ppl.tooSmall'))
          : t('ppl.youPayOwes', { mine: `<b class="num">${esc(money(s.mine, currency, { fixed: true }))}</b>`, who, theirs: `<b class="num">${esc(money(s.theirs, currency, { fixed: true }))}</b>` });
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
          if (!person) { warn(t('ppl.chooseShort')); return; }
          if (!s) { warn(part === 'custom' ? t('ppl.shareRange') : t('ppl.tooSmallShort')); return; }
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
  const otherName = partner.type === 'Transfer' ? t('ppl.theirShareOf', { who: esc(person0(entry, partner)) }) : t('ppl.yourShare');
  const bothFoot = r
    ? (r.keepsTotal
      ? t('ppl.bothBill', { total: esc(money(r.total, cur, { fixed: true })), other: otherName, amt: esc(money(r.amount, cur, { fixed: true })) })
      : t('ppl.bothSplit', { total: esc(money(r.total, cur, { fixed: true })), other: otherName, amt: esc(money(r.amount, cur, { fixed: true })) }))
    : t('ppl.bothSame');
  const person = personOf(entry) || personOf(partner);
  const other = partner.type === 'Transfer' ? t('ppl.theirShareAmt', { who: esc(person), amt: esc(money(partner.amount, partner.currency, { fixed: true })) }) : t(partner.merchant ? 'ppl.yourShareAt' : 'ppl.yourShareAmt', { amt: esc(money(partner.amount, partner.currency, { fixed: true })), shop: esc(partner.merchant || '') });
  const del = mode === 'delete';
  let chosen = false;
  openSheet({
    label: t('ppl.splitPay'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('ppl.splitPay')}</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <p class="reset-lede">${t('ppl.halfOf', { who: esc(person), other })}</p>
        <button type="button" class="dup-btn${del ? ' danger-btn solid' : ''} linked-btn" data-act="both">${del ? t('ppl.delBoth') : t('ppl.changeBoth')}</button>
        <button type="button" class="dup-btn linked-btn" data-act="one">${del ? t('ppl.delOne') : t('ppl.onlyOne')}</button>
        <p class="group-foot center">${del ? t('ppl.delOneFoot') : bothFoot}</p>
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
