// Settings → Category limits: set or clear a limit per cycle for a spending category.
// The maths and HTML are in budgets.js; this file is the store wiring and the little sheets.
import { cycleOf, summarize, fmt, seriesColor, amtAED } from './model.js';
import { state, getExtra, saveExtra } from './store.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { BUDGETS_KEY, limitsOf, budgetsSettingsRows, metaOf, nameOf, addableCategories } from './budgets.js';

/** The saved limits, ready to use. */
export const currentLimits = () => limitsOf(getExtra(BUDGETS_KEY, null));

/** Save a limit (a positive number) or clear it (null / 0), keeping everyone else's. */
export function setLimit(id, amount) {
  const limits = currentLimits();
  const n = Number(amount);
  const set = Number.isFinite(n) && n > 0;
  if (set) limits[id] = Math.round(n * 100) / 100; else delete limits[id];
  const name = nameOf(metaOf(id));
  saveExtra(BUDGETS_KEY, Object.keys(limits).length ? { v: 1, limits } : null, set ? t('bud.setUndo', { name }) : t('bud.clearedUndo', { name }));
}

export function budgetsSettingsBlock() {
  const s = state.settings;
  const sum = summarize(state.entries, cycleOf(new Date(), s.cycleStart), s, state.plan);
  return budgetsSettingsRows(currentLimits(), sum.byCategory);
}

export function budgetsClick(tg) {
  const ed = tg.closest('[data-budget-edit]');
  if (ed) { openBudget(ed.dataset.budgetEdit); return true; }
  if (tg.closest('[data-budget-add]')) { openChooser(); return true; }
  return false;
}

/** "Add a limit": pick from the categories shown in lists that don't have a limit yet. */
function openChooser() {
  const list = addableCategories(currentLimits());
  openSheet({
    label: t('bud.addLimit'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('bud.addLimit')}</h2><span></span></header>
      <div class="sheet-scroll">
        ${list.length ? `<section class="group">${list.map((c) => `<button type="button" class="row link-row" data-pick="${esc(c.id)}">
          <span class="row-icon" style="--tint:${seriesColor(c.slot)}">${icon(c.icon, { size: 20 })}</span>
          <span class="row-main"><span class="row-title">${esc(nameOf(c))}</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>`).join('')}</section>`
          : `<p class="group-foot">${t('bud.allHave')}</p>`}
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="cancel"]')) { close(); return; }
        const pick = ev.target.closest('[data-pick]');
        if (pick) { const id = pick.dataset.pick; haptic(); close(); setTimeout(() => openBudget(id), 0); }
      });
    },
  });
}

export function openBudget(id) {
  const name = nameOf(metaOf(id));
  const had = currentLimits()[id];
  openSheet({
    label: t('bud.limitOf', { name }), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('bud.limitOf', { name: esc(name) })}</h2><button class="text-btn strong" data-act="save" type="button">${t('common.save')}</button></header>
      <div class="sheet-scroll">
        <section class="group form">
          <label class="row input-row"><span>${t('bud.perCycle')}</span><span class="suffix-input"><em>${t('cur.aed')}</em><input id="bf-amount" type="number" inputmode="decimal" min="0" step="any" value="${had || ''}" placeholder="${t('bud.eg600')}"></span></label>
        </section>
        <p class="group-foot">${t('bud.refundsNote')}</p>
        ${had ? `<button type="button" class="dup-btn danger-btn" data-act="clear">${t('bud.remove')}</button>` : ''}
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a === 'cancel') close();
        if (a === 'clear') { setLimit(id, null); haptic(); close(); toast(t('bud.removed', { name: esc(name) })); }
        if (a === 'save') {
          const n = parseFloat(sheet.querySelector('#bf-amount').value);
          if (!(n > 0)) {
            if (!had) { sheet.querySelector('#bf-amount').focus(); toast(t('bud.typeAbove'), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
            setLimit(id, null); haptic(); close(); toast(t('bud.removed', { name: esc(name) })); return;
          }
          setLimit(id, n);
          haptic(); close();
          toast(t('bud.limitSet', { name: esc(name), amt: amtAED(fmt(n, { whole: true })) }), { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}
