// "Sign in with Google": makes a new Spendings sheet and its Apps Script in the person's own Google
// account, straight from the browser. There is no server of ours in between, and no secret:
//   1. Google sign-in (OAuth "token" flow). The page goes to Google and comes back with a short-lived
//      access token in the address bar. A full-page redirect works in the iPhone Home Screen app,
//      where pop-up sign-in windows don't.
//   2. Sheets API: create an empty spreadsheet called "Spendings".
//   3. Apps Script API: create a script bound to that sheet, upload Code.gs plus a tiny Bootstrap file
//      that carries the new app key, save a version and publish it as a web app.
//   4. The person opens the web app link once and taps Allow (Google insists the owner approves a
//      script's access themselves). The first request then builds the sheet's tabs.
// Every step is saved on the phone, so "Try again" picks up where it stopped and never makes a second sheet.

// The OAuth client ID is public by design (it is in every Google sign-in page's address bar).
// Empty until Abdullah creates it in Google Cloud: see GOOGLE-SETUP.md. Without it the app
// offers the by-hand setup instead. A test or preview can set localStorage 'sp.gcid'.
export const GOOGLE_CLIENT_ID = '';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // only files this app creates, nothing else in Drive
  'https://www.googleapis.com/auth/script.projects', // create the script and upload its code
  'https://www.googleapis.com/auth/script.deployments', // publish it as a web app
];

const K_AUTH = 'sp.gauth'; // { state, token, expires } — sessionStorage, gone when the app closes
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCRIPT = 'https://script.googleapis.com/v1/projects';

export function clientId() {
  try { return localStorage.getItem('sp.gcid') || GOOGLE_CLIENT_ID; } catch { return GOOGLE_CLIENT_ID; }
}
export const googleReady = () => !!clientId();

const ss = {
  get() { try { return JSON.parse(sessionStorage.getItem(K_AUTH) || 'null'); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(K_AUTH, JSON.stringify(v)); } catch { /* private mode */ } },
};
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A new app key: 32 letters and digits, the same kind the sheet makes for itself. */
export const newAppKey = () => randomHex(16);

/** Where Google sends the person back to: this page, without the #part. */
const returnUrl = () => location.origin + location.pathname;

/** Leave for Google's sign-in page. Comes back to this page with the token (see takeToken). */
export function signIn() {
  const state = randomHex(12);
  ss.set({ state });
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: returnUrl(), response_type: 'token', scope: SCOPES.join(' '),
    include_granted_scopes: 'true', state, prompt: 'consent select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

/**
 * Run once at startup. If Google just sent the person back, keep the token, clean the address bar
 * and return { ok } or { error }. Otherwise return null.
 */
export function takeToken() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', returnUrl());
  const saved = ss.get();
  if (!saved || p.get('state') !== saved.state) return { error: 'That sign-in didn’t come from this app. Try again.' };
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said: ${p.get('error')}` };
  const granted = (p.get('scope') || '').split(' ');
  const missing = SCOPES.filter((s) => !granted.includes(s));
  if (missing.length) return { error: 'Tick every box on Google’s permission page, so the app can make your sheet and its script.' };
  ss.set({ token: p.get('access_token'), expires: Date.now() + (+p.get('expires_in') || 3600) * 1000 - 60e3 });
  return { ok: true };
}

/** The access token, if there is one that hasn't run out. */
export function token() {
  const a = ss.get();
  return a?.token && a.expires > Date.now() ? a.token : '';
}

/** A Google API call with the access token. Throws an Error with a plain-language message. */
async function api(method, url, body) {
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const msg = data.error?.message || `Google answered ${res.status}.`;
  const err = new Error(msg);
  if (res.status === 401) { err.code = 'signin'; err.message = 'Your Google sign-in ran out. Sign in again to carry on.'; }
  // Every Google account has to switch the Apps Script API on once, in its own Apps Script settings.
  if (/Apps Script API/i.test(msg) && /enable/i.test(msg)) { err.code = 'scriptapi'; err.message = 'Turn on the Apps Script API for your Google account, then try again.'; }
  throw err;
}

/** The web app's settings that go into the script's manifest (appsscript.json). */
export const MANIFEST = {
  timeZone: 'Asia/Dubai',
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
};

/**
 * Make the sheet and its published script. `job` is saved progress: fields already present are
 * skipped, so calling this again after an error carries on instead of starting over.
 * `onStep(name)` reports each step as it starts; `save(job)` stores progress.
 * Returns the finished job: { sheetId, sheetUrl, scriptId, version, url, key }.
 */
export async function createBackend(job, { onStep = () => {}, save = () => {}, fetchCode = defaultCode } = {}) {
  job = { ...job };
  if (!job.key) { job.key = newAppKey(); save(job); }
  if (!job.sheetId) {
    onStep('sheet');
    const s = await api('POST', SHEETS, { properties: { title: 'Spendings', locale: 'en_GB', timeZone: 'Asia/Dubai' } });
    Object.assign(job, { sheetId: s.spreadsheetId, sheetUrl: s.spreadsheetUrl }); save(job);
  }
  if (!job.scriptId) {
    onStep('script');
    const p = await api('POST', SCRIPT, { title: 'Spendings', parentId: job.sheetId });
    job.scriptId = p.scriptId; save(job);
  }
  if (!job.version) {
    onStep('code');
    const code = await fetchCode();
    await api('PUT', `${SCRIPT}/${job.scriptId}/content`, { files: [
      { name: 'appsscript', type: 'JSON', source: JSON.stringify(MANIFEST, null, 2) },
      { name: 'Code', type: 'SERVER_JS', source: code },
      { name: 'Bootstrap', type: 'SERVER_JS', source: bootstrapSource(job.key) },
    ] });
    const v = await api('POST', `${SCRIPT}/${job.scriptId}/versions`, { description: 'Made by the Spendings app' });
    job.version = v.versionNumber; save(job);
  }
  if (!job.url) {
    onStep('publish');
    const d = await api('POST', `${SCRIPT}/${job.scriptId}/deployments`, { versionNumber: job.version, manifestFileName: 'appsscript', description: 'Spendings web app' });
    const web = (d.entryPoints || []).find((e) => e.entryPointType === 'WEB_APP');
    if (!web?.webApp?.url) throw new Error('Google published the script but didn’t give back its link. Try again.');
    job.url = web.webApp.url; save(job);
  }
  return job;
}

/** The small extra script file that hands the new sheet its app key on its first request. */
export const bootstrapSource = (key) => `// Made by the Spendings app's setup. Gives this sheet its app key the first time it runs.
// After that the key lives in Project Settings → Script properties (TOKEN), and this file isn't used.
var SPENDINGS_BOOTSTRAP = { token: '${String(key).replace(/[^A-Za-z0-9]/g, '')}' };
`;

async function defaultCode() {
  const res = await fetch('backend/Code.gs', { cache: 'no-store' });
  if (!res.ok) throw new Error('Couldn’t load the sheet’s script. Check your connection and try again.');
  return res.text();
}

/** The script editor, for the by-hand way to approve the script. */
export const scriptEditorUrl = (scriptId) => `https://script.google.com/d/${scriptId}/edit`;
