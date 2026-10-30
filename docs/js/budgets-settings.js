// Settings → Budgets: set or clear a monthly (per cycle) limit for each spending category.
// The maths and HTML are in budgets.js; this file is the store wiring and the little sheet.
import { cycleOf, summarize, fmt } from './model.js';
import { state, getExtra, saveExtra } from './store.js';
import { openSheet, haptic, toast, esc } from './ui.js';
import { icon } from './icons.js';
import { BUDGETS_KEY, limitsOf, budgetsSettingsRows, metaOf } from './budgets.js';

/** The saved limits, ready to use. */
export const currentLimits = () => limitsOf(getExtra(BUDGETS_KEY, null));

/** Save a limit (a positive number) or clear it (null / 0), keeping everyone else's. */
export function setLimit(id, amount) {
  const limits = currentLimits();
  const n = Number(amount);
  const set = Number.isFinite(n) && n > 0;
  if (set) limits[id] = Math.round(n * 100) / 100; else delete limits[id];
  const name = metaOf(id).short || id;
  saveExtra(BUDGETS_KEY, Object.keys(limits).length ? { v: 1, limits } : null, set ? `Set the ${name} budget` : `Cleared the ${name} budget`);
}

export function budgetsSettingsBlock() {
  const s = state.settings;
  const sum = summarize(state.entries, cycleOf(new Date(), s.cycleStart), s, state.plan);
  return budgetsSettingsRows(currentLimits(), sum.byCategory);
}

export function budgetsClick(t) {
  const ed = t.closest('[data-budget-edit]');
  if (!ed) return false;
  openBudget(ed.dataset.budgetEdit);
  return true;
}

export function openBudget(id) {
  const name = metaOf(id).short || id;
  const had = currentLimits()[id];
  openSheet({
    label: `${id} budget`, tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${esc(name)} budget</h2><button class="text-btn strong" data-act="save" type="button">Save</button></header>
      <div class="sheet-scroll">
        <section class="group form">
          <label class="row input-row"><span>Limit per cycle</span><span class="suffix-input"><em>AED</em><input id="bf-amount" type="number" inputmode="decimal" min="0" step="any" value="${had || ''}" placeholder="e.g. 600"></span></label>
        </section>
        <p class="group-foot">Counts everything you spend in ${esc(id)} from the cycle’s start to its end, on any account. Moving money between accounts isn’t spending. You’ll get a gentle note on Home at 80% and again at 100%.</p>
        ${had ? '<button type="button" class="dup-btn danger-btn" data-act="clear">Remove this budget</button>' : ''}
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a === 'cancel') close();
        if (a === 'clear') { setLimit(id, null); haptic(); close(); toast(`Removed the ${esc(name)} budget`); }
        if (a === 'save') {
          const n = parseFloat(sheet.querySelector('#bf-amount').value);
          if (!(n > 0)) {
            if (!had) { sheet.querySelector('#bf-amount').focus(); toast('Type a limit above zero', { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
            setLimit(id, null); haptic(); close(); toast(`Removed the ${esc(name)} budget`); return;
          }
          setLimit(id, n);
          haptic(); close();
          toast(`${esc(name)} budget: AED ${fmt(n, { whole: true })}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}
