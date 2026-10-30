// Opening without signal (2.54.0). The service worker in isolation, against a
// stand-in network and Cache Storage (node has neither a worker nor caches):
// network first for everything, the phone's copy only when the network can't be
// reached, never a sign-in redirect or an error kept. Then the server's stamped
// copy, and the app saying when it is showing the phone's copy.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { startApp } from './harness.js';

const ORIGIN = 'https://carry.test';
const BUILD = '2.54.0-abc1234';

// A worker loaded the way the server serves it: the build stamped in.
function loadWorker() {
  const handlers = {}, stores = new Map();
  const keyOf = (k, ignoreSearch) => { const u = new URL(typeof k === 'string' ? k : k.url, ORIGIN); return ignoreSearch ? u.origin + u.pathname : u.href; };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async put(k, res) { m.set(keyOf(k), res); },
        async match(k, o = {}) { if (o.ignoreSearch) { for (const [kk, v] of m) if (keyOf(kk, true) === keyOf(k, true)) return v.clone(); return undefined; } const r = m.get(keyOf(k)); return r && r.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const net = { online: true, answer: null, calls: [] };
  const fetch = async (req, opts) => {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN).href;
    net.calls.push(url);
    if (!net.online) throw new TypeError('Failed to fetch');
    return net.answer(url, opts);
  };
  const self = { location: new URL(ORIGIN), addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const src = readFileSync('web/sw.js', 'utf8').replaceAll('__APP_BUILD__', BUILD);
  vm.runInNewContext(src, { self, caches, fetch, Response, Headers, URL, Date, Error, TypeError, console });
  const fire = async (type, req) => {
    let waited = null, responded;
    handlers[type]({ request: req, waitUntil: p => { waited = p; }, respondWith: p => { responded = p; } });
    if (waited) await waited;
    return responded === undefined ? 'not handled' : responded;
  };
  return { fire, stores, net, req: (path, extra = {}) => ({ url: ORIGIN + path, method: 'GET', mode: 'cors', ...extra }) };
}
const ok = (body, extra = {}) => Object.assign(new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }), extra);
const basic = body => { const r = ok(body); Object.defineProperty(r, 'type', { value: 'basic' }); return r; };
const redirect = () => { const r = new Response(null, { status: 200 }); Object.defineProperty(r, 'type', { value: 'opaqueredirect' }); Object.defineProperty(r, 'ok', { value: false }); return r; };

test('installing keeps this build\'s page and scripts; a sign-in redirect fails the install so it tries again next time', async () => {
  const w = loadWorker();
  w.net.answer = url => basic('shell ' + new URL(url).pathname);
  await w.fire('install');
  const shell = w.stores.get('carry-shell-' + BUILD);
  assert.deepEqual([...shell.keys()].map(k => k.replace(ORIGIN, '')).sort(),
    ['/', '/holemap.js?v=' + BUILD, '/icon.svg', '/manifest.webmanifest', '/platform.js?v=' + BUILD].sort());
  const w2 = loadWorker();
  w2.net.answer = url => url.endsWith('/') ? redirect() : basic('x');
  await assert.rejects(w2.fire('install'), /not keepable: \//);
});

test('a new build\'s worker clears older builds\' pages and keeps the data and files', async () => {
  const w = loadWorker();
  for (const n of ['carry-shell-2.53.0-old', 'carry-shell-' + BUILD, 'carry-data', 'carry-files']) w.stores.set(n, new Map());
  await w.fire('activate');
  assert.deepEqual([...w.stores.keys()].sort(), ['carry-data', 'carry-files', 'carry-shell-' + BUILD]);
});

test('opening the app: the network\'s page when there is one, the kept page without signal, the sign-in redirect passed through', async () => {
  const w = loadWorker();
  w.net.answer = () => basic('page v1');
  const nav = w.req('/?x=1', { mode: 'navigate' });
  assert.equal(await (await w.fire('fetch', nav)).text(), 'page v1');
  w.net.answer = () => redirect();
  const r = await w.fire('fetch', nav);
  assert.equal(r.type, 'opaqueredirect', 'signed out: the browser goes to sign in');
  w.net.online = false;
  const off = await w.fire('fetch', w.req('/', { mode: 'navigate' }));
  assert.equal(await off.text(), 'page v1', 'the redirect was never kept');
  assert.match(off.headers.get('x-carry-offline'), /^\d{4}-\d\d-\d\dT/);
});

test('his data: kept as it last loaded, answered from the phone only without signal, never an error or a redirect', async () => {
  const w = loadWorker();
  w.net.answer = () => basic('{"docs":[1]}');
  const live = await w.fire('fetch', w.req('/api/sessions'));
  assert.equal(live.headers.get('x-carry-offline'), null, 'a live answer says nothing');
  w.net.answer = url => url.endsWith('/api/sessions') ? Object.assign(new Response('boom', { status: 500 })) : basic('{}');
  assert.equal((await w.fire('fetch', w.req('/api/sessions'))).status, 500, 'an error goes to the app as an error');
  w.net.answer = () => redirect();
  assert.equal((await w.fire('fetch', w.req('/api/sessions'))).type, 'opaqueredirect');
  w.net.online = false;
  const off = await w.fire('fetch', w.req('/api/sessions'));
  assert.equal(await off.text(), '{"docs":[1]}', 'the last good copy');
  assert.ok(off.headers.get('x-carry-offline'));
  await assert.rejects(w.fire('fetch', w.req('/api/clubs')), TypeError, 'nothing kept: the app sees no signal, as before');
});

test('what is never kept: polls, tee times, the monitor, stored files, writes, the worker itself, other sites', async () => {
  const w = loadWorker();
  w.net.answer = () => basic('x');
  for (const p of ['/api/stamps', '/api/teetimes/c_x?date=2026-11-01', '/api/admin/health', '/api/me', '/_blob/abc', '/sw.js'])
    assert.equal(await w.fire('fetch', w.req(p)), 'not handled', p);
  assert.equal(await w.fire('fetch', w.req('/api/sessions', { method: 'PUT' })), 'not handled');
  assert.equal(await w.fire('fetch', { url: 'https://tile.openstreetmap.org/1/1/1.png', method: 'GET', mode: 'no-cors' }), 'not handled');
});

test('course maps and libraries: kept as last fetched, for Play mode without signal', async () => {
  const w = loadWorker();
  w.net.answer = () => basic('{"v":1}');
  await w.fire('fetch', w.req('/course-maps/bexley.json'));
  w.net.online = false;
  assert.equal(await (await w.fire('fetch', w.req('/course-maps/bexley.json'))).text(), '{"v":1}');
  await assert.rejects(w.fire('fetch', w.req('/course-maps/never-opened.json')), TypeError);
});

let app, app2, stampsOffline = false;
after(async () => { if (app) await app.stop(); if (app2) await app2.stop(); });

test('the server stamps the build into the worker and has it checked on every load', async () => {
  app = await startApp({ seed: { clubs: [], courses: [], sessions: [] } });
  const r = await fetch(app.base + '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  const body = await r.text();
  assert.doesNotMatch(body, /__APP_BUILD__/);
  const build = app.doc.querySelector('meta[name="app-version"]').content;
  assert.ok(body.includes(`const BUILD = '${build}-`), 'the build stamped in');
  assert.match((await (await fetch(app.base + '/')).text()), /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
});

test('the status line says when the app is showing the phone\'s copy, and clears when the server answers', async () => {
  const at = new Date(); at.setHours(7, 42, 0, 0);
  app.win.dispatchEvent(new app.win.CustomEvent('carry:offline', { detail: { at: at.toISOString() } }));
  assert.equal(app.text('#status'), "No signal: showing this phone's copy from 07:42");
  app.win.dispatchEvent(new app.win.CustomEvent('carry:online'));
  assert.equal(app.text('#status'), '');
});

test('the shim notices an answer from the phone\'s copy and tells the app, once, and again when the server answers', async () => {
  app2 = await startApp({ seed: { clubs: [], courses: [], sessions: [] }, pollMs: 50,
    intercept: async url => stampsOffline && url.endsWith('/api/stamps') ? new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'x-carry-offline': '2026-10-31T07:42:00.000Z' } }) : null });
  let offs = 0; app2.win.addEventListener('carry:offline', () => offs++);
  stampsOffline = true;
  await app2.waitFor(() => /^No signal: showing this phone's copy/.test(app2.text('#status')), { what: 'offline note' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(offs, 1, 'said once, not on every poll');
  stampsOffline = false;
  await app2.waitFor(() => app2.text('#status') === '', { what: 'cleared' });
});
