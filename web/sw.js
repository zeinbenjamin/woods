/* ============================================================
   Opening without signal (2.54.0)
   The page, its scripts and his data are kept on the phone as they last
   arrived, and used only when the network can't be reached. Everything goes
   to the network first, so a reachable server always wins: a new build, a
   signed-out redirect, a change from another phone. Served by the server
   with the build stamped in (never as a plain static file), so each build's
   worker keeps its own copy of that build's page and scripts.
   ============================================================ */
const BUILD = '__APP_BUILD__';
const SHELL = 'carry-shell-' + BUILD;    // the page and its scripts, one per build
const FILES = 'carry-files';             // course maps, map libraries, icons: as last fetched
const DATA = 'carry-data';               // clubs, courses, sessions, settings: as last loaded
const SHELL_URLS = ['/', '/platform.js?v=' + BUILD, '/holemap.js?v=' + BUILD, '/manifest.webmanifest', '/icon.svg'];
const DATA_PATHS = ['/api/clubs', '/api/courses', '/api/sessions', '/api/settings'];

// Only a plain answer from Carry itself is kept: never a redirect to the
// sign-in page, an error, or anything from another site.
const keepable = res => res && res.ok && res.type === 'basic' && !res.redirected;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    for (const url of SHELL_URLS) {
      const res = await fetch(url, { cache: 'no-cache', redirect: 'manual', credentials: 'same-origin' });
      if (!keepable(res)) throw new Error('not keepable: ' + url);   // signed out: try again next load
      await cache.put(url, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('carry-shell-') && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

// Network first; on no network, the copy kept here, marked so the page can say so.
async function networkFirst(request, cacheName, key) {
  try {
    const res = await fetch(request);
    if (keepable(res)) {
      const copy = res.clone(), headers = new Headers(copy.headers);
      headers.set('x-carry-kept', new Date().toISOString());
      const body = await copy.blob();
      await (await caches.open(cacheName)).put(key || request, new Response(body, { status: copy.status, statusText: copy.statusText, headers }));
    }
    return res;
  } catch (err) {
    const kept = await (await caches.open(cacheName)).match(key || request, { ignoreSearch: !key && request.mode === 'navigate' });
    if (!kept) throw err;
    const headers = new Headers(kept.headers);
    headers.set('x-carry-offline', headers.get('x-carry-kept') || '1');
    return new Response(await kept.blob(), { status: kept.status, statusText: kept.statusText, headers });
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // map tiles and other sites: the browser's own way
  if (req.mode === 'navigate') return event.respondWith(networkFirst(req, SHELL, '/'));
  if (DATA_PATHS.includes(url.pathname)) return event.respondWith(networkFirst(req, DATA));
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_blob/') || url.pathname === '/sw.js') return;   // live only
  if (SHELL_URLS.includes(url.pathname + url.search)) return event.respondWith(networkFirst(req, SHELL));
  event.respondWith(networkFirst(req, FILES));
});
