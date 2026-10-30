/* Language: English or Arabic, chosen in Settings → Language (saved on this phone only).
   t('key', { name: value }) gives the text for a key in the current language. The words live in
   strings/en.js and strings/ar.js (same keys in both; tests/verify-arabic.mjs checks). An object value is a
   plural: t('key', { n: 3 }) picks the form from Intl.PluralRules (Arabic has six: zero, one, two, few, many,
   other). A key missing from ar.js falls back to English, then to the key itself.
   Works in Node too (tests import the pure modules), where it is always English. */
import en from './strings/en.js';
import ar from './strings/ar.js';

const KEY = 'sp.lang';
const TABLES = { en, ar };
const PREFS = ['en', 'ar', 'auto'];

function readPref() {
  try { const v = globalThis.localStorage?.getItem(KEY); return PREFS.includes(v) ? v : 'en'; } catch { return 'en'; }
}
/** "auto" follows the iPhone's language: Arabic when its first language is Arabic, otherwise English. */
function resolve(pref) {
  if (pref !== 'auto') return pref;
  const langs = globalThis.navigator?.languages || [globalThis.navigator?.language || 'en'];
  return String(langs[0] || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let pref = readPref();
let cur = resolve(pref);
const plurals = {};
const listeners = new Set();

/** The language on screen: 'en' or 'ar'. */
export const lang = () => cur;
/** What Settings shows as chosen: 'en', 'ar' or 'auto'. */
export const langPref = () => pref;
/** 'rtl' for Arabic, else 'ltr'. */
export const dir = () => (cur === 'ar' ? 'rtl' : 'ltr');
export const isRTL = () => cur === 'ar';
/** Locale for Intl date formatting. Arabic keeps Western digits (like UAE bank apps). */
export const locale = () => (cur === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB');

/** Puts lang and dir on <html>. */
export function applyLang() {
  const html = globalThis.document?.documentElement;
  if (!html) return;
  html.lang = cur;
  html.dir = dir();
}

/** Choose a language ('en', 'ar' or 'auto'), save it on this phone, and tell listeners (main.js redraws). */
export function setLang(next) {
  if (!PREFS.includes(next)) return;
  pref = next;
  try { globalThis.localStorage?.setItem(KEY, next); } catch { /* private mode: still switches for now */ }
  const was = cur;
  cur = resolve(next);
  applyLang();
  if (was !== cur) listeners.forEach((fn) => fn(cur));
}
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function pluralForm(n) {
  const pr = plurals[cur] || (plurals[cur] = new Intl.PluralRules(cur));
  return pr.select(Number(n) || 0);
}

/** The text for key in the current language, with {name} filled from vars. */
export function t(key, vars) {
  let v = TABLES[cur]?.[key] ?? en[key];
  if (v == null) return key;
  if (typeof v === 'object') v = v[pluralForm(vars?.n)] ?? v.other;
  if (!vars) return v;
  // In Arabic each filled-in value is a bidi isolate (FSI…PDI), so a name like "Disney+" or "ADIB → ADCB"
  // keeps its own order inside the right-to-left sentence. English text is left exactly as it was.
  const iso = cur === 'ar' ? (s) => (s === '' ? s : `⁨${s}⁩`) : (s) => s;
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? iso(String(vars[k])) : m));
}

/** Keeps a number (or "AED 12.50") reading left to right inside Arabic text: wraps it in Unicode
    left-to-right isolate marks. In English it is returned unchanged, so tests and the sheet see the same text. */
export const ltr = (s) => (cur === 'ar' ? `⁦${s}⁩` : String(s));
