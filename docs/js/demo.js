// Synthetic entries for the demo mode. Clearly labelled in the UI; never sent to the sheet.
import { cycleOf, cycleBounds, shiftCycle } from './model.js';

const SPENDS = [
  ['Carrefour', 'Groceries', 'ADCB', 60, 260],
  ['Spinneys', 'Groceries', 'ADCB', 40, 180],
  ['Talabat', 'Food & Drinks', 'ADCB', 35, 95],
  ['Starbucks', 'Food & Drinks', 'ADCB', 18, 34],
  ['Tim Hortons', 'Food & Drinks', 'BOTIM', 12, 28],
  ['ADNOC', 'Transport & Fuel', 'ADCB', 80, 140],
  ['Careem', 'Transport & Fuel', 'BOTIM', 22, 70],
  ['Amazon.ae', 'Shopping', 'ADIB', 45, 320],
  ['Noon', 'Shopping', 'ADIB', 30, 210],
  ['VOX Cinemas', 'Entertainment', 'ADCB', 55, 120],
  ['Netflix', 'Bills & Subscriptions', 'ADIB', 39, 39],
  ['du', 'Bills & Subscriptions', 'ADCB', 125, 125],
  ['Aster Pharmacy', 'Health', 'BOTIM', 25, 90],
  ['Flowers & Co', 'Family & Gifts', 'ADCB', 60, 180],
];

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function demoEntries(settings) {
  const out = [];
  const now = new Date();
  const current = cycleOf(now, settings.cycleStart);
  for (let back = 0; back < 6; back++) {
    const cycle = shiftCycle(current, -back);
    const { start, end } = cycleBounds(cycle, settings.cycleStart);
    const stop = back === 0 ? now : end;
    const r = rng(1000 + back * 7);
    const day = 864e5;
    let n = 0;
    out.push({ id: `d-sal-${cycle}`, date: new Date(start.getTime() + 9 * 3600e3).toISOString(), type: 'Income', amount: 3000, currency: 'AED', account: 'ADCB', category: 'Allowance', merchant: '', note: 'Monthly allowance', source: 'App', status: 'OK' });
    if (back % 2 === 0) out.push({ id: `d-tr-${cycle}`, date: new Date(start.getTime() + 2 * day + 11 * 3600e3).toISOString(), type: 'Transfer', amount: 300, currency: 'AED', account: 'ADCB', toAccount: 'BOTIM', category: '', merchant: '', note: 'Top up Botim', source: 'App', status: 'OK' });
    for (let t = start.getTime() + 8 * 3600e3; t < stop.getTime(); t += day * (0.45 + r() * 0.9)) {
      const [merchant, category, account, lo, hi] = SPENDS[Math.floor(r() * SPENDS.length)];
      const amount = Math.round((lo + r() * (hi - lo)) * 100) / 100;
      out.push({
        id: `d-${cycle}-${n++}`, date: new Date(t + r() * 10 * 3600e3).toISOString(), type: 'Spend', amount, currency: 'AED',
        account, category, merchant, note: '', source: r() > 0.3 ? 'Apple Pay' : 'App', status: 'OK',
      });
    }
    if (back === 1) out.push({ id: `d-usd-${cycle}`, date: new Date(start.getTime() + 12 * day).toISOString(), type: 'Spend', amount: 19.99, currency: 'USD', account: 'ADIB', category: 'Bills & Subscriptions', merchant: 'Apple iCloud+', note: '', source: 'Apple Pay', status: 'OK' });
    if (back === 0) out.push({ id: `d-refund-${cycle}`, date: new Date(start.getTime() + 4 * day).toISOString(), type: 'Income', amount: 89, currency: 'AED', account: 'ADIB', category: 'Refund', merchant: 'Noon', note: 'Returned headphones', source: 'App', status: 'OK' });
  }
  // the two most recent Apple Pay spends wait for a category, like real ones would
  const recentPay = out.filter((e) => e.type === 'Spend' && new Date(e.date) <= now).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(1, 3);
  for (const e of recentPay) Object.assign(e, { category: '', status: 'Review', source: 'Apple Pay' });
  return out
    .filter((e) => new Date(e.date) <= now)
    .map((e) => ({ ...e, toAccount: e.toAccount || '', cycle: cycleOf(e.date, settings.cycleStart), amountAED: e.currency === 'USD' ? Math.round(e.amount * settings.usdRate * 100) / 100 : e.amount }));
}
