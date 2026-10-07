// Synthetic entries for the demo mode. Clearly labelled in the UI; never sent to the sheet.
// Follows the owner's real money flow: pay lands in ADIB, ADIB pays responsibilities,
// the allowance moves to ADCB, a top-up goes to BOTIM, and daily spending happens on ADCB/BOTIM.
import { cycleOf, cycleBounds, shiftCycle, dateInCycle } from './model.js';

// [merchant, category, account, low, high]
const DAILY = [
  ['Carrefour', 'Groceries', 'ADCB', 80, 260],
  ['Spinneys', 'Groceries', 'ADCB', 60, 180],
  ['Talabat', 'Food & Drinks', 'ADCB', 45, 110],
  ['Starbucks', 'Food & Drinks', 'ADCB', 22, 38],
  ['Salt', 'Food & Drinks', 'ADCB', 60, 140],
  ['Tim Hortons', 'Food & Drinks', 'BOTIM', 12, 28],
  ['Careem', 'Transport & Fuel', 'BOTIM', 22, 60],
  ['Amazon.ae', 'Shopping', 'ADCB', 60, 280],
  ['VOX Cinemas', 'Entertainment', 'ADCB', 60, 130],
  ['Aster Pharmacy', 'Health', 'ADCB', 25, 90],
  ['Flowers & Co', 'Family & Gifts', 'ADCB', 60, 180],
];
// paid from ADIB: responsibilities
const ADIB_SPEND = [
  ['ADNOC', 'Transport & Fuel', 110, 150],
  ['Car instalment', 'Bills & Subscriptions', 2200, 2200],
  ['du', 'Bills & Subscriptions', 125, 125],
  ['Home', 'Family & Gifts', 1500, 1500],
];

// what the demo's main account is responsible for each cycle
export const DEMO_PLAN = [
  { id: 'salary', name: 'Salary', kind: 'Income', amount: 6000, day: 27, from: '', to: 'ADIB', category: 'Salary' },
  { id: 'nafis', name: 'Nafis', kind: 'Income', amount: 4500, day: 1, from: '', to: 'ADIB', category: 'Nafis' },
  { id: 'allowance', name: 'Allowance', kind: 'Move', amount: 3000, day: 27, from: 'ADIB', to: 'ADCB', category: '' },
  { id: 'botim', name: 'BOTIM top-up', kind: 'Move', amount: 400, day: 28, from: 'ADIB', to: 'BOTIM', category: '' },
  { id: 'fuel', name: 'Fuel', kind: 'Responsibility', amount: 450, day: null, from: 'ADIB', to: '', category: 'Transport & Fuel' },
  { id: 'bills', name: 'Car & phone', kind: 'Responsibility', amount: 2325, day: 5, from: 'ADIB', to: '', category: 'Bills & Subscriptions' },
  { id: 'home', name: 'Home', kind: 'Responsibility', amount: 1500, day: 10, from: 'ADIB', to: '', category: 'Family & Gifts' },
];

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function demoEntries(settings) {
  const out = [];
  const now = new Date();
  const current = cycleOf(now, settings.cycleStart);
  const day = 864e5;
  const first = shiftCycle(current, -5);
  const firstStart = cycleBounds(first, settings.cycleStart).start;
  const base = { currency: 'AED', toAccount: '', category: '', merchant: '', note: '', status: 'OK' };

  // starting balances, matched with the bank before the first demo cycle
  for (const [acc, amt] of [['ADIB', 2100], ['ADCB', 260], ['BOTIM', 120], ['Cash', 350]]) {
    out.push({ ...base, id: `d-open-${acc}`, date: new Date(firstStart.getTime() - day).toISOString(), type: 'Adjustment', amount: amt, account: acc, note: 'Matched with bank', source: 'App' });
  }

  for (let back = 5; back >= 0; back--) {
    const cycle = shiftCycle(current, -back);
    const { start, end } = cycleBounds(cycle, settings.cycleStart);
    const stop = back === 0 ? now : end;
    const r = rng(1000 + back * 7);
    const at = (d, h = 9) => new Date(dateInCycle(cycle, d, settings.cycleStart).getTime() + h * 3600e3).toISOString();

    out.push({ ...base, id: `d-sal-${cycle}`, date: at(27, 8), type: 'Income', amount: 6000, account: 'ADIB', category: 'Salary', merchant: 'Salary', source: 'Plan:salary' });
    out.push({ ...base, id: `d-alw-${cycle}`, date: at(27, 12), type: 'Transfer', amount: 3000, account: 'ADIB', toAccount: 'ADCB', note: 'Allowance', source: 'Plan:allowance' });
    // in the current cycle Nafis hasn't landed yet — the app shows it as expected
    if (back > 0) out.push({ ...base, id: `d-naf-${cycle}`, date: at(1, 10), type: 'Income', amount: 4500, account: 'ADIB', category: 'Nafis', merchant: 'Nafis', source: 'Plan:nafis' });
    out.push({ ...base, id: `d-bt-${cycle}`, date: at(28, 18), type: 'Transfer', amount: 400, account: 'ADIB', toAccount: 'BOTIM', note: 'BOTIM top-up', source: 'Plan:botim' });
    if (back % 3 === 1) out.push({ ...base, id: `d-atm-${cycle}`, date: at(4, 19), type: 'Transfer', amount: 200, account: 'ADIB', toAccount: 'Cash', note: 'ATM' });

    ADIB_SPEND.forEach(([merchant, category, lo, hi], i) => {
      for (let k = 0; k < (category === 'Transport & Fuel' ? 3 : 1); k++) {
        const t = start.getTime() + (2 + i * 5 + k * 9) * day + 17 * 3600e3;
        if (t > stop.getTime()) continue;
        out.push({ ...base, id: `d-adib-${cycle}-${i}-${k}`, date: new Date(t).toISOString(), type: 'Spend', amount: Math.round((lo + r() * (hi - lo)) * 100) / 100, account: 'ADIB', category, merchant, source: 'Apple Pay' });
      }
    });

    let n = 0;
    for (let t = start.getTime() + 20 * 3600e3; t < stop.getTime(); t += day * (0.55 + r() * 0.7)) {
      const [merchant, category, account, lo, hi] = DAILY[Math.floor(r() * DAILY.length)];
      out.push({ ...base, id: `d-${cycle}-${n++}`, date: new Date(t + r() * 6 * 3600e3).toISOString(), type: 'Spend', amount: Math.round((lo + r() * (hi - lo)) * 100) / 100, account, category, merchant, source: r() > 0.3 ? 'Apple Pay' : 'App' });
    }
    if (back === 1) out.push({ ...base, id: `d-usd-${cycle}`, date: new Date(start.getTime() + 12 * day).toISOString(), type: 'Spend', amount: 19.99, currency: 'USD', account: 'ADIB', category: 'Bills & Subscriptions', merchant: 'Apple iCloud+', source: 'Apple Pay' });
    if (back === 0) out.push({ ...base, id: `d-refund-${cycle}`, date: new Date(start.getTime() + 4 * day).toISOString(), type: 'Income', amount: 89, account: 'ADCB', category: 'Refund', merchant: 'Noon', note: 'Returned headphones', source: 'App' });
  }

  // the owner checks their banks now and then: recent exact matches
  for (const [acc, d] of [['ADIB', 3], ['ADCB', 1], ['BOTIM', 9], ['Cash', 12]]) {
    out.push({ ...base, id: `d-match-${acc}`, date: new Date(now.getTime() - d * day).toISOString(), type: 'Adjustment', amount: 0, account: acc, note: 'Matched with bank', source: 'App' });
  }

  // the two most recent Apple Pay spends wait for a category, like real ones would
  const recentPay = out.filter((e) => e.type === 'Spend' && e.account !== 'ADIB' && new Date(e.date) <= now).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(1, 3);
  for (const e of recentPay) Object.assign(e, { category: '', status: 'Review', source: 'Apple Pay' });

  return out
    .filter((e) => new Date(e.date) <= now)
    .map((e) => ({ ...e, cycle: cycleOf(e.date, settings.cycleStart), amountAED: e.currency === 'USD' ? Math.round(e.amount * settings.usdRate * 100) / 100 : e.amount }));
}
