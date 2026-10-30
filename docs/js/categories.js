// Your categories: add your own, rename any, or hide ones you don't use.
// Saved in the `categories` extra as { v: 1, custom: [{ id, type, icon }], hidden: [id], names: { id: label } }.
// A category's id is what the sheet stores, so it never changes: renaming only changes the label the app shows,
// and hiding only takes it out of the pickers. Past entries always keep their category.
import { allCategories, categoryKey, CATEGORY_ICONS, DEFAULT_SPEND_CATEGORIES, DEFAULT_INCOME_CATEGORIES, seriesColor } from './model.js';
import { state, getExtra, saveExtra, batch } from './store.js';
import { BUDGETS_KEY, limitsOf } from './budgets.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';

const KEY = 'categories';
const config = () => {
  const c = getExtra(KEY, null) || {};
  return { v: 1, custom: Array.isArray(c.custom) ? c.custom : [], hidden: Array.isArray(c.hidden) ? c.hidden : [], names: c.names && typeof c.names === 'object' ? c.names : {} };
};
const isBuiltIn = (id, type) => (type === 'Income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_SPEND_CATEGORIES).some((c) => c.id === id);
const usedBy = (id, type) => state.entries.filter((e) => e.category === id && (type === 'Income' ? e.type === 'Income' : e.type !== 'Income')).length;
const warnIcon = () => icon('warn', { size: 18 });

/** Settings block: one row per category (hidden ones dimmed), then "Add a category". */
export function categoriesSettingsBlock() {
  // only say something when there's something to say, so the list stays short
  const sub = (c) => [c.hidden ? 'Hidden' : '', c.custom ? 'Yours' : '', c.label !== c.id ? `Original name: ${esc(c.id)}` : ''].filter(Boolean).join(' · ');
  const row = (c, type) => `<button type="button" class="row link-row cat-row${c.hidden ? ' is-hidden' : ''}" data-cat-edit="${esc(c.id)}" data-cat-type="${type}">
      <span class="row-icon" style="--tint:${type === 'Income' ? 'var(--good)' : seriesColor(c.slot)}">${icon(c.icon, { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(c.label || c.id)}</span>${sub(c) ? `<span class="row-sub">${sub(c)}</span>` : ''}</span>
      ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
  return `${allCategories('Spend').map((c) => row(c, 'Spend')).join('')}
    <details class="cat-income"><summary class="row link-row"><span class="row-main"><span class="row-title">Money-in categories</span></span>${icon('chevD', { size: 16, cls: 'chev' })}</summary>
      ${allCategories('Income').map((c) => row(c, 'Income')).join('')}
    </details>
    <button type="button" class="row link-row" data-cat-new="1">
      <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">Add a category</span><span class="row-sub">e.g. Coffee, Car, University</span></span></button>`;
}

export function categoriesClick(t) {
  const ed = t.closest('[data-cat-edit]');
  if (ed) { openCategory(ed.dataset.catEdit, ed.dataset.catType); return true; }
  if (t.closest('[data-cat-new]')) { openCategory(null, 'Spend'); return true; }
  return false;
}

/** Is this name free? Compared without case against every id and label of both types. */
function nameFree(name, exceptId = '') {
  const n = name.trim().toLowerCase();
  if (['uncategorised', 'needs category', 'decide later', 'all'].includes(n)) return false;
  return ![...allCategories('Spend'), ...allCategories('Income')].some((c) => c.id !== exceptId && (c.id.toLowerCase() === n || (c.label || '').toLowerCase() === n));
}

export function openCategory(id, type = 'Spend') {
  const existing = id ? allCategories(type).find((c) => c.id === id) : null;
  const cat = existing ? { ...existing } : { id: '', label: '', icon: 'sparkle', custom: true, hidden: false };
  let kind = type;
  const used = existing ? usedBy(existing.id, type) : 0;
  const builtIn = existing && isBuiltIn(existing.id, type);
  const key = existing ? categoryKey(existing.id, type) : '';

  openSheet({
    label: existing ? `Edit ${existing.label}` : 'New category', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? 'Edit category' : 'New category'}</h2><button class="text-btn strong" data-act="save" type="button">${existing ? 'Save' : 'Add'}</button></header>
      <div class="sheet-scroll acct-form">
        <section class="group form">
          <label class="row input-row"><span>Name</span><input id="cf-name" type="text" maxlength="24" autocomplete="off" autocapitalize="words" value="${esc(existing ? existing.label : '')}" placeholder="e.g. Coffee"></label>
        </section>
        ${existing ? (existing.label !== existing.id || builtIn ? `<p class="group-foot">Your sheet keeps saving it as “${esc(existing.id)}”, so old entries and the Shortcut keep working.</p>` : '')
          : `<div class="ap-label acct-colour-label">Type</div>
        <div class="chips cf-type" role="radiogroup" aria-label="Type" style="--chip:var(--tint)">
          <button type="button" role="radio" class="chip on" aria-checked="true" data-kind="Spend">Spending</button>
          <button type="button" role="radio" class="chip" aria-checked="false" data-kind="Income">Money in</button>
        </div>`}
        ${!existing || existing.custom ? `<div class="ap-label acct-colour-label">Icon</div>
        <div class="cf-icons" role="radiogroup" aria-label="Icon">
          ${CATEGORY_ICONS.map((n) => `<button type="button" role="radio" class="cf-icon" aria-checked="${n === cat.icon}" aria-label="${n}" data-icon="${n}">${icon(n, { size: 22 })}</button>`).join('')}
        </div>` : ''}
        ${existing ? `<section class="group">
          <label class="row toggle-row"><span class="row-main"><span class="row-title">Show in lists</span><span class="row-sub">${used ? `${used} ${used === 1 ? 'entry uses' : 'entries use'} it. They keep it either way.` : 'No entries use it yet.'}</span></span>
            <input type="checkbox" switch class="switch" id="cf-shown" ${existing.hidden ? '' : 'checked'}></label>
        </section>
        ${existing.custom && !used ? '<div class="acct-danger"><button type="button" class="dup-btn danger-btn" data-act="delete">Delete category</button></div>' : ''}` : ''}
      </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      sheet.addEventListener('click', (ev) => {
        const ic = ev.target.closest('[data-icon]');
        if (ic) { cat.icon = ic.dataset.icon; sheet.querySelectorAll('[data-icon]').forEach((b) => b.setAttribute('aria-checked', String(b === ic))); haptic(); return; }
        const k = ev.target.closest('[data-kind]');
        if (k) { kind = k.dataset.kind; sheet.querySelectorAll('[data-kind]').forEach((b) => { b.setAttribute('aria-checked', String(b === k)); b.classList.toggle('on', b === k); }); haptic(); return; }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'cancel') close();
        if (act === 'delete') {
          const c = config();
          c.custom = c.custom.filter((x) => !(x.id === existing.id && (x.type || 'Spend') === type));
          c.hidden = c.hidden.filter((x) => x !== key);
          delete c.names[key];
          // a limit on a deleted category would be left behind, so it goes too, as one undo step
          const lim = limitsOf(getExtra(BUDGETS_KEY, null));
          batch(`Deleted ${existing.label}`, () => {
            saveExtra(KEY, c, `Deleted ${existing.label}`);
            if (type === 'Spend' && existing.id in lim) {
              delete lim[existing.id];
              saveExtra(BUDGETS_KEY, Object.keys(lim).length ? { v: 1, limits: lim } : null, `Deleted ${existing.label}`);
            }
          });
          haptic(); close();
          toast(`Deleted ${esc(existing.label)}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
        if (act === 'save') {
          const nm = $('#cf-name').value.trim().replace(/\s+/g, ' ');
          if (!nm) { $('#cf-name').focus(); toast('Give the category a name', { tone: 'warn', icon: warnIcon() }); return; }
          if (/^[=+\-@]/.test(nm)) { toast('Start the name with a letter or number', { tone: 'warn', icon: warnIcon() }); return; }
          if (!nameFree(nm, existing?.id)) { toast(`You already have a category called ${esc(nm)}`, { tone: 'warn', icon: warnIcon() }); return; }
          const c = config();
          if (existing) {
            // a custom category is renamed by label too, so its id (in the sheet) stays put
            if (nm === existing.id) delete c.names[key]; else c.names[key] = nm;
            const shown = $('#cf-shown').checked;
            // keep at least one category to pick from
            if (!shown && !existing.hidden && allCategories(type).filter((x) => !x.hidden).length <= 1) { toast('Keep at least one category showing', { tone: 'warn', icon: warnIcon() }); return; }
            c.hidden = c.hidden.filter((x) => x !== key);
            if (!shown) c.hidden.push(key);
            if (existing.custom) c.custom = c.custom.map((x) => (x.id === existing.id && (x.type || 'Spend') === type ? { ...x, icon: cat.icon } : x));
            saveExtra(KEY, c, `Changed ${existing.label}`);
          } else {
            c.custom = [...c.custom, { id: nm, type: kind, icon: cat.icon }];
            saveExtra(KEY, c, `Added ${nm}`);
          }
          haptic(); close();
          toast(existing ? `Saved ${esc(nm)}` : `Added ${esc(nm)}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}
