import { t } from './i18n.js';
// Makes a new Spendings sheet in your Google account: the spreadsheet, its Apps Script, and a web app
// deployment, using the access token from "Sign in with Google". No DOM here; fetch is passed in so
// tests/verify-setup.mjs can run it against a fake Google.
//
// Every step saves what it made (`save(progress)`) before the next one starts, so a retry after a
// failure carries on where it stopped instead of making a second sheet. The sheet is made through Drive
// with a random setup id on it (saved here first), so if Google's reply is lost, the retry finds that
// sheet instead of making another one.

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
];

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SCRIPT = 'https://script.googleapis.com/v1/projects';
export const USER_SETTINGS_URL = 'https://script.google.com/home/usersettings';
// Code.gs reads it in Code.gs's installerKey_(): A1 must start with this, A2 is the key
export const SETUP_TAB = 'Setup';
export const SETUP_MARK = 'Spendings app key (the script keeps it safe and removes this tab)';

/** The Apps Script manifest. Scopes are exactly what Code.gs uses: only the spreadsheet it's bound to
    (SpreadsheetApp.getActive, never another file) and its menu and popups in the sheet (getUi). */
export const MANIFEST = {
  timeZone: 'Asia/Dubai',
  runtimeVersion: 'V8',
  exceptionLogging: 'STACKDRIVER',
  oauthScopes: [
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/script.container.ui',
  ],
  webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' },
};

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
  if (status === 403 && /Apps Script API|usersettings/i.test(msg)) {
    return new SetupError('script-api-off', t('prov.scriptOff'), msg);
  }
  if (status === 403) return new SetupError('denied', t('prov.denied'), msg);
  if (status === 429 || status >= 500) return new SetupError('busy', t('prov.busy'), msg);
  return new SetupError('google', t('prov.step', { msg: msg || t('prov.error', { status }) }), msg);
}

/**
 * Runs (or resumes) the whole provisioning.
 *   token     the OAuth access token
 *   code      the text of Code.gs
 *   progress  what earlier attempts made: { key, setupId, sheetAsked, spreadsheetId, spreadsheetUrl, keyWritten,
 *             scriptId, pushed, versionNumber, deploymentId, url }
 *   save      called with the progress after every step
 *   onStep    called with the step's name as it starts ('sheet' | 'script' | 'code' | 'publish')
 *   makeKey   makes the app key and the setup id (tests pass their own)
 *   fetch     the fetch to use
 * Returns the finished progress (url = the web app's /exec address, key = the app key).
 */
export async function provision({ token, code, progress = {}, save = () => {}, onStep = () => {}, fetch: f = globalThis.fetch, makeKey: mk = makeKey }) {
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

  if (!p.scriptId) {
    onStep('script');
    const r = await api('POST', SCRIPT, { title: 'Spendings', parentId: p.spreadsheetId });
    if (!r.scriptId) throw new SetupError('google', t('prov.noScript'));
    p.scriptId = r.scriptId;
    keep();
  }

  if (!p.pushed) {
    onStep('code');
    await api('PUT', `${SCRIPT}/${p.scriptId}/content`, {
      files: [
        { name: 'Code', type: 'SERVER_JS', source: code },
        { name: 'appsscript', type: 'JSON', source: JSON.stringify(MANIFEST, null, 2) },
      ],
    });
    p.pushed = true;
    keep();
  }

  if (!p.versionNumber) {
    onStep('publish');
    const r = await api('POST', `${SCRIPT}/${p.scriptId}/versions`, { description: 'Set up by the Spendings app' });
    if (!r.versionNumber) throw new SetupError('google', t('prov.noVersion'));
    p.versionNumber = r.versionNumber;
    keep();
  }

  if (!p.deploymentId || !p.url) {
    onStep('publish');
    let d = p.deploymentId ? await api('GET', `${SCRIPT}/${p.scriptId}/deployments/${p.deploymentId}`)
      : await api('POST', `${SCRIPT}/${p.scriptId}/deployments`, { versionNumber: p.versionNumber, manifestFileName: 'appsscript', description: 'Spendings web app' });
    if (d.deploymentId) { p.deploymentId = d.deploymentId; keep(); }
    let url = webAppUrl(d);
    if (!url && p.deploymentId) url = webAppUrl(await api('GET', `${SCRIPT}/${p.scriptId}/deployments/${p.deploymentId}`));
    if (!url) throw new SetupError('google', t('prov.noUrl'));
    p.url = url;
    keep();
  }
  return p;
}

/** The /exec address from a deployment. */
export function webAppUrl(d) {
  const ep = (d?.entryPoints || []).find((e) => e.entryPointType === 'WEB_APP');
  return ep?.webApp?.url || '';
}

/** Where to allow the script: the web app itself (Google asks for permission there), or the editor as a fallback. */
export const allowUrl = (p) => (p.url ? `${p.url}${p.url.includes('?') ? '&' : '?'}setup=1` : '');
export const editorUrl = (p) => (p.scriptId ? `https://script.google.com/d/${encodeURIComponent(p.scriptId)}/edit` : '');
