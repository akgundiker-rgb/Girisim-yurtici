/* Malzeme Takip — service worker.
   Purpose: make the app installable and open instantly. It caches only the static shell (styles, scripts, fonts, images).
   It never caches API responses, the WebSocket, or the signed-in page itself, so data is always live and sessions are never stale.
   Bump VERSION whenever the static files change; old caches are removed on activation. */
const VERSION = 'depo-v20261019b';
const SHELL = [
  '/styles.css?v=20261019b', '/app.js?v=20261019b', '/pwa.js?v=20261019', '/offline.html',
  '/img/peakpv-logo.png', '/img/peakpv-logo-dark.png', '/img/icon-192.png', '/img/icon-512.png', '/img/badge-96.png', '/manifest.webmanifest',
  '/fonts/inter-latin-400-normal.woff2', '/fonts/inter-latin-500-normal.woff2', '/fonts/inter-latin-600-normal.woff2', '/fonts/inter-latin-700-normal.woff2',
  '/fonts/inter-latin-ext-400-normal.woff2', '/fonts/inter-latin-ext-500-normal.woff2', '/fonts/inter-latin-ext-600-normal.woff2', '/fonts/inter-latin-ext-700-normal.woff2',
  '/fonts/jetbrains-mono-latin-400-normal.woff2', '/fonts/jetbrains-mono-latin-500-normal.woff2', '/fonts/jetbrains-mono-latin-ext-400-normal.woff2', '/fonts/jetbrains-mono-latin-ext-500-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function isStatic(url) {
  return url.origin === self.location.origin && (
    url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/img/') ||
    ['/styles.css', '/app.js', '/pwa.js', '/manifest.webmanifest', '/offline.html'].includes(url.pathname));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return; // always live (uploads carry their own cache headers)

  if (req.mode === 'navigate') {
    // Pages: always revalidate with the server (sign-in state must be fresh); the offline page appears only when the network is unreachable.
    // redirect:'manual' lets the browser follow the server's own redirects (e.g. / -> /login) exactly as without a service worker.
    const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'include', redirect: 'manual' });
    e.respondWith(fetch(fresh).catch(() => caches.match('/offline.html')));
    return;
  }
  if (isStatic(url)) {
    // Static shell: serve from cache, refresh in the background.
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// ---------- Push notifications ----------
// The server sends { kind, title, body, tag, url }. Every push is shown as a notification (required by iOS and Chrome);
// the server itself does not push chat or project activity to people who currently have the app open in front of them.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Malzeme Takip', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Malzeme Takip', {
      body: d.body || '', icon: '/img/icon-192.png', badge: '/img/badge-96.png', tag: d.tag || 'depo', renotify: true,
      timestamp: d.ts || Date.now(), data: { url: d.url || '/' }, vibrate: d.kind === 'alert' ? [160, 80, 160, 80, 160] : [80]
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    // An external link (e.g. a Teams meeting) opens directly; anything on our own site goes to the open app window.
    if (!url.startsWith('/') && new URL(url, self.location.origin).origin !== self.location.origin) { await self.clients.openWindow(url); return; }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { try { await w.focus(); } catch (err) {} w.postMessage({ t: 'open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
