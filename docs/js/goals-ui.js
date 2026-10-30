// Savings goals and net worth: the Insights cards, the Settings block and the add/edit sheets.
import { ACCOUNTS, balances, fmt, uid, isPerson, peopleBalances, amtAED } from './model.js';
import { state, getExtra, saveExtra, topUndoId } from './store.js';
import { bnplSummary, readBnpl } from './bnpl.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { doUndo } from './views.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import {
  readGoals, readInvestments, investmentsTotal, totalMoney, netWorth, allocateGoals, dateLabel,
} from './goals.js';

const goals = () => readGoals(getExtra('goals', null));
const holdings = () => readInvestments(getExtra('investments', null));
const aed = (n) => `${amtAED(fmt(n, { whole: true }))}`;
/** Toast Undo that only undoes the step it was made for. */
const undoThis = (tok) => () => { if (topUndoId() === tok) doUndo(); else toast(t('act.undoOff')); };
/** Accounts that still exist (archived ones too), for telling archived from missing. */
const knownAccounts = () => new Map(state.accounts.map((a) => [a.name, { archived: !!a.archived }]));
const allocation = () => allocateGoals(goals(), balances(state.entries, state.settings), knownAccounts(), new Date(), state.settings.cycleStart);
const manage = (anchor) => `<button type="button" class="text-btn gl-manage" data-go="settings" data-anchor="${anchor}">${t('gl.manage')}</button>`;
const warn = (msg) => toast(msg, { tone: 'warn', icon: icon('warn', { size: 18 }) });

function ring(pct, done) {
  const r = 22, c = 2 * Math.PI * r;
  return `<svg class="gl-ring" viewBox="0 0 56 56" width="56" height="56" role="img" aria-label="${done ? t('gl.reachedSaid') : t('gl.pctSaved', { pct: Math.round(pct * 100) })}"><circle cx="28" cy="28" r="${r}" class="gl-ring-bg"/>
    <circle cx="28" cy="28" r="${r}" class="gl-ring-fg${done ? ' done' : ''}" stroke-dasharray="${(c * pct).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 28 28)"/></svg>`;
}

/* ───── Insights cards ───── */

export function goalsCard() {
  const list = goals();
  const progress = allocation();
  const rows = list.map((g, i) => {
    const p = progress[i];
    const lines = [];
    lines.push(p.done ? `<b class="gl-done">${t('gl.reached')}</b>` : t('gl.toGo', { amt: aed(p.toGo) }));
    if (g.date && !p.done) {
      lines.push(p.pastDue ? `<span class="gl-late">${t('gl.passed', { date: esc(dateLabel(g.date)) })}</span>`
        : t('gl.perCycle', { amt: aed(p.perCycle), date: esc(dateLabel(g.date)) }));
    }
    for (const a of p.accounts) {
      if (a.missing) lines.push(`<span class="gl-late">${t('gl.missing', { name: esc(a.name) })}</span>`);
      else if (a.archived) lines.push(t('gl.archived', { name: esc(a.name) }));
    }
    if (p.sharedWith.length) lines.push(t('gl.shared', { names: p.sharedWith.map(esc).join(`${t('bn.comma')} `) }));
    return `<div class="gl-row" data-goal-row="${esc(g.id)}">${ring(p.pct, p.done)}
      <span class="gl-main"><b>${esc(g.name)}</b><small>${t('bud.of', { a: aed(p.saved), b: aed(g.target) })}${p.byAccounts ? '' : ` · ${t('gl.byHand')}`}</small>
        ${lines.map((l) => `<small>${l}</small>`).join('')}</span>
      <span class="gl-pct num">${Math.round(p.pct * 100)}%</span></div>`;
  }).join('');
  return `<section class="panel" id="goals-card">
    <div class="gl-head"><h3 class="panel-title">${t('gl.goals')}</h3>${manage('goals')}</div>
    ${list.length ? `<div class="gl-list">${rows}</div>`
      : `<p class="panel-sub">${t('gl.lede')}</p>`}
    <button type="button" class="dup-btn" data-goal-new="1">${icon('plus', { size: 16 })}${list.length ? t('gl.addGoal') : t('gl.setGoal')}</button>
  </section>`;
}

export function netWorthCard() {
  const bals = balances(state.entries, state.settings);
  const items = holdings();
  const money = totalMoney(bals, isPerson);
  const inv = investmentsTotal(items);
  const owed = bnplSummary(readBnpl(getExtra('bnpl', null)).plans, state.entries).owed;
  const pb = peopleBalances(state.entries, state.settings, bals);
  const people = Math.round((pb.owedToYou - pb.youOwe) * 100) / 100; // net: friends owe you minus you owe them
  const total = netWorth({ money, investments: inv, owed, people });
  const row = (label, v, sub = '', cls = '') => `<div class="nw-row"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b class="num ${cls}">${v < 0 ? '−' : ''}${fmt(Math.abs(v), { whole: true })}</b></div>`;
  return `<section class="panel" id="networth-card">
    <div class="gl-head"><h3 class="panel-title">${t('gl.netWorth')}</h3>${manage('investments')}</div>
    <p class="nw-total num" data-nw="${total}">${amtAED(`${total < 0 ? '−' : ''}${fmt(Math.abs(total), { whole: true })}`)}</p>
    <p class="panel-sub nw-sub">${t('gl.ownMinus')}</p>
    <p class="panel-sub nw-sub">${t('gl.goalsNot')}</p>
    <div class="nw-rows">
      ${row(t('gl.inAccounts'), money)}
      ${items.map((i) => row(esc(i.name), i.value, i.asOf ? t('gl.asOfL', { date: esc(dateLabel(i.asOf)) }) : '')).join('')}
      ${Math.abs(people) >= 0.5 ? row(people > 0 ? t('gl.friendsOwe') : t('gl.youOweFriends'), people, t('gl.net'), people < 0 ? 'nw-neg' : '') : ''}
      ${owed > 0 ? row(t('gl.instalments'), -owed, '', 'nw-neg') : ''}
    </div>
    ${items.length ? `<p class="panel-sub nw-foot">${t('gl.invFoot')}</p>`
    : `<button type="button" class="dup-btn" data-invest-new="1">${icon('plus', { size: 16 })}${t('gl.addInv')}</button>`}
  </section>`;
}

/* ───── Settings block ───── */

export function goalsSettingsBlock() {
  const list = goals();
  const items = holdings();
  const progress = allocation();
  const chev = icon('chevR', { size: 16, cls: 'chev' });
  const plus = (attr, title, sub) => `<button type="button" class="row link-row" ${attr}="1"><span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span></button>`;
  return `<h3 class="group-title" id="goals">${t('gl.goals')}</h3>
    <section class="group">
      ${list.map((g, i) => {
    const p = progress[i];
    return `<button type="button" class="row link-row" data-goal-edit="${esc(g.id)}"><span class="row-main"><span class="row-title">${esc(g.name)}</span>
        <span class="row-sub">${aed(g.target)}${g.date ? ` ${t('gl.by', { date: esc(dateLabel(g.date)) })}` : ''}</span></span><span class="num acct-bal">${Math.round(p.pct * 100)}%</span>${chev}</button>`;
  }).join('')}
      ${plus('data-goal-new', t('gl.addGoal'), t('gl.addGoalSub'))}
    </section>
    <h3 class="group-title" id="investments">${t('gl.investments')}</h3>
    <section class="group">
      ${items.map((i) => `<button type="button" class="row link-row" data-invest-edit="${esc(i.id)}"><span class="row-main"><span class="row-title">${esc(i.name)}</span>
        <span class="row-sub">${i.asOf ? t('gl.asOf', { date: esc(dateLabel(i.asOf)) }) : t('gl.noDate')}</span></span><span class="num acct-bal">${fmt(i.value, { whole: true })}</span>${chev}</button>`).join('')}
      ${plus('data-invest-new', t('gl.addInv'), t('gl.addInvSub'))}
    </section>
    <p class="group-foot">${t('gl.nwFoot')}</p>`;
}

export function goalsClick(tg) {
  const ge = tg.closest('[data-goal-edit]');
  if (ge) { openGoal(ge.dataset.goalEdit); return true; }
  if (tg.closest('[data-goal-new]')) { openGoal(null); return true; }
  const ie = tg.closest('[data-invest-edit]');
  if (ie) { openInvestment(ie.dataset.investEdit); return true; }
  if (tg.closest('[data-invest-new]')) { openInvestment(null); return true; }
  return false;
}

/* ───── Sheets ───── */

const head = (title, save) => `<header class="sheet-head"><button class="text-btn gl-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${title}</h2><button class="text-btn strong gl-btn" data-act="save" type="button">${save}</button></header>`;
const amountOf = (v) => (String(v).trim() === '' ? NaN : +String(v).replace(/,/g, ''));

const removeBlock = (existing, what) => (existing
  ? `<div class="acct-danger"><button type="button" class="dup-btn danger-btn" data-act="remove">${what}</button></div>` : '');

function openGoal(id) {
  const existing = id ? goals().find((g) => g.id === id) : null;
  const g = existing ? { ...existing, accounts: [...existing.accounts] } : { id: uid(), name: '', target: 0, date: '', accounts: [], manual: 0 };
  const picked = new Set(g.accounts);
  // every live account, plus any archived or missing one this goal already names (kept, not dropped on edit)
  const known = knownAccounts();
  const chips = [...ACCOUNTS.map((a) => ({ id: a.id, name: a.name, color: a.color, note: '' })),
    ...g.accounts.filter((n) => !ACCOUNTS.some((a) => a.id === n)).map((n) => ({ id: n, name: n, color: 'var(--series-other)', note: ` ${known.has(n) ? t('gl.archivedTag') : t('gl.missingTag')}` }))];
  const write = (next, label) => saveExtra('goals', { v: 1, goals: next }, label);

  openSheet({
    label: existing ? t('cat2.editName', { name: g.name }) : t('gl.newGoal'), tall: false,
    html: `${head(existing ? t('gl.editGoal') : t('gl.newGoal'), existing ? t('common.save') : t('common.add'))}
      <div class="sheet-scroll acct-form">
        <section class="group form">
          <label class="row input-row"><span>${t('home.name')}</span><input id="gf-name" type="text" maxlength="40" autocomplete="off" autocapitalize="sentences" value="${esc(g.name)}" placeholder="${t('gl.egFund')}"></label>
          <label class="row input-row"><span>${t('gl.targetAed')}</span><input id="gf-target" type="text" inputmode="decimal" autocomplete="off" value="${g.target ? esc(g.target) : ''}" placeholder="0"></label>
          <label class="row input-row"><span>${t('gl.targetDate')}</span><input id="gf-date" type="date" value="${esc(g.date)}"></label>
        </section>
        <p class="group-foot">${t('gl.dateOptional')}</p>
        <div class="ap-label acct-colour-label">${t('gl.heldIn')}</div>
        <div class="chips accounts" id="gf-accts">${chips.map((a) => `<button type="button" class="chip${picked.has(a.id) ? ' on' : ''}" data-pick="${esc(a.id)}" style="--chip:${a.color}"><i class="acc-dot"></i>${esc(a.name)}${a.note}</button>`).join('')}</div>
        <p class="group-foot">${t('gl.pickAccounts')}</p>
        <section class="group form" id="gf-manual-wrap">
          <label class="row input-row"><span>${t('gl.setAside')}</span><input id="gf-manual" type="text" inputmode="decimal" autocomplete="off" value="${g.manual ? esc(g.manual) : ''}" placeholder="0"></label>
        </section>
        ${removeBlock(existing, t('gl.delGoal'))}
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const sync = () => { $('#gf-manual-wrap').hidden = picked.size > 0; };
      sync();
      sheet.addEventListener('click', (ev) => {
        const pk = ev.target.closest('[data-pick]');
        if (pk) { const k = pk.dataset.pick; if (picked.has(k)) picked.delete(k); else picked.add(k); pk.classList.toggle('on', picked.has(k)); sync(); haptic(); return; }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'remove') {
          write(goals().filter((x) => x.id !== g.id), t('gl.delGoalUndo', { name: g.name }));
          const tok = topUndoId();
          haptic(); close();
          toast(t('undoL.deleted', { what: esc(g.name) }), { action: t('common.undo'), onAction: undoThis(tok) });
        }
        if (act === 'save') {
          const name = $('#gf-name').value.trim();
          const target = amountOf($('#gf-target').value);
          const manual = picked.size ? 0 : ($('#gf-manual').value.trim() === '' ? 0 : amountOf($('#gf-manual').value));
          if (!name) { $('#gf-name').focus(); return warn(t('gl.giveGoal')); }
          if (!Number.isFinite(target) || target <= 0) { $('#gf-target').focus(); return warn(t('gl.targetAbove')); }
          if (!Number.isFinite(manual) || manual < 0) { $('#gf-manual').focus(); return warn(t('gl.noNeg')); }
          const next = { ...g, name, target, date: $('#gf-date').value || '', accounts: chips.filter((a) => picked.has(a.id)).map((a) => a.id), manual };
          const all = goals(); // read fresh: a sync may have changed the list while this sheet was open
          write(existing && all.some((x) => x.id === g.id) ? all.map((x) => (x.id === g.id ? next : x)) : [...all, next], existing ? t('gl.changedGoal', { name }) : t('gl.addedGoal', { name }));
          haptic(); close();
          toast(existing ? t('home.savedItem', { name: esc(name) }) : t('undoL.added', { what: esc(name) }), { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}

function openInvestment(id) {
  const existing = id ? holdings().find((i) => i.id === id) : null;
  const h = existing ? { ...existing } : { id: uid(), name: '', value: 0, asOf: '' };
  const write = (next, label) => saveExtra('investments', { v: 1, items: next }, label);
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

  openSheet({
    label: existing ? t('cat2.editName', { name: h.name }) : t('gl.newInv'), tall: false,
    html: `${head(existing ? t('gl.editInv') : t('gl.newInv'), existing ? t('common.save') : t('common.add'))}
      <div class="sheet-scroll acct-form">
        <section class="group form">
          <label class="row input-row"><span>${t('home.name')}</span><input id="if-name" type="text" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(h.name)}" placeholder="${t('gl.egBroker')}"></label>
          <label class="row input-row"><span>${t('gl.valueAed')}</span><input id="if-value" type="text" inputmode="decimal" autocomplete="off" value="${existing ? esc(h.value) : ''}" placeholder="0"></label>
          <label class="row input-row"><span>${t('gl.asOfT')}</span><input id="if-date" type="date" value="${esc(h.asOf || (existing ? '' : today))}"></label>
        </section>
        <p class="group-foot">${t('gl.youType')}</p>
        ${removeBlock(existing, t('gl.delInv'))}
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      sheet.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'remove') {
          write(holdings().filter((x) => x.id !== h.id), t('gl.delInvUndo', { name: h.name }));
          const tok = topUndoId();
          haptic(); close();
          toast(t('undoL.deleted', { what: esc(h.name) }), { action: t('common.undo'), onAction: undoThis(tok) });
        }
        if (act === 'save') {
          const name = $('#if-name').value.trim();
          const value = amountOf($('#if-value').value);
          if (!name) { $('#if-name').focus(); return warn(t('gl.giveInv')); }
          if (!Number.isFinite(value)) { $('#if-value').focus(); return warn(t('gl.valueDh')); }
          const next = { ...h, name, value, asOf: $('#if-date').value || '' };
          const all = holdings(); // read fresh at Save
          write(existing && all.some((x) => x.id === h.id) ? all.map((x) => (x.id === h.id ? next : x)) : [...all, next], existing ? t('gl.changedInv', { name }) : t('gl.addedInv', { name }));
          haptic(); close();
          toast(existing ? t('home.savedItem', { name: esc(name) }) : t('undoL.added', { what: esc(name) }), { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}
