/* ---------------------------------------------------------------------------
 * sw.js — service worker for the web / iOS build.
 *
 * Two jobs: make the app open instantly and work with no signal, and never get
 * in the way of the Todoist API.
 *
 * The hard rule below is that NOTHING from api.todoist.com is ever cached or
 * even routed through here. Serving a stale task list — or worse, a stale
 * response to the sync engine's read-modify-write — would silently corrupt
 * state across devices. API traffic goes straight to the network, always.
 *
 * Bump CACHE_VERSION whenever the shell files change; the activate handler
 * deletes every older cache.
 * ------------------------------------------------------------------------- */

const CACHE_VERSION = 'focus-v4';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const ASSET_CACHE = CACHE_VERSION + '-assets';

// Relative URLs so this works under a GitHub Pages project subpath.
const SHELL = [
  './',
  './index.html',
  './focus-sync.js',
  './focus-push.js',
  './confetti.browser.min.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll is atomic — one 404 rejects the whole install. Add individually
      // so a missing optional file can't wedge the worker permanently.
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== ASSET_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------------------------------------------------------------------------
 * Push notifications.
 *
 * iOS has no API for scheduling a local notification that fires while the app
 * is closed, so the scheduler Worker sends a Web Push at the right moment and
 * this handler turns it into a lock-screen alert.
 *
 * Note on `actions`: iOS Safari silently ignores custom notification action
 * buttons — only the default tap is rendered. So the intent travels in `data`
 * and the tap performs it, rather than being split across buttons.
 * ------------------------------------------------------------------------- */

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* empty push */ }

  // iOS revokes push permission from apps that receive a push and show nothing,
  // so there is always a visible notification even if the payload was garbage.
  const title = data.title || 'Focus';
  const options = {
    body: data.body || 'Your timer finished.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    // Shared tag means a push and an in-app notification for the same event
    // collapse into ONE alert instead of double-notifying.
    tag: data.tag || 'focus-timer',
    renotify: true,
    requireInteraction: false,
    data: { intent: data.intent || 'open', taskId: data.taskId || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const intent = (event.notification.data && event.notification.data.intent) || 'open';

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer an existing window so we don't spawn duplicates of a running app.
    for (const client of windows) {
      if ('focus' in client) {
        client.postMessage({ type: 'focus-notification-click', intent });
        return client.focus();
      }
    }
    // Cold start: pass the intent in the URL, since there's no client to message.
    return self.clients.openWindow('./?intent=' + encodeURIComponent(intent));
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept the API. See the note at the top of this file.
  if (url.hostname === 'api.todoist.com' || url.hostname === 'todoist.com') return;

  const isSameOrigin = url.origin === self.location.origin;

  // App shell: network-first so a redeploy is picked up on the next launch,
  // falling back to cache when offline. (Cache-first would strand the user on
  // an old build until the cache version changed.)
  if (isSameOrigin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin GETs — in practice Google Fonts. Cache-first so the app looks
  // right offline; opaque responses are fine to store, we just can't inspect them.
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(ASSET_CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
    })
  );
});
