// App-shell cache. Bump VERSION whenever app files change so phones pick up the update.
const VERSION = 'spendings-v4';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png',
  'js/main.js', 'js/model.js', 'js/store.js', 'js/ui.js', 'js/entry.js', 'js/charts.js', 'js/icons.js', 'js/lock.js', 'js/demo.js', 'js/theme.js', 'js/home.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Same-origin GETs: network first (fresh code), cache as fallback when offline. Google calls pass straight through.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
