// Spending trends for the Insights charts: day-by-day and week-by-week spend, top merchants,
// and each category over the last six cycles. Pure functions (no DOM, no store), so tests can run them.
//
// "Spending" here means exactly what the rest of Insights counts: entries of type Spend.
// Transfers between accounts are moving money, never spending, so they are left out.
// Refunds stay as income (like the donut and "Last six cycles"), so they don't change these bars.
import { cycleBounds, cycleLength, shiftCycle, toAED } from './model.js';

const DAY = 864e5;
const isSpend = (e) => e.type === 'Spend';

/** Index of the cycle day an entry falls on (0 = first day). Clamped into the cycle. */
function dayIndex(e, start, len) {
  return Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / DAY)));
}

/** Spend per day of the cycle, in AED. Returns an array with one number per day. */
export function dailySpend(entries, cycle, settings) {
  const len = cycleLength(cycle, settings.cycleStart);
  const { start } = cycleBounds(cycle, settings.cycleStart);
  const days = new Array(len).fill(0);
  for (const e of entries) {
    if (e.cycle !== cycle || !isSpend(e)) continue;
    days[dayIndex(e, start, len)] += toAED(e, settings);
  }
  return days;
}

/**
 * Split the cycle's days into weeks of seven, counted from the cycle's first day
 * (the last week can be shorter). Returns [{ from, to, total }] with day indexes.
 */
export function weeklySpend(daily) {
  const weeks = [];
  for (let i = 0; i < daily.length; i += 7) {
    const part = daily.slice(i, i + 7);
    weeks.push({ from: i, to: i + part.length - 1, total: part.reduce((a, v) => a + v, 0) });
  }
  return weeks;
}

/** One key per merchant so "Carrefour", "CARREFOUR" and "carrefour  " count together. */
export const merchantKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The merchants that took the most money this cycle.
 * Returns [{ name, total, count }] biggest first; name is the spelling used most often.
 * Entries without a merchant are skipped.
 */
export function topMerchants(entries, cycle, settings, limit = 5) {
  const groups = new Map();
  for (const e of entries) {
    if (e.cycle !== cycle || !isSpend(e)) continue;
    const key = merchantKey(e.merchant);
    if (!key) continue;
    const g = groups.get(key) || { total: 0, count: 0, spellings: new Map() };
    g.total += toAED(e, settings);
    g.count++;
    const name = String(e.merchant).trim().replace(/\s+/g, ' ');
    g.spellings.set(name, (g.spellings.get(name) || 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ name: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0], total: g.total, count: g.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Each spending category over the `count` cycles ending with `cycle` (oldest first).
 * Returns [{ id, values, total, usual }] for categories with any spend in that window, biggest first.
 * `usual` is the average of the earlier cycles, counting only cycles since the first entry
 * (so months before the app was used don't drag it down). null when there's no earlier cycle.
 */
export function categoryTrends(entries, cycle, settings, count = 6) {
  const cycles = Array.from({ length: count }, (_, i) => shiftCycle(cycle, i - (count - 1)));
  const pos = new Map(cycles.map((c, i) => [c, i]));
  const firstCycle = entries.reduce((m, e) => (e.cycle && (!m || e.cycle < m) ? e.cycle : m), '');
  const rows = new Map();
  for (const e of entries) {
    if (!isSpend(e) || !pos.has(e.cycle)) continue;
    // categories not in the list (old names) keep their own name; blank = needs a category
    const id = e.category || 'Uncategorised';
    const row = rows.get(id) || { id, values: new Array(count).fill(0) };
    row.values[pos.get(e.cycle)] += toAED(e, settings);
    rows.set(id, row);
  }
  return [...rows.values()].map((r) => {
    const earlier = r.values.slice(0, -1).filter((_, i) => cycles[i] >= firstCycle);
    const usual = earlier.length ? earlier.reduce((a, v) => a + v, 0) / earlier.length : null;
    return { ...r, total: r.values.reduce((a, v) => a + v, 0), usual };
  }).sort((a, b) => b.total - a.total);
}
