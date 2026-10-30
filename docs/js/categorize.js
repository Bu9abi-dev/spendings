// Smarter auto-categories: guesses a category for a merchant name by learning from past entries.
//
// Bank and Apple Pay names are messy ("CARREFOUR MCC 5411 ABU DHABI AE", "SQ *SALT CAFE 0423").
// cleanMerchant() strips the noise so they line up with what you typed before ("Carrefour").
// suggestFor() then looks for, in order:
//   1. the same cleaned name among your filed entries (or the sheet's remembered merchants),
//   2. a close name: one contains the other ("carrefour" / "carrefour market"), or a one-letter typo,
//   3. a built-in hint for well-known UAE shops ("ADNOC" → Transport & Fuel). Lowest confidence.
// Only ever suggests. Nothing here changes an entry by itself.
import { SPEND_CATEGORIES } from './model.js';

// Words that say where or how you paid, not who you paid.
const NOISE = new Set([
  'abu', 'dhabi', 'dubai', 'sharjah', 'ajman', 'ain', 'al ain', 'auh', 'dxb', 'shj', 'uae', 'ae', 'are', 'u', 'a', 'e',
  'mcc', 'pos', 'purchase', 'payment', 'pay', 'card', 'applepay', 'contactless', 'visa', 'mastercard', 'debit', 'credit',
  'llc', 'l', 'c', 'fze', 'fzco', 'fz', 'co', 'est', 'branch', 'br', 'trading', 'tr', 'ltd', 'inc', 'the',
  'www', 'com', 'net', 'online', 'mall', 'city', 'center', 'centre', 'road', 'st', 'street', 'reem', 'island', 'yas',
  'khalifa', 'mussafah', 'mushrif', 'marina', 'jbr', 'jlt', 'bur', 'deira', 'karama', 'airport', 'terminal',
]);
// Payment-processor prefixes: "SQ *SALT", "PAYPAL *NETFLIX", "SUMUP *KARAK"
const PREFIX = /^(sq|sp|tst|paypal|pp|sumup|zettle|izettle|stripe|google|gpay|checkout|ckout|amzn mktp|amazon mktp)\s*\*\s*/i;

/** "CARREFOUR MCC 5411 ABU DHABI AE" → "carrefour". The words that name the shop, lower-case. */
export function cleanMerchant(raw) {
  let s = String(raw || '').toLowerCase().trim().replace(PREFIX, '');
  s = s.replace(/\.(com|ae|net|org)\b/g, ' ')         // amazon.ae → amazon
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ');         // punctuation → space (keeps Arabic)
  const words = s.split(' ').filter((w) => w && !NOISE.has(w) && !/\d/.test(w)); // numbers are store ids, MCCs, card digits
  return words.slice(0, 3).join(' ');                  // the first few words name the shop; the rest is usually location
}

// Built-in hints for when you've never filed a merchant. Checked against the cleaned name.
const HINTS = [
  ['Transport & Fuel', /\b(adnoc|enoc|eppco|emarat|careem(?! food)|uber|salik|darb|rta|mawaqif|parking|taxi|petrol|fuel)\b/],
  ['Groceries', /\b(carrefour|lulu|spinneys|choithrams|union coop|abu dhabi coop|coop|waitrose|grandiose|al maya|almaya|nesto|viva|kibsons|grocery|supermarket|hypermarket|baqala)\b/],
  ['Food & Drinks', /\b(talabat|deliveroo|noon food|careem food|zomato|starbucks|costa|tim hortons|mcdonald|mcdonalds|kfc|burger|shake shack|pizza|domino|subway|cafe|coffee|karak|restaurant|grill|shawarma|bakery|salt)\b/],
  ['Bills & Subscriptions', /\b(netflix|spotify|shahid|osn|icloud|itunes|youtube|disney|du|etisalat|addc|adwea|taqa|dewa|sewa|insurance|chatgpt|openai|anthropic|claude)\b/],
  ['Health', /\b(pharmacy|aster|life pharmacy|boots|clinic|hospital|medical|dental|cleveland|mediclinic|nmc|burjeel)\b/],
  ['Travel', /\b(emirates|etihad|flydubai|air arabia|wizz|booking|airbnb|agoda|expedia|hotel|marriott|hilton)\b/],
  ['Entertainment', /\b(vox|cinema|cinemas|reel|novo|steam|playstation|xbox|nintendo|roblox|ferrari world|warner|seaworld|bowling)\b/],
  ['Shopping', /\b(amazon|noon|namshi|shein|ikea|zara|h and m|hm|centrepoint|max|sharaf|virgin|jumbo|ounass|nike|adidas|decathlon)\b/],
];
const VALID = new Set(SPEND_CATEGORIES.map((c) => c.id));

/** Typo check: are a and b at most one letter apart? (insert, delete or swap one letter) */
function oneApart(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How alike two cleaned names are, 0..1. 1 = same; 0.8 = one contains the other; 0.7 = a typo apart. */
function likeness(a, b) {
  if (a === b) return 1;
  const A = a.split(' '), B = b.split(' ');
  // "carrefour" vs "carrefour market": every word of the shorter name starts the longer one
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  if (short.join(' ').length >= 4 && short.every((w, i) => w === long[i])) return 0.8;
  // one-letter typo in a longish first word, rest equal ("carefour" vs "carrefour")
  if (A.length === B.length && A[0].length >= 5 && oneApart(A[0], B[0]) && A.slice(1).join(' ') === B.slice(1).join(' ')) return 0.7;
  return 0;
}

/**
 * What you've filed before, grouped by cleaned merchant name.
 * entries: the ledger. remembered: the sheet's Merchants map ({ key: category }), used when the ledger has none.
 * Returns Map(cleaned name → { name, counts: Map(category → n), total, last })
 */
export function learn(entries, remembered = {}) {
  const index = new Map();
  for (const e of entries) {
    if (e.type !== 'Spend' || !e.merchant || !e.category || e.status === 'Review' || !VALID.has(e.category)) continue;
    const key = cleanMerchant(e.merchant);
    if (!key) continue;
    let g = index.get(key);
    if (!g) index.set(key, (g = { name: '', counts: new Map(), total: 0, last: '' }));
    g.counts.set(e.category, (g.counts.get(e.category) || 0) + 1);
    g.total++;
    // newest entry wins ties later, and its spelling is the one shown ("like Carrefour")
    if (!g.last || e.date > g.last) { g.last = e.date; g.lastCat = e.category; }
    if (!g.name || (g.name === g.name.toUpperCase() && e.merchant !== e.merchant.toUpperCase())) g.name = e.merchant; // prefer your own typing over BANK CAPS
  }
  for (const [raw, cat] of Object.entries(remembered || {})) {
    const key = cleanMerchant(raw);
    if (!key || index.has(key) || !VALID.has(cat)) continue;
    index.set(key, { name: raw, counts: new Map([[cat, 1]]), total: 1, last: '', lastCat: cat });
  }
  return index;
}

/** The most-used category in a group; ties go to the one used most recently. */
function topCategory(g) {
  let best = '', n = 0;
  for (const [cat, c] of g.counts) if (c > n || (c === n && cat === g.lastCat)) { best = cat; n = c; }
  return { category: best, share: n / g.total };
}

/**
 * Best guess for a merchant name, or null.
 * → { category, confidence: 'high' | 'medium' | 'low', like: 'Carrefour', times: 5, key: 'carrefour' }
 *   high   = same shop, and you filed it the same way at least 3 times out of 4
 *   medium = same or similar shop, less consistent or fewer times
 *   low    = no history, only a built-in hint
 */
export function suggestFor(merchant, index) {
  const key = cleanMerchant(merchant);
  if (!key) return null;
  let g = index.get(key), score = g ? 1 : 0;
  if (!g) {
    for (const [k, cand] of index) {
      const s = likeness(key, k);
      if (s > score || (s === score && s > 0 && cand.total > g.total)) { score = s; g = cand; }
    }
  }
  if (g) {
    const { category, share } = topCategory(g);
    const confidence = score === 1 && share >= 0.75 && g.total >= 2 ? 'high' : 'medium';
    return { category, confidence, like: g.name, times: g.total, key };
  }
  const hint = HINTS.find(([, re]) => re.test(key));
  return hint ? { category: hint[0], confidence: 'low', like: '', times: 0, key } : null;
}

/** Same shop? Used for "file all from this merchant". */
export const sameMerchant = (a, b) => {
  const x = cleanMerchant(a), y = cleanMerchant(b);
  return !!x && likeness(x, y) >= 0.8;
};
