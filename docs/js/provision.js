import { t } from './i18n.js';
// Makes a new Spendings sheet in your Google account, using the access token from "Sign in with Google".
// It only asks Google for `drive.file` (the app can see the files it makes, nothing else), so the app can be
// published for anyone without Google's verification. The sheet's script is then pasted in by hand (the
// guide walks you through it): the script takes the app key from the sheet's "Setup" tab the first time it
// runs, so the app already knows the key and you only paste back the web app address.
// No DOM here; fetch is passed in so tests/verify-setup.mjs can run it against a fake Google.
//
// Every step saves what it made (`save(progress)`) before the next one starts, so a retry after a
// failure carries on where it stopped instead of making a second sheet. The sheet is made through Drive
// with a random setup id on it (saved here first), so if Google's reply is lost, the retry finds that
// sheet instead of making another one.

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
// Code.gs reads it in Code.gs's installerKey_(): A1 must start with this, A2 is the key
export const SETUP_TAB = 'Setup';
export const SETUP_MARK = 'Spendings app key (the script keeps it safe and removes this tab)';

/** A 24-character app key from the browser's secure random numbers (letters and digits, no bias). */
export function makeKey(rand = (a) => crypto.getRandomValues(a)) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < 24) {
    for (const b of rand(new Uint8Array(32))) {
      if (b < 248 && out.length < 24) out += abc[b % 62]; // 248 = 4 × 62: drop the rest so every letter is equally likely
    }
  }
  return out;
}

/** A failure with a plain-words message and a code the guide can act on. */
export class SetupError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

/** Turns a Google API error response into a SetupError. */
export function explain(status, body) {
  const msg = String(body?.error?.message || body?.error_description || body?.error || '');
  const reasons = (body?.error?.details || []).map((d) => d.reason).join(' ');
  if (status === 401) return new SetupError('auth', t('prov.auth'), msg);
  if (status === 403 && (/has not been used in project|is disabled/i.test(msg) || /SERVICE_DISABLED/.test(reasons))) {
    return new SetupError('api-disabled', t('prov.apiOff'), msg);
  }
  if (status === 403) return new SetupError('denied', t('prov.denied'), msg);
  if (status === 429 || status >= 500) return new SetupError('busy', t('prov.busy'), msg);
  return new SetupError('google', t('prov.step', { msg: msg || t('prov.error', { status }) }), msg);
}

/**
 * Runs (or resumes) making the sheet.
 *   token     the OAuth access token
 *   progress  what earlier attempts made: { key, setupId, sheetAsked, spreadsheetId, spreadsheetUrl, keyWritten }
 *   save      called with the progress after every step
 *   onStep    called with the step's name as it starts ('sheet')
 *   makeKey   makes the app key and the setup id (tests pass their own)
 *   fetch     the fetch to use
 * Returns the finished progress (spreadsheetUrl = the new sheet, key = the app key its script will adopt).
 */
export async function provision({ token, progress = {}, save = () => {}, onStep = () => {}, fetch: f = globalThis.fetch, makeKey: mk = makeKey }) {
  const p = { ...progress };
  const keep = () => save({ ...p });
  const api = async (method, url, body) => {
    let res;
    try {
      res = await f(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SetupError('offline', globalThis.navigator?.onLine === false ? t('prov.offline') : t('prov.reach'));
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw explain(res.status, data);
    return data || {};
  };

  if (!p.key) { p.key = mk(); keep(); }
  // a random label for the sheet, saved before asking Google to make it, so a retry can find it
  if (!p.setupId) { p.setupId = mk(); keep(); }

  if (!p.spreadsheetId) {
    onStep('sheet');
    let file = null;
    if (p.sheetAsked) {
      // an earlier try asked for the sheet but never heard back: look for it before making another.
      // drive.file lets the app list the files it made itself, and nothing else.
      const q = `appProperties has { key='setupId' and value='${p.setupId}' } and trashed=false`;
      const r = await api('GET', `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,webViewLink)')}&spaces=drive`);
      file = (r.files || [])[0] || null;
    }
    if (!file) {
      p.sheetAsked = true; keep();
      file = await api('POST', `${DRIVE}?fields=${encodeURIComponent('id,webViewLink')}`, {
        name: 'Spendings', mimeType: SHEET_MIME, appProperties: { spendings: '1', setupId: p.setupId },
      });
    }
    if (!file.id) throw new SetupError('google', t('prov.noSheet'));
    p.spreadsheetId = file.id;
    p.spreadsheetUrl = file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    keep();
  }

  if (!p.keyWritten) {
    onStep('sheet');
    // the key goes in a "Setup" tab (the sheet's first tab, renamed): the script adopts it the first time it runs
    const id = encodeURIComponent(p.spreadsheetId);
    const r = await api('GET', `${SHEETS}/${id}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
    const first = r.sheets?.[0]?.properties;
    if (!first || first.sheetId == null) throw new SetupError('google', t('prov.noTabs'));
    const cell = (v) => ({ values: [{ userEnteredValue: { stringValue: v } }] });
    await api('POST', `${SHEETS}/${id}:batchUpdate`, {
      requests: [
        { updateSpreadsheetProperties: { properties: { timeZone: 'Asia/Dubai', locale: 'en_GB' }, fields: 'timeZone,locale' } },
        { updateSheetProperties: { properties: { sheetId: first.sheetId, title: SETUP_TAB }, fields: 'title' } },
        { updateCells: { start: { sheetId: first.sheetId, rowIndex: 0, columnIndex: 0 }, rows: [cell(SETUP_MARK), cell(p.key)], fields: 'userEnteredValue' } },
      ],
    });
    p.keyWritten = true;
    keep();
  }

  return p;
}

/** A pasted web app address that can be a Spendings script: Google's /exec (or /dev) address. */
export const isWebAppUrl = (u) => /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(String(u || '').trim());
