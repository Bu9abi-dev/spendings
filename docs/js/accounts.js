// Your accounts: add, rename, recolour, map to an Apple Wallet card, or retire one.
import { ACCOUNTS, accountMeta, balances, fmt, colorHex } from './model.js';
import { state, addAccount, updateAccount, removeAccount, nameTaken } from './store.js';
import { CARD_COLORS } from './theme.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';

export function accountsSettingsBlock() {
  const bals = balances(state.entries, state.settings);
  const s = state.settings;
  return `${ACCOUNTS.map((a) => {
    const tag = a.id === s.emergencyAccount ? 'Main' : a.id === s.allowanceAccount ? 'Allowance' : '';
    return `<button type="button" class="row link-row acct-row" data-acct-edit="${esc(a.id)}">
      <span class="acct-chip" style="--c:${a.color}">${esc(a.name.slice(0, 2))}</span>
      <span class="row-main"><span class="row-title">${esc(a.name)}${tag ? ` <em class="acct-tag">${tag}</em>` : ''}</span><span class="row-sub">${esc(a.role || 'No note')}</span></span>
      <span class="num acct-bal">${fmt(bals.get(a.id)?.balance || 0, { whole: true })}</span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
  }).join('')}
  <button type="button" class="row link-row" data-acct-new="1">
    <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">Add an account</span><span class="row-sub">A card, a savings account, a wallet…</span></span></button>`;
}

export function accountsClick(t) {
  const ed = t.closest('[data-acct-edit]');
  if (ed) { openAccount(ed.dataset.acctEdit); return true; }
  if (t.closest('[data-acct-new]')) { openAccount(null); return true; }
  return false;
}

export function openAccount(name) {
  const existing = name ? state.accounts.find((a) => a.name === name) : null;
  const a = existing ? { ...existing } : { name: '', note: '', color: CARD_COLORS.find((c) => !state.accounts.some((x) => x.color === c.id))?.id || 'blue', wallet: '' };
  const s = state.settings;
  const role = existing ? (name === s.emergencyAccount ? 'main' : name === s.allowanceAccount ? 'allowance' : '') : '';
  const bal = existing ? balances(state.entries, s).get(name)?.balance || 0 : 0;
  const others = () => ACCOUNTS.filter((x) => x.id !== name);

  openSheet({
    label: existing ? `Edit ${name}` : 'New account', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? 'Edit account' : 'New account'}</h2><button class="text-btn strong" data-act="save" type="button">${existing ? 'Save' : 'Add'}</button></header>
      <div class="sheet-scroll acct-form">
        <div class="acct-card" style="--c:${colorHex(a.color)}">
          <span class="ac-name">${esc(a.name || 'Account name')}</span>
          <span class="ac-note">${esc(a.note || ' ')}</span>
          <span class="ac-bal num">${existing ? fmt(bal, { fixed: true }) : '0.00'}</span>
        </div>
        <section class="group form">
          <label class="row input-row"><span>Name</span><input id="af-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" value="${esc(a.name)}" placeholder="e.g. Wio"></label>
          <label class="row input-row"><span>Note</span><input id="af-note" type="text" maxlength="60" autocomplete="off" value="${esc(a.note)}" placeholder="e.g. Savings"></label>
          <label class="row input-row"><span>Wallet name</span><input id="af-wallet" type="text" maxlength="40" autocomplete="off" autocapitalize="off" value="${esc(a.wallet)}" placeholder="part of its Apple Wallet name"></label>
        </section>
        <p class="group-foot">Apple Pay payments from a Wallet card whose name contains this text are logged to this account.</p>
        <div class="ap-label acct-colour-label">Colour</div>
        <div class="swatches acct-swatches" role="radiogroup" aria-label="Colour">
          ${CARD_COLORS.map((c) => `<button type="button" role="radio" class="swatch" aria-checked="${c.id === a.color}" aria-label="${c.name}" data-colour="${c.id}" style="--sw:${c.hex}">${icon('check', { size: 14 })}</button>`).join('')}
        </div>
        ${existing ? `<div class="acct-danger">
          ${role ? `<p class="group-foot">This is your ${role === 'main' ? 'main account, where pay lands' : 'allowance account'}. Choose another one in Settings → Budget before removing it.</p>`
            : ACCOUNTS.length <= 1 ? '' : `<button type="button" class="dup-btn danger-btn" data-act="remove">Remove account</button>
          <div class="remove-panel" hidden>
            ${Math.abs(bal) >= 0.01 ? `<p class="remove-q">${esc(name)} still ${bal > 0 ? `holds <b class="num">${fmt(bal, { fixed: true })}</b>. Where should it go?` : `is <b class="num">${fmt(-bal, { fixed: true })}</b> short. Which account covers it?`}</p>
              <div class="chips accounts">${others().map((o, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-move="${esc(o.id)}" style="--chip:${o.color}"><i class="acc-dot"></i>${esc(o.name)}</button>`).join('')}</div>`
              : `<p class="remove-q">Past entries keep their history. ${esc(name)} just stops appearing in your accounts.</p>`}
            <button type="button" class="dup-btn danger-btn solid" data-act="confirm-remove">${Math.abs(bal) >= 0.01 ? 'Move money & remove' : `Remove ${esc(name)}`}</button>
          </div>`}
        </div>` : ''}
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const card = $('.acct-card');
      let moveTo = others()[0]?.id || '';
      const live = () => {
        card.querySelector('.ac-name').textContent = $('#af-name').value.trim() || 'Account name';
        card.querySelector('.ac-note').textContent = $('#af-note').value.trim() || ' ';
      };
      sheet.addEventListener('input', live);
      sheet.addEventListener('click', (ev) => {
        const sw = ev.target.closest('[data-colour]');
        if (sw) {
          a.color = sw.dataset.colour;
          sheet.querySelectorAll('[data-colour]').forEach((b) => b.setAttribute('aria-checked', String(b === sw)));
          card.style.setProperty('--c', colorHex(a.color));
          haptic();
          return;
        }
        const mv = ev.target.closest('[data-move]');
        if (mv) { moveTo = mv.dataset.move; sheet.querySelectorAll('[data-move]').forEach((b) => b.classList.toggle('on', b === mv)); haptic(); return; }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'remove') { const p = $('.remove-panel'); p.hidden = false; ev.target.closest('[data-act]').hidden = true; p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); haptic(); }
        if (act === 'confirm-remove') {
          removeAccount(name, moveTo);
          haptic(); close();
          toast(`Removed ${esc(name)}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
        if (act === 'save') {
          const nm = $('#af-name').value.trim();
          if (!nm) { $('#af-name').focus(); toast('Give the account a name', { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          if (nm.toLowerCase() === 'all') { toast('“All” is taken by the total. Pick another name.', { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          if (nameTaken(nm, existing ? name : '')) { toast(`You already have an account called ${esc(nm)}`, { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          const patch = { name: nm, note: $('#af-note').value.trim(), wallet: $('#af-wallet').value.trim(), color: a.color };
          if (existing) updateAccount(name, patch); else addAccount(patch);
          haptic(); close();
          toast(existing ? `Saved ${esc(nm)}` : `Added ${esc(nm)}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}

export { accountMeta };
