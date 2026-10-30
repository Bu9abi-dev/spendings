// The add / edit sheet: type, amount keypad, account, category, merchant, note, date.
import { ACCOUNTS, PEOPLE_ACCOUNTS, isPerson, categoryMeta, pickerCategories, seriesColor, money, fmt, dubaiParts, balances, toAED } from './model.js';
import { state, addEntry, updateEntry, deleteEntry, setPrefs, undo, batch } from './store.js';
import { splitPartner, splitTransfer, partnerPatch, personOf, splitPrices, rescaledPartner } from './people.js';
import { openSplit, askLinked } from './people-ui.js';
import { learn, suggestFor, sameMerchant } from './categorize.js';
import { openSheet, haptic, toast, esc, spring, reduceMotion } from './ui.js';
import { icon } from './icons.js';

const TYPE_LABEL = { Spend: 'Spend', Income: 'Income', Transfer: 'Transfer' };

function localInputValue(iso) {
  const p = dubaiParts(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}
const fromLocalInput = (v) => new Date(`${v}:00+04:00`).toISOString();

export function openEntry(existing = null, preset = {}, { title = '' } = {}) {
  const e = existing ? { ...existing } : {
    type: 'Spend', amount: 0, currency: 'AED', account: state.settings.allowanceAccount, toAccount: '',
    category: '', merchant: '', note: '', date: new Date().toISOString(), ...preset,
  };
  if (e.type === 'Transfer' && !e.toAccount) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account)?.id || 'Cash';
  let amountStr = e.amount ? String(+e.amount) : '';

  const html = `
    <header class="sheet-head">
      <button class="text-btn" data-act="cancel" type="button">Cancel</button>
      <h2 class="sheet-title">${existing ? 'Edit entry' : esc(title || 'New entry')}</h2>
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
      <p class="split-note" hidden></p>
      ${existing ? `<button type="button" class="dup-btn" data-act="duplicate">${icon('copy', { size: 18 })}Log this again</button>` : ''}
    </div>
    <div class="keypad-wrap">
      <button type="button" class="dup-btn split-btn" data-act="split" hidden>${icon('split', { size: 18 })}Split with someone</button>
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
      // category guessed from the merchant: autoPicked = we chose it (you didn't), hinted = a weak guess only ringed
      let autoPicked = false, hinted = '';

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
        if (on) { amountInput.value = amountStr; setTimeout(() => { const f = document.activeElement; if (!f || f === document.body || f === sheet || f.closest('.kb-toggle')) amountInput.focus({ preventScroll: true }); }, 60); }
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
      amountInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); merchantInput.focus({ preventScroll: true }); } });

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
        if (e.type !== 'Spend') hinted = '';
        moveThumb(true);
        merchantInput.placeholder = e.type === 'Income' ? 'From (e.g. employer)' : e.type === 'Transfer' ? 'Reason (optional)' : 'Where? (e.g. Carrefour)';
        $('[data-label="account"]').textContent = e.type === 'Income' ? 'Into' : e.type === 'Transfer' ? 'From' : 'Paid with';
        renderAccounts();
        renderCategories();
        validate();
      }

      // people (money owed) only where it makes sense: either side of a Transfer, and who paid a Spend
      const peopleFor = (role) => (role === 'toAccount' || e.type === 'Spend' || e.type === 'Transfer' ? PEOPLE_ACCOUNTS : []);
      function renderAccounts() {
        for (const role of ['account', 'toAccount']) {
          const box = sheet.querySelector(`[data-role="${role}"]`);
          const chip = (a, person) => {
            const on = e[role] === a.id;
            const disabled = role === 'toAccount' && a.id === e.account;
            return `<button type="button" class="chip${person ? ' person-chip' : ''}${on ? ' on' : ''}" data-acc="${esc(a.id)}" aria-pressed="${on}" ${disabled ? 'disabled' : ''} style="--chip:${a.color}">
              ${person ? `<span class="person-avatar sm" aria-hidden="true">${esc([...a.name][0]?.toUpperCase() || '?')}</span>` : '<i class="acc-dot"></i>'}${esc(a.name)}</button>`;
          };
          const people = peopleFor(role);
          box.innerHTML = ACCOUNTS.map((a) => chip(a, false)).join('')
            + (people.length ? `<span class="chip-group-label">${role === 'account' && e.type === 'Spend' ? 'People · a friend paid' : 'People'}</span>${people.map((a) => chip(a, true)).join('')}` : '');
        }
        renderSplit();
      }

      // Split: a Spend paid from one of your accounts can be shared with someone. A split half says so.
      const partner = existing ? splitPartner(existing, state.entries) : null;
      function renderSplit() {
        const note = $('.split-note'), btn = $('[data-act="split"]');
        if (!note || !btn) return;
        if (partner) {
          const who = personOf(existing) || personOf(partner);
          note.hidden = false;
          note.innerHTML = partner.type === 'Transfer'
            ? `${icon('split', { size: 16 })}<span>Split with <b>${esc(who)}</b> · their share ${esc(money(partner.amount, partner.currency, { fixed: true }))}</span>`
            : `${icon('split', { size: 16 })}<span>${esc(who)}’s share of a split · you paid ${esc(money(partner.amount, partner.currency, { fixed: true }))}${partner.merchant ? ` at ${esc(partner.merchant)}` : ''}</span>`;
        }
        btn.hidden = !!partner || e.type !== 'Spend' || isPerson(e.account);
      }

      function renderCategories() {
        const list = pickerCategories(e.type, e.category);
        if (e.category && !list.some((c) => c.id === e.category)) e.category = '';
        const grid = $('.cat-grid');
        // build the buttons once per type; after that only flip classes, so a tap in progress isn't lost
        const key = `${e.type}|${list.map((c) => c.id).join('|')}`;
        if (grid.dataset.key !== key) {
          grid.dataset.key = key;
          grid.innerHTML = list.map((c) => {
            const color = e.type === 'Income' ? 'var(--good)' : seriesColor(c.slot);
            return `<button type="button" class="cat" role="radio" aria-checked="false" data-cat="${esc(c.id)}" style="--cat:${color}">
            <span class="cat-icon">${icon(c.icon, { size: 22 })}</span><span class="cat-name">${esc(c.short)}</span></button>`;
          }).join('');
        }
        for (const b of grid.children) {
          const on = e.category === b.dataset.cat;
          b.classList.toggle('on', on);
          b.classList.toggle('sug', !on && hinted === b.dataset.cat);
          b.setAttribute('aria-checked', String(on));
        }
      }

      let saveOk = false, bigOk = false, touchedAccount = !!existing;
      const BIG = 20000;
      function validate() {
        let label = 'Save', ok = true;
        if (!(e.amount > 0)) { label = 'Enter an amount'; ok = false; }
        else if (e.type === 'Transfer' && (!e.toAccount || e.toAccount === e.account)) { label = 'Choose where it went'; ok = false; }
        else if (e.type !== 'Transfer' && !e.category) { label = 'Choose a category'; ok = false; }
        saveOk = ok;
        // not `disabled`: a tap on it should point at what's missing
        save.classList.toggle('off', !ok);
        save.setAttribute('aria-disabled', String(!ok));
        if (e.amount < BIG) bigOk = false;
        save.textContent = ok ? (existing ? 'Save changes' : `Save ${money(e.amount, e.currency)}`) : label;
      }
      function nudge() {
        haptic();
        const target = !(e.amount > 0) ? $('.amount-box') : e.type === 'Transfer' ? sheet.querySelector('[data-role="toAccount"]') : $('.cat-grid');
        target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        target?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
        if (sheet.classList.contains('native') && !(e.amount > 0)) amountInput.focus();
      }

      function suggest() {
        if (e.type !== 'Spend') return;
        const name = merchantInput.value.trim();
        // a merchant you've used before also brings back the card you paid with
        if (name && !touchedAccount) {
          const last = state.entries.find((x) => x.type === 'Spend' && x.merchant && sameMerchant(x.merchant, name) && ACCOUNTS.some((a) => a.id === x.account));
          if (last && last.account !== e.account) { e.account = last.account; renderAccounts(); }
        }
        // smarter categories (categorize.js): learns from past entries, copes with bank-style names
        const g = name ? suggestFor(name, learn(state.entries, state.merchants)) : null;
        const tag = $('.suggest');
        const was = e.category + '|' + hinted;
        hinted = '';
        if (g && g.confidence === 'high' && (!e.category || autoPicked)) {
          e.category = g.category; autoPicked = true;
          tag.hidden = false;
          tag.textContent = g.like && g.like.toLowerCase() !== name.toLowerCase() ? `· like ${g.like}` : `· remembered for ${name}`;
        } else if (g && (!e.category || autoPicked)) {
          // medium or low: only a guess, so ring it and let you pick
          if (autoPicked) { e.category = ''; autoPicked = false; }
          hinted = g.category;
          tag.hidden = false; tag.textContent = `· maybe ${categoryMeta(g.category)?.short || g.category}?`;
        } else if (!g) {
          if (autoPicked) { e.category = ''; autoPicked = false; }
          tag.hidden = true;
        }
        if (e.category + '|' + hinted !== was) { renderCategories(); validate(); }
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
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && saveOk) { ev.preventDefault(); save.click(); return; }
        if (ev.target.matches('input')) return;
        if (/^[0-9.]$/.test(ev.key)) sheet.querySelector(`[data-key="${ev.key}"]`)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        if (ev.key === 'Backspace') del.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), clearTimeout(holdTimer);
        if (ev.key === 'Enter' && saveOk) save.click();
      });

      seg.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-type]')?.dataset.type;
        if (!t || t === e.type) return;
        haptic();
        e.type = t;
        // sensible defaults for this owner: pay lands in the main account, transfers go main → allowance
        const hub = state.settings.emergencyAccount, allow = state.settings.allowanceAccount;
        if (!touchedAccount && t === 'Income' && ACCOUNTS.some((a) => a.id === hub)) e.account = hub;
        if (!touchedAccount && t === 'Transfer' && hub !== allow && ACCOUNTS.some((a) => a.id === hub) && ACCOUNTS.some((a) => a.id === allow)) { e.account = hub; e.toAccount = allow; }
        if (!touchedAccount && t === 'Spend') e.account = allow;
        if (t === 'Income' && isPerson(e.account)) e.account = ACCOUNTS.some((a) => a.id === hub) ? hub : ACCOUNTS[0].id;
        if (t === 'Transfer' && (!e.toAccount || e.toAccount === e.account)) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account).id;
        renderType();
      });

      sheet.addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-acc]');
        if (chip) {
          const role = chip.parentElement.dataset.role;
          e[role] = chip.dataset.acc;
          touchedAccount = true;
          if (role === 'account' && e.toAccount === e.account) e.toAccount = ACCOUNTS.find((a) => a.id !== e.account).id;
          haptic(); renderAccounts(); validate();
          return;
        }
        const cat = ev.target.closest('[data-cat]');
        if (cat) {
          e.category = e.category === cat.dataset.cat ? '' : cat.dataset.cat;
          autoPicked = false; hinted = '';
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
          const done = (removed, both) => toast(`Deleted ${money(removed.amount, removed.currency)}${both ? ' and its other half' : ''}`, { action: 'Undo', onAction: () => undo(), icon: icon('trash', { size: 18 }) });
          const other = splitPartner(existing, state.entries);
          if (!other) { const removed = deleteEntry(existing.id); close(); done(removed); return; }
          // half of a split: the other half can go too, as one undo step
          askLinked(existing, 'delete', (how) => {
            let removed;
            batch(`Deleted ${money(existing.amount, existing.currency)}${how === 'both' ? ' and its other half' : ''}`, () => {
              removed = deleteEntry(existing.id);
              if (how === 'both') deleteEntry(other.id);
            });
            close();
            done(removed, how === 'both');
          });
          return;
        }
        if (act === 'split') {
          if (!(e.amount > 0)) { nudge(); return; }
          haptic();
          openSplit({ amount: e.amount, currency: e.currency, label: merchantInput.value.trim() }, ({ person, mine, theirs }) => {
            const fields = collect();
            const total = e.amount;
            // a USD bill: their share priced at the rate, yours the rest of the bill's AED price (kept when unchanged)
            const same = existing && +existing.amount === +fields.amount && existing.currency === fields.currency;
            const prices = splitPrices(same ? toAED(existing, state.settings) : toAED({ amount: fields.amount, currency: fields.currency }, state.settings), theirs, fields.currency, state.settings);
            batch(`Split ${money(total, fields.currency)} with ${person}`, () => {
              const mineFields = { ...fields, amount: mine, ...(prices ? { amountAED: prices.mineAED } : {}) };
              const spend = existing ? updateEntry(existing.id, mineFields) : addEntry(mineFields);
              addEntry({ ...splitTransfer(spend, person, theirs), ...(prices ? { amountAED: prices.theirsAED } : {}) });
            });
            close();
            toast(`Split · your share ${money(mine, fields.currency, { fixed: true })}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
          });
          return;
        }
        if (act === 'save' && !saveOk) { nudge(); return; }
        if (act === 'save' && e.amount >= BIG && !bigOk && !existing) {
          bigOk = true; haptic();
          save.textContent = `Tap again to save ${money(e.amount, e.currency)}`;
          save.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260 });
          return;
        }
        if (act === 'save' && saveOk) {
          const fields = collect();
          haptic();
          const other = existing ? splitPartner(existing, state.entries) : null;
          const sharedChanged = other && (dateInput.value !== localInputValue(existing.date)
            || ['type', 'amount', 'currency', 'account', 'merchant'].some((k) => String(fields[k] ?? '') !== String(existing[k] ?? '')));
          if (sharedChanged) {
            // half of a split: offer to carry the change to the other half, as one undo step
            askLinked(existing, 'edit', (how) => {
              batch(`Edited ${money(fields.amount, fields.currency)}${how === 'both' ? ' and its other half' : ''}`, () => {
                if (how !== 'both') { updateEntry(existing.id, fields); return; }
                const { mine: f1, other: f2 } = bothHalves(existing, fields, other);
                const saved = updateEntry(existing.id, f1);
                if (saved) updateEntry(other.id, { ...partnerPatch(saved, other, existing), ...f2 });
              });
              close();
              toast(`Updated · ${money(fields.amount, fields.currency)}${how === 'both' ? ' · both halves' : ''}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
            }, null, fields);
            return;
          }
          if (existing) updateEntry(existing.id, fields);
          else addEntry(fields);
          // say so when this takes a checked account below zero
          if (fields.type !== 'Income') {
            const b = balances(state.entries, state.settings).get(fields.account);
            if (b?.matchedAt && b.balance < 0) setTimeout(() => toast(`${esc(fields.account)} is now ${money(b.balance, 'AED')}, below zero`, { tone: 'warn', icon: icon('warn', { size: 18 }) }), 1400);
          }
          close();
          toast(`${existing ? 'Updated' : 'Saved'} · ${money(fields.amount, fields.currency)}${fields.category ? ' · ' + fields.category : ''}`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo() });
        }
      });

      // "Change both" on a USD split whose amount or currency changed: price the halves so they add up to the
      // bill in AED (the bill keeps its old AED price when its total and currency stay the same)
      function bothHalves(before, fields, other) {
        const r = rescaledPartner(before, fields, other);
        const otherAmount = r ? r.amount : other.amount;
        if (fields.currency === 'AED' || (!r && fields.currency === before.currency)) return { mine: fields, other: {} };
        const keep = r?.keepsTotal && fields.currency === before.currency;
        const whole = keep ? toAED(before, state.settings) + toAED(other, state.settings) : toAED({ amount: +fields.amount + +otherAmount, currency: fields.currency }, state.settings);
        const editedIsTheirs = before.type === 'Transfer';
        const pr = splitPrices(whole, editedIsTheirs ? fields.amount : otherAmount, fields.currency, state.settings);
        return editedIsTheirs
          ? { mine: { ...fields, amountAED: pr.theirsAED }, other: { amountAED: pr.mineAED } }
          : { mine: { ...fields, amountAED: pr.mineAED }, other: { amountAED: pr.theirsAED } };
      }

      function collect() {
        return {
          type: e.type, amount: e.amount, currency: e.currency, account: e.account,
          toAccount: e.type === 'Transfer' ? e.toAccount : '', category: e.type === 'Transfer' ? '' : e.category,
          merchant: merchantInput.value.trim(), note: noteInput.value.trim(),
          date: dateInput.value ? fromLocalInput(dateInput.value) : new Date().toISOString(),
        };
      }

      merchantInput.addEventListener('change', suggest);
      merchantInput.addEventListener('blur', suggest);
      // text fields bring up the keyboard — tuck the keypad away meanwhile
      sheet.addEventListener('focusin', (ev) => { if (ev.target.matches('input[type="text"]')) sheet.classList.add('typing'); });
      sheet.addEventListener('focusout', (ev) => { if (ev.target.matches('input[type="text"]')) setTimeout(() => { if (!sheet.contains(document.activeElement) || !document.activeElement.matches('input[type="text"]')) sheet.classList.remove('typing'); }, 50); });
      // Return moves on: amount → where → note → save
      const focusNext = (el) => { el.focus({ preventScroll: true }); requestAnimationFrame(() => { if (document.activeElement !== el) el.focus({ preventScroll: true }); }); setTimeout(() => { if (sheet.isConnected && document.activeElement !== el && !document.activeElement?.matches('input')) el.focus({ preventScroll: true }); }, 120); };
      merchantInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); focusNext(noteInput); } });
      noteInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (saveOk) save.click(); else noteInput.blur(); } });

      renderType();
      renderAmount();
      setNative(!!state.prefs.nativeKeys);
      requestAnimationFrame(() => moveThumb(false));
    },
  });
}
