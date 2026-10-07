// The add / edit sheet: type, amount keypad, account, category, merchant, note, date.
import { ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, seriesColor, money, fmt, dubaiParts } from './model.js';
import { state, addEntry, updateEntry, deleteEntry, suggestCategory, setPrefs, undo } from './store.js';
import { openSheet, haptic, toast, esc, spring, reduceMotion } from './ui.js';
import { icon } from './icons.js';

const TYPE_LABEL = { Spend: 'Spend', Income: 'Income', Transfer: 'Transfer' };

function localInputValue(iso) {
  const p = dubaiParts(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}
const fromLocalInput = (v) => new Date(`${v}:00+04:00`).toISOString();

export function openEntry(existing = null, preset = {}) {
  const e = existing ? { ...existing } : {
    type: 'Spend', amount: 0, currency: 'AED', account: state.settings.allowanceAccount, toAccount: '',
    category: '', merchant: '', note: '', date: new Date().toISOString(), ...preset,
  };
  if (e.type === 'Transfer' && !e.toAccount) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account)?.id || 'Cash';
  let amountStr = e.amount ? String(+e.amount) : '';

  const html = `
    <header class="sheet-head">
      <button class="text-btn" data-act="cancel" type="button">Cancel</button>
      <h2 class="sheet-title">${existing ? 'Edit entry' : 'New entry'}</h2>
      ${existing ? `<button class="icon-btn danger" data-act="delete" type="button" aria-label="Delete entry">${icon('trash', { size: 20 })}</button>` : '<span class="icon-btn-spacer"></span>'}
    </header>
    <div class="segmented glass" role="radiogroup" aria-label="Type">
      <span class="seg-thumb" aria-hidden="true"></span>
      ${['Spend', 'Income', 'Transfer'].map((t) => `<button type="button" role="radio" data-type="${t}">${TYPE_LABEL[t]}</button>`).join('')}
    </div>
    <div class="amount-row">
      <button class="cur-pill" type="button" data-act="currency" aria-label="Currency"></button>
      <span class="amount-box">
        <output class="amount num" aria-live="polite"></output>
        <input class="amount-input num" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" aria-label="Amount" placeholder="0">
      </span>
      <button class="kb-toggle" type="button" data-act="keys" aria-label="Switch keyboard">${icon('keyboard', { size: 20 })}</button>
    </div>
    <p class="amount-sub"></p>
    <div class="sheet-scroll">
      <div class="field-group">
        <label class="field merchant-field">
          ${icon('store', { size: 20 })}
          <input type="text" name="merchant" autocomplete="off" autocapitalize="words" enterkeyhint="next" maxlength="80" value="${esc(e.merchant)}">
        </label>
      </div>
      <div class="block-label" data-label="account"></div>
      <div class="chips accounts" data-role="account"></div>
      <div class="transfer-to">
        <div class="block-label">To</div>
        <div class="chips accounts" data-role="toAccount"></div>
      </div>
      <div class="cat-wrap">
        <div class="block-label">Category <span class="suggest" hidden></span></div>
        <div class="cat-grid" role="radiogroup" aria-label="Category"></div>
      </div>
      <div class="field-group">
        <label class="field">
          ${icon('note', { size: 20 })}
          <input type="text" name="note" placeholder="Note" autocomplete="off" enterkeyhint="done" maxlength="200" value="${esc(e.note)}">
        </label>
        <label class="field date-field">
          ${icon('calendar', { size: 20 })}
          <input type="datetime-local" name="date" value="${localInputValue(e.date)}">
        </label>
      </div>
      ${existing ? `<button type="button" class="dup-btn" data-act="duplicate">${icon('copy', { size: 18 })}Log this again</button>` : ''}
    </div>
    <div class="keypad-wrap">
      <div class="keypad" role="group" aria-label="Amount keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => `<button type="button" class="key" data-key="${k}" aria-label="${k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}">${k === 'del' ? icon('backspace', { size: 24 }) : k}</button>`).join('')}
      </div>
      <button class="save-btn" type="button" data-act="save"></button>
    </div>`;

  return openSheet({
    html, label: existing ? 'Edit entry' : 'New entry',
    onMount(sheet, close) {
      const $ = (s) => sheet.querySelector(s);
      const amountEl = $('.amount'), sub = $('.amount-sub'), save = $('[data-act="save"]');
      const merchantInput = $('input[name="merchant"]'), noteInput = $('input[name="note"]'), dateInput = $('input[name="date"]');
      const thumb = $('.seg-thumb'), seg = $('.segmented');
      let thumbAnim = null;

      function moveThumb(animate) {
        const btn = seg.querySelector(`[data-type="${e.type}"]`);
        const x = btn.offsetLeft;
        const w = btn.offsetWidth;
        const from = thumb.style.transform;
        thumb.style.width = `${w}px`;
        thumb.style.transform = `translateX(${x}px)`;
        if (animate && from && !reduceMotion()) {
          thumbAnim?.cancel();
          const sp = spring(0.82, 0.34);
          thumbAnim = thumb.animate([{ transform: from }, { transform: `translateX(${x}px)` }], sp);
        }
        seg.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === e.type)));
      }

      const amountInput = $('.amount-input');
      const setNative = (on) => {
        sheet.classList.toggle('native', on);
        $('.kb-toggle').setAttribute('aria-label', on ? 'Use the app keypad' : 'Use the iPhone keyboard');
        $('.kb-toggle').classList.toggle('on', on);
        if (on) { amountInput.value = amountStr; setTimeout(() => amountInput.focus({ preventScroll: true }), 60); }
      };
      // the iPhone keyboard: keep only digits and one point, two decimals at most
      amountInput.addEventListener('input', () => {
        let v = amountInput.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        const [i, ...rest] = v.split('.');
        v = (i || '').slice(0, 7) + (rest.length ? '.' + rest.join('').slice(0, 2) : '');
        if (v !== amountInput.value) amountInput.value = v;
        amountStr = v;
        renderAmount();
      });
      amountInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); merchantInput.focus(); } });

      function renderAmount() {
        const shown = amountStr || '0';
        const [i, d] = shown.split('.');
        amountEl.innerHTML = `${fmt(+i || 0, { whole: true })}${d !== undefined ? `<span class="dec">.${d}</span>` : ''}`;
        amountEl.classList.toggle('zero', !amountStr || +amountStr === 0);
        amountEl.classList.toggle('long', shown.length > 7);
        $('.cur-pill').textContent = e.currency;
        e.amount = +amountStr || 0;
        sub.textContent = e.currency === 'USD' && e.amount ? `≈ ${money(e.amount * state.settings.usdRate, 'AED', { fixed: true })} at ${state.settings.usdRate}` : '';
        validate();
      }

      function renderType() {
        sheet.dataset.type = e.type;
        moveThumb(true);
        merchantInput.placeholder = e.type === 'Income' ? 'From (e.g. employer)' : e.type === 'Transfer' ? 'Reason (optional)' : 'Where? (e.g. Carrefour)';
        $('[data-label="account"]').textContent = e.type === 'Income' ? 'Into' : e.type === 'Transfer' ? 'From' : 'Paid with';
        renderAccounts();
        renderCategories();
        validate();
      }

      function renderAccounts() {
        for (const role of ['account', 'toAccount']) {
          const box = sheet.querySelector(`[data-role="${role}"]`);
          box.innerHTML = ACCOUNTS.map((a) => {
            const on = e[role] === a.id;
            const disabled = role === 'toAccount' && a.id === e.account;
            return `<button type="button" class="chip${on ? ' on' : ''}" data-acc="${a.id}" aria-pressed="${on}" ${disabled ? 'disabled' : ''} style="--chip:${a.color}">
              <i class="acc-dot"></i>${a.name}</button>`;
          }).join('');
        }
      }

      function renderCategories() {
        const list = e.type === 'Income' ? INCOME_CATEGORIES : SPEND_CATEGORIES;
        if (e.category && !list.some((c) => c.id === e.category)) e.category = '';
        $('.cat-grid').innerHTML = list.map((c) => {
          const on = e.category === c.id;
          const color = e.type === 'Income' ? 'var(--good)' : seriesColor(c.slot);
          return `<button type="button" class="cat${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-cat="${esc(c.id)}" style="--cat:${color}">
            <span class="cat-icon">${icon(c.icon, { size: 22 })}</span><span class="cat-name">${c.short}</span></button>`;
        }).join('');
      }

      function validate() {
        let label = 'Save', ok = true;
        if (!(e.amount > 0)) { label = 'Enter an amount'; ok = false; }
        else if (e.type === 'Transfer' && (!e.toAccount || e.toAccount === e.account)) { label = 'Choose where it went'; ok = false; }
        else if (e.type !== 'Transfer' && !e.category) { label = 'Choose a category'; ok = false; }
        save.disabled = !ok;
        save.textContent = ok ? (existing ? 'Save changes' : `Save ${money(e.amount, e.currency)}`) : label;
      }

      function suggest() {
        if (e.type !== 'Spend') return;
        const s = suggestCategory(merchantInput.value);
        const tag = $('.suggest');
        if (s && !e.category) {
          e.category = s; renderCategories(); validate();
          tag.hidden = false; tag.textContent = `· remembered for ${merchantInput.value.trim()}`;
        } else if (!s) tag.hidden = true;
      }

      // keypad
      $('.keypad').addEventListener('pointerdown', (ev) => {
        const k = ev.target.closest('.key')?.dataset.key;
        if (!k) return;
        ev.preventDefault();
        haptic();
        if (k === 'del') amountStr = amountStr.slice(0, -1);
        else if (k === '.') { if (!amountStr.includes('.')) amountStr = (amountStr || '0') + '.'; }
        else {
          const [i, d] = amountStr.split('.');
          if (d !== undefined && d.length >= 2) return;
          if (d === undefined && (i || '').length >= 7) return;
          amountStr = amountStr === '0' ? k : amountStr + k;
        }
        renderAmount();
      });
      let holdTimer;
      const del = $('[data-key="del"]');
      del.addEventListener('pointerdown', () => { holdTimer = setTimeout(() => { amountStr = ''; renderAmount(); haptic(); }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => del.addEventListener(t, () => clearTimeout(holdTimer)));

      sheet.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && !save.disabled) { ev.preventDefault(); save.click(); return; }
        if (ev.target.matches('input')) return;
        if (/^[0-9.]$/.test(ev.key)) sheet.querySelector(`[data-key="${ev.key}"]`)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        if (ev.key === 'Backspace') del.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), clearTimeout(holdTimer);
        if (ev.key === 'Enter' && !save.disabled) save.click();
      });

      seg.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-type]')?.dataset.type;
        if (!t || t === e.type) return;
        haptic();
        e.type = t;
        if (t === 'Transfer' && (!e.toAccount || e.toAccount === e.account)) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account).id;
        renderType();
      });

      sheet.addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-acc]');
        if (chip) {
          const role = chip.parentElement.dataset.role;
          e[role] = chip.dataset.acc;
          if (role === 'account' && e.toAccount === e.account) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account).id;
          haptic(); renderAccounts(); validate();
          return;
        }
        const cat = ev.target.closest('[data-cat]');
        if (cat) {
          e.category = e.category === cat.dataset.cat ? '' : cat.dataset.cat;
          $('.suggest').hidden = true;
          haptic(); renderCategories(); validate();
          return;
        }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'duplicate') {
          close();
          setTimeout(() => openEntry(null, { type: e.type, amount: e.amount, currency: e.currency, account: e.account, toAccount: e.toAccount, category: e.category, merchant: merchantInput.value.trim(), note: noteInput.value.trim() }), 280);
          return;
        }
        if (act === 'keys') { const on = !sheet.classList.contains('native'); setPrefs({ nativeKeys: on }); setNative(on); haptic(); return; }
        if (act === 'currency') { e.currency = e.currency === 'AED' ? 'USD' : 'AED'; haptic(); renderAmount(); }
        if (act === 'delete') {
          const removed = deleteEntry(existing.id);
          close();
          toast(`Deleted ${money(removed.amount, removed.currency)}`, { action: 'Undo', onAction: () => undo(), icon: icon('trash', { size: 18 }) });
        }
        if (act === 'save' && !save.disabled) {
          const fields = {
            type: e.type, amount: e.amount, currency: e.currency, account: e.account,
            toAccount: e.type === 'Transfer' ? e.toAccount : '', category: e.type === 'Transfer' ? '' : e.category,
            merchant: merchantInput.value.trim(), note: noteInput.value.trim(),
            date: dateInput.value ? fromLocalInput(dateInput.value) : new Date().toISOString(),
          };
          haptic();
          if (existing) updateEntry(existing.id, fields);
          else addEntry(fields);
          close();
          toast(`${existing ? 'Updated' : 'Saved'} · ${money(fields.amount, fields.currency)}${fields.category ? ' · ' + fields.category : ''}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
        }
      });

      merchantInput.addEventListener('change', suggest);
      merchantInput.addEventListener('blur', suggest);
      // text fields bring up the keyboard — tuck the keypad away meanwhile
      sheet.addEventListener('focusin', (ev) => { if (ev.target.matches('input[type="text"]')) sheet.classList.add('typing'); });
      sheet.addEventListener('focusout', (ev) => { if (ev.target.matches('input[type="text"]')) setTimeout(() => { if (!sheet.contains(document.activeElement) || !document.activeElement.matches('input[type="text"]')) sheet.classList.remove('typing'); }, 50); });
      // Return moves on: amount → where → note → save
      merchantInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); noteInput.focus(); } });
      noteInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (!save.disabled) save.click(); else noteInput.blur(); } });

      renderType();
      renderAmount();
      setNative(!!state.prefs.nativeKeys);
      requestAnimationFrame(() => moveThumb(false));
    },
  });
}
