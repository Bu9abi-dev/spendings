// Your accounts: add, rename, recolour, map to an Apple Wallet card, or retire one.
import { ACCOUNTS, accountMeta, balances, fmt, colorHex } from './model.js';
import { state, addAccount, updateAccount, removeAccount, nameTaken } from './store.js';
import { CARD_COLORS } from './theme.js';
import { openSheet, haptic, toast, esc, reduceMotion } from './ui.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

export function accountsSettingsBlock() {
  const bals = balances(state.entries, state.settings);
  const s = state.settings;
  return `${ACCOUNTS.map((a) => {
    const tag = a.id === s.emergencyAccount ? t('acc2.main') : a.id === s.allowanceAccount ? t('acc2.allowance') : '';
    return `<button type="button" class="row link-row acct-row" data-acct-edit="${esc(a.id)}">
      <span class="acct-chip${a.name.length > 3 ? ' long' : ''}" style="--c:${a.color}">${esc(a.name.length <= 5 ? a.name : a.name.slice(0, 4))}</span>
      <span class="row-main"><span class="row-title">${esc(a.name)}${tag ? ` <em class="acct-tag">${tag}</em>` : ''}</span><span class="row-sub">${esc(a.role || t('acc2.noNote'))}</span></span>
      <span class="num acct-bal">${fmt(bals.get(a.id)?.balance || 0, { whole: true })}</span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
  }).join('')}
  <button type="button" class="row link-row" data-acct-new="1">
    <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${t('home.addAcc')}</span><span class="row-sub">${t('acc2.cardSavings')}</span></span></button>`;
}

export function accountsClick(tg) {
  const ed = tg.closest('[data-acct-edit]');
  if (ed) { openAccount(ed.dataset.acctEdit); return true; }
  if (tg.closest('[data-acct-new]')) { openAccount(null); return true; }
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
    label: existing ? t('cat2.editName', { name }) : t('acc2.new'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${existing ? t('acc2.edit') : t('acc2.new')}</h2><button class="text-btn strong" data-act="save" type="button">${existing ? t('common.save') : t('common.add')}</button></header>
      <div class="sheet-scroll acct-form">
        <div class="acct-card" style="--c:${colorHex(a.color)}">
          <span class="ac-name">${esc(a.name || t('su.accName'))}</span>
          <span class="ac-note">${esc(a.note || ' ')}</span>
          <span class="ac-bal num">${existing ? fmt(bal, { fixed: true }) : '0.00'}</span>
        </div>
        <section class="group form">
          <label class="row input-row"><span>${t('home.name')}</span><input id="af-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" value="${esc(a.name)}" placeholder="${t('acc2.egWio')}"></label>
          <label class="row input-row"><span>${t('acc2.note')}</span><input id="af-note" type="text" maxlength="60" autocomplete="off" value="${esc(a.note)}" placeholder="${t('acc2.egSavings')}"></label>
          <label class="row input-row"><span>${t('acc2.walletName')}</span><input id="af-wallet" type="text" maxlength="40" autocomplete="off" autocapitalize="off" value="${esc(a.wallet)}" placeholder="${t('acc2.walletPh')}"></label>
        </section>
        <p class="group-foot">${t('acc2.walletNote')}</p>
        <div class="ap-label acct-colour-label">${t('acc2.colour')}</div>
        <div class="swatches acct-swatches" role="radiogroup" aria-label="${t('acc2.colour')}">
          ${CARD_COLORS.map((c) => `<button type="button" role="radio" class="swatch" aria-checked="${c.id === a.color}" aria-label="${c.name}" data-colour="${c.id}" style="--sw:${c.hex}">${icon('check', { size: 14 })}</button>`).join('')}
        </div>
        ${existing ? `<div class="acct-danger">
          ${role ? `<p class="group-foot">${t(role === 'main' ? 'acc2.isMain' : 'acc2.isAllowance')}</p>`
            : ACCOUNTS.length <= 1 ? '' : `<button type="button" class="dup-btn danger-btn" data-act="remove">${t('acc2.remove')}</button>
          <div class="remove-panel" hidden>
            ${Math.abs(bal) >= 0.01 ? `<p class="remove-q">${t(bal > 0 ? 'acc2.holds' : 'acc2.short', { name: esc(name), amt: `<b class="num">${fmt(Math.abs(bal), { fixed: true })}</b>` })}</p>
              <div class="chips accounts">${others().map((o, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-move="${esc(o.id)}" style="--chip:${o.color}"><i class="acc-dot"></i>${esc(o.name)}</button>`).join('')}</div>`
              : `<p class="remove-q">${t('acc2.stops', { name: esc(name) })}</p>`}
            <button type="button" class="dup-btn danger-btn solid" data-act="confirm-remove">${Math.abs(bal) >= 0.01 ? t('acc2.moveRemove') : t('su.removeAcc', { name: esc(name) })}</button>
          </div>`}
        </div>` : ''}
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const card = $('.acct-card');
      let moveTo = others()[0]?.id || '';
      const live = () => {
        card.querySelector('.ac-name').textContent = $('#af-name').value.trim() || t('su.accName');
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
        if (act === 'remove') { const p = $('.remove-panel'); p.hidden = false; ev.target.closest('[data-act]').hidden = true; p.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' }); haptic(); }
        if (act === 'confirm-remove') {
          removeAccount(name, moveTo);
          haptic(); close();
          toast(t('undoL.removed', { what: esc(name) }), { icon: icon('check', { size: 18 }), tone: 'good' });
        }
        if (act === 'save') {
          const nm = $('#af-name').value.trim();
          if (!nm) { $('#af-name').focus(); toast(t('acc2.giveName'), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          if (nm.toLowerCase() === 'all') { toast(t('su.allTaken'), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          if (nameTaken(nm, existing ? name : '')) { toast(t('acc2.taken', { name: esc(nm) }), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
          const patch = { name: nm, note: $('#af-note').value.trim(), wallet: $('#af-wallet').value.trim(), color: a.color };
          if (existing) updateAccount(name, patch); else addAccount(patch);
          haptic(); close();
          toast(existing ? t('home.savedItem', { name: esc(nm) }) : t('undoL.added', { what: esc(nm) }), { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}

export { accountMeta };
