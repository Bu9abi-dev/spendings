// Activity tab: every entry, grouped by day, with search and filter chips.
import { dayKey, dayLabel, fmt, toAED } from './model.js';
import { state } from './store.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { entryRow, largeTitle, syncBadge, demoBanner } from './views.js';

export const activityFilter = { q: '', kind: 'all' };

export function renderActivity() {
  return `
    ${largeTitle('Activity', `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`, syncBadge())}
    ${demoBanner()}
    <div class="search">${icon('search', { size: 18 })}<input type="search" placeholder="Search" value="${esc(activityFilter.q)}" aria-label="Search entries" enterkeyhint="search"></div>
    <div class="filter-chips" role="tablist" aria-label="Filter">
      ${[['all', 'All'], ['Spend', 'Spending'], ['Income', 'Income'], ['Transfer', 'Transfers'], ['review', 'Needs review']]
        .map(([k, l]) => `<button type="button" role="tab" class="fchip${activityFilter.kind === k ? ' on' : ''}" aria-selected="${activityFilter.kind === k}" data-kind="${k}">${l}</button>`).join('')}
    </div>
    <div class="activity-list">${activityList()}</div>`;
}

export function activityList() {
  const q = activityFilter.q.trim().toLowerCase();
  const list = state.entries.filter((e) => {
    if (activityFilter.kind === 'review' && e.status !== 'Review') return false;
    if (['Spend', 'Income', 'Transfer'].includes(activityFilter.kind) && e.type !== activityFilter.kind) return false;
    if (q && ![e.merchant, e.note, e.category, e.account, e.toAccount, String(e.amount)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 400);
  if (!list.length) return `<div class="empty">${icon('search', { size: 28 })}<p>${q ? `Nothing matches “${esc(activityFilter.q)}”.` : 'Nothing here yet.'}</p></div>`;
  const days = new Map();
  for (const e of list) { const k = dayKey(e.date); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
  return [...days].map(([k, items]) => {
    const spent = items.filter((e) => e.type === 'Spend').reduce((a, e) => a + toAED(e, state.settings), 0);
    return `<div class="group-head day"><h3 class="group-title">${dayLabel(k)}</h3>${spent ? `<span class="day-total num">AED ${fmt(spent, { fixed: true })}</span>` : ''}</div>
      <section class="group">${items.map(entryRow).join('')}</section>`;
  }).join('');
}
