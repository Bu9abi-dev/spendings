// Money owed: people you split bills with or lend to. Pure (no store, no DOM), so Node tests run it.
// A person is an account (the sheet's Accounts tab) named in the `people` extra, { v: 1, names: [...] }.
// Their balance is what is owed: > 0 they owe you, < 0 you owe them. A split is the Spend cut down to
// your share plus a Transfer of their share from the same account to them, with the id `${spendId}-split`.
import { peopleBalances, isPerson, PEOPLE_ACCOUNTS, fmt, money } from './model.js';

export { peopleBalances, isPerson, PEOPLE_ACCOUNTS };

export const PEOPLE_KEY = 'people';
export const SPLIT_SUFFIX = '-split';
export const SPLIT_SOURCE = 'Split';
export const SPLIT_PARTS = [
  { id: 'half', label: 'Half', frac: 1 / 2 },
  { id: 'third', label: 'Third', frac: 1 / 3 },
  { id: 'custom', label: 'Custom', frac: null },
];

/** The names in a `people` extra, cleaned. */
export function peopleNames(extra) {
  const names = extra && Array.isArray(extra.names) ? extra.names : [];
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()))];
}
export const withPerson = (extra, name) => ({ v: 1, names: [...new Set([...peopleNames(extra), name])] });
export const renamedPerson = (extra, from, to) => ({ v: 1, names: [...new Set(peopleNames(extra).map((n) => (n === from ? to : n)))] });

const fils = (n) => Math.round((+n || 0) * 100);

/** Your share and theirs of `amount`, in the entry's own currency, adding up to it exactly.
    part: 'half' | 'third' | { theirs }. Their share is rounded down to the fil, so any leftover fil is yours.
    Returns null when their share isn't between 0 and the whole amount (both exclusive). */
export function splitShares(amount, part) {
  const total = fils(amount);
  let theirs;
  if (part && typeof part === 'object') theirs = fils(part.theirs);
  else {
    const p = SPLIT_PARTS.find((x) => x.id === part);
    if (!p || !p.frac) return null;
    theirs = Math.floor(total * p.frac + 1e-9);
  }
  if (!(total > 0) || !(theirs > 0) || theirs >= total) return null;
  return { mine: (total - theirs) / 100, theirs: theirs / 100 };
}

/** The other half of a split: the Spend for a split Transfer, the Transfer for a split Spend. */
export function splitPartner(e, entries) {
  if (!e?.id) return null;
  const id = String(e.id);
  if (id.endsWith(SPLIT_SUFFIX)) return entries.find((x) => x.id === id.slice(0, -SPLIT_SUFFIX.length)) || null;
  return entries.find((x) => x.id === id + SPLIT_SUFFIX) || null;
}
export const isSplitTransfer = (e) => !!e && String(e.id || '').endsWith(SPLIT_SUFFIX) && e.type === 'Transfer';

/** The person an entry is with: the "to" of a Transfer to a person, the "from" of one back, a Spend they paid. */
export function personOf(e) {
  if (!e) return '';
  if (isPerson(e.toAccount)) return e.toAccount;
  if (isPerson(e.account)) return e.account;
  return '';
}

/** The Transfer that holds their share of a split of `spend` (with the Spend's id already set). */
export function splitTransfer(spend, person, theirs) {
  const what = spend.merchant || spend.category || 'payment';
  return {
    id: spend.id + SPLIT_SUFFIX, type: 'Transfer', amount: theirs, currency: spend.currency || 'AED',
    account: spend.account, toAccount: person, category: '', merchant: '', note: `Split: ${what}`,
    date: spend.date, source: SPLIT_SOURCE,
  };
}

/** Fields to copy to the other half when one half is edited and you choose "both": the account it was
    paid from, the date and the currency. Amounts are each half's own. */
export function partnerPatch(edited, partner) {
  const patch = { date: edited.date, currency: edited.currency };
  if (edited.type === 'Spend' && partner.type === 'Transfer') {
    if (!isPerson(edited.account)) patch.account = edited.account;
    patch.note = `Split: ${edited.merchant || edited.category || 'payment'}`;
  } else if (edited.type === 'Transfer' && partner.type === 'Spend') {
    if (!isPerson(edited.account)) patch.account = edited.account;
  }
  return patch;
}

/** People to offer in a picker: whoever you dealt with most recently first, then the rest A–Z. */
export function recentPeople(entries, people = PEOPLE_ACCOUNTS) {
  const last = new Map();
  for (const e of entries) {
    const p = personOf(e);
    if (p && (!last.has(p) || e.date > last.get(p))) last.set(p, e.date);
  }
  return [...people].sort((a, b) => {
    const x = last.get(a.id) || '', y = last.get(b.id) || '';
    if (x !== y) return x < y ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/** The latest entries with a person, newest first. */
export const personEntries = (entries, name, limit = 5) => entries.filter((e) => e.account === name || e.toAccount === name).slice(0, limit);

/** The pre-filled Transfer that settles a person's balance: they pay you back into the main account,
    or you pay them from it. null when nothing is owed. */
export function settleUpPreset(name, balance, mainAccount) {
  const amt = Math.round(Math.abs(balance) * 100) / 100;
  if (amt < 0.01) return null;
  return balance > 0
    ? { type: 'Transfer', amount: amt, currency: 'AED', account: name, toAccount: mainAccount, merchant: 'Settle up', note: '' }
    : { type: 'Transfer', amount: amt, currency: 'AED', account: mainAccount, toAccount: name, merchant: 'Settle up', note: '' };
}

/** "Owed to you AED 50 · You owe AED 20", leaving out a side that is zero; '' when nothing is owed. */
export function owedText({ owedToYou, youOwe }) {
  const bits = [];
  if (owedToYou >= 0.005) bits.push(`Owed to you ${money(owedToYou)}`);
  if (youOwe >= 0.005) bits.push(`You owe ${money(youOwe)}`);
  return bits.join(' · ');
}

/** One person's balance in words. */
export function balanceWords(balance) {
  if (balance >= 0.005) return { tone: 'in', text: `owes you ${fmt(balance, { fixed: true })}` };
  if (balance <= -0.005) return { tone: 'out', text: `you owe ${fmt(-balance, { fixed: true })}` };
  return { tone: '', text: 'settled' };
}
