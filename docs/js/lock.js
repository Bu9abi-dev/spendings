// Face ID lock via WebAuthn (a platform passkey). It's a local privacy screen, not server auth:
// your data still lives in your Google Sheet behind your app key.
import { state, setPrefs } from './store.js';
import { icon } from './icons.js';

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function lockSupported() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

export async function enableLock() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Spendings', id: location.hostname },
      user: { id: rand(16), name: 'spendings', displayName: 'Spendings' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  setPrefs({ lock: true, credId: b64(cred.rawId) });
}

export function disableLock() { setPrefs({ lock: false, credId: '' }); }

async function verify() {
  await navigator.credentials.get({
    publicKey: {
      challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: state.prefs.credId ? [{ type: 'public-key', id: unb64(state.prefs.credId) }] : [],
    },
  });
}

let hiddenAt = 0;
export function initLock() {
  const el = document.getElementById('lock');
  const show = () => {
    if (!state.prefs.lock) return;
    el.hidden = false;
    document.documentElement.classList.add('locked');
    el.innerHTML = `<div class="lock-inner">
      <div class="lock-badge glass">${icon('lock', { size: 30 })}</div>
      <h1>Spendings is locked</h1>
      <p>Your balances are hidden until you unlock.</p>
      <button type="button" class="lock-btn glass">${icon('faceid', { size: 22 })}<span>Unlock with Face ID</span></button>
      <p class="lock-err" role="alert"></p></div>`;
    const btn = el.querySelector('.lock-btn'), err = el.querySelector('.lock-err');
    btn.onclick = async () => {
      err.textContent = '';
      try {
        await verify();
        el.classList.add('out');
        document.documentElement.classList.remove('locked');
        setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 380);
      } catch {
        err.textContent = 'Face ID didn’t go through. Try again.';
      }
    };
  };
  show();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (state.prefs.lock && Date.now() - hiddenAt > 60_000) show();
  });
}
