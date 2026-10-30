// Housekeeping: since 2.0.0 the app says how to sign in instead of failing
// with "Storage error: unauthorised" (1.5.0 asked for a token); the server logs what changes and fails
// (never a token), and shuts down at once on docker stop; the TrueNAS YAML
// shouts about the three values to replace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, club, sleep } from './harness.js';
import { accessEnv, header } from './access.js';

test('opened at an address that skips Cloudflare, the app says where to open it, once', async () => {
  const app = await startApp({ signedIn: false, seed: { clubs: [club('7i', 'iron')] } });
  try {
    await app.waitFor(() => app.sheetOpen(), { what: 'sign-in sheet' });
    assert.match(app.text('#sheetInner h2'), /Open Carry through Cloudflare/);
    assert.match(app.text('#sheetInner'), /NAS's own address no longer works/);
    assert.equal(app.text('#sheetInner [data-save]'), 'Try again');
    assert.equal(app.text('#status'), 'Not signed in');
    assert.equal(app.E('S.clubs.length'), 0, 'nothing loads');
    assert.equal(app.field('token'), null, 'no token to paste any more');
    // Dismissed, it stays dismissed: every poll fails the same way.
    app.click('#sheetInner [data-close]');
    await sleep(500);
    assert.equal(app.sheetOpen(), false);
    assert.equal(app.text('#status'), 'Not signed in');
  } finally { app.stop(); }
});

test('when the Access session is refused, the app goes round Cloudflare once at the top level, back to the same screen; never mid-form, never in a loop', async () => {
  // Cloudflare answers an expired session with a redirect to its login page
  // (seen as one with redirect: 'manual'), or with a 401 of its own. A hidden
  // iframe can't renew it on an iPhone (WebKit blocks the login's third-party
  // cookie), so the app does what reopening it does: a top-level trip.
  for (const expired of [
    () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } }),
    () => new Response('<html>Forbidden</html>', { status: 401, headers: { 'content-type': 'text/html' } }),
  ]) {
    let out = false, polls = 0;
    const app = await startApp({ seed: { clubs: [club('7i', 'iron')], sessions: [{ id: 'r1', v: 2, type: 'round', date: '2026-10-20', courseName: 'Loop GC', holes: [] }] }, intercept: url => { if (!out || !url.includes('/api/')) return null; polls++; return expired(); } });
    try {
      app.E('window.carryHop = u => window.__hops.push(u); window.__hops = []');
      const hopped = () => app.J('window.__hops').length;
      app.go('rounds', { sessionId: 'r1' });
      out = true;
      await app.waitFor(() => polls >= 1, { what: 'first refused poll' });
      assert.equal(hopped(), 0, 'one refusal is a glitch: nothing yet');
      await app.waitFor(() => hopped() === 1, { what: 'the trip round Cloudflare' });
      assert.deepEqual(app.J('window.__hops'), ['/'], 'the page itself, top level');
      const saved = app.J(`JSON.parse(sessionStorage.getItem('carry.resume'))`);
      assert.equal(saved.tab, 'rounds'); assert.deepEqual(saved.sub, { sessionId: 'r1' }, 'where he was, kept for the return');
      assert.equal(app.sheetOpen(), false, 'no sheet');
      assert.equal(app.$('#reauth'), null, 'no iframe any more');
      // Still refused (the trip did not take): no second trip inside two minutes, the bar instead.
      await app.waitFor(() => app.$('#signinBar'), { what: 'the bar' });
      assert.equal(hopped(), 1, 'never a loop');
      assert.match(app.text('#signinBar'), /Signed out/);
      assert.equal(app.text('#signinBar [data-act="signInAgain"]'), 'Sign in again');
      // The cookie comes back: the bar goes, quietly.
      out = false;
      await app.waitFor(() => !app.$('#signinBar'), { what: 'bar gone' });
      assert.equal(app.text('#status'), '');
      assert.match(app.toast(), /Signed in again/);
      // Mid-form (a sheet open): no trip, the bar at once; the trip waits until the sheet closes.
      app.E(`sessionStorage.removeItem('carry.rehop')`);
      app.act('newCourse');
      assert.ok(app.sheetOpen());
      out = true; const before = polls;
      await app.waitFor(() => polls >= before + 2 && app.$('#signinBar'), { what: 'bar while typing' });
      assert.equal(hopped(), 1, 'no trip while a sheet is open');
      app.click('#sheetInner [data-close]');
      await app.waitFor(() => hopped() === 2, { what: 'the trip once the sheet is closed' });
    } finally { app.stop(); }
  }
});

test('back from the trip, the app opens on the screen it left, with its folds, once', async () => {
  const app = await startApp({ seed: { clubs: [club('7i', 'iron')], sessions: [{ id: 'r1', v: 2, type: 'round', date: '2026-10-20', courseName: 'Loop GC', holes: [] }] },
    session: { 'carry.resume': JSON.stringify({ tab: 'rounds', sub: { sessionId: 'r1' }, y: 0, open: [], t: Date.now() }) } });
  try {
    await app.waitFor(() => /Loop GC/.test(app.text('#view')), { what: 'the round page' });
    assert.equal(app.E('S.tab'), 'rounds');
    assert.equal(app.J('S.sub').sessionId, 'r1');
    assert.equal(app.E(`sessionStorage.getItem('carry.resume')`), null, 'used once');
  } finally { app.stop(); }
});

test('Bag says who is signed in, offers to sign out, and that courses are shared', async () => {
  const app = await startApp({ user: 'Friend@Example.com' });
  try {
    app.go('settings');
    await app.waitFor(() => /friend@example\.com/.test(app.text('#account')), { what: 'signed-in email' });
    assert.equal(app.$('#account a').getAttribute('href'), '/cdn-cgi/access/logout');
    assert.match(app.text('#account'), /Courses are shared/);
    app.act('newCourse');
    assert.match(app.text('#courseShared'), /everyone who uses this Carry sees this card/);
  } finally { app.stop(); }
});

test('deleting a course a friend has played on is refused, and says why', async () => {
  const course = { id: 'c_s', v: 2, name: 'Shared', tee: 'white', holes: [] };
  const app = await startApp({ seed: { courses: [course] } });
  try {
    await app.api.as('friend@example.com').put('sessions', 'r_f', { id: 'r_f', type: 'round', courseId: 'c_s', date: '2026-10-01' });
    const done = app.act('deleteCourse', { id: 'c_s' });
    await app.answer(true);
    await done;
    await app.waitFor(() => /Delete failed: 1 round by someone else was played on this course/.test(app.toast()), { what: 'the reason' });
    assert.ok(await app.api.get('courses', 'c_s'), 'still there');
  } finally { app.stop(); }
});

async function server(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'carry-hk-'));
  const port = 18900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const p = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ...(await accessEnv()), ...env } });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  for (let i = 0; i < 50 && !/listening/.test(out); i++) await sleep(100);
  return { p, base, log: () => out, dir, stop: () => { p.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

test('the server logs changes and failures, not reads, and never the query string', async () => {
  const s = await server();
  try {
    const h = { ...header('zein@example.com'), 'content-type': 'application/json' };
    await fetch(`${s.base}/api/clubs/7i`, { method: 'PUT', headers: h, body: JSON.stringify({ code: '7i' }) });
    await fetch(`${s.base}/api/clubs`, { headers: h });
    await fetch(`${s.base}/api/clubs/x`, { method: 'PUT', headers: h, body: '{not json' });
    await fetch(`${s.base}/api/courses?token=wrong-secret-value`);
    await sleep(100);
    const lines = s.log().split('\n').filter(l => /\/api\//.test(l));
    assert.ok(lines.some(l => / PUT \/api\/clubs\/7i 200 \d+ms$/.test(l)), 'the write');
    assert.ok(lines.some(l => / PUT \/api\/clubs\/x 400 /.test(l)), 'the bad request');
    assert.ok(lines.some(l => / GET \/api\/courses 401 /.test(l)), 'the refused read');
    assert.ok(!lines.some(l => / GET \/api\/clubs 200/.test(l)), 'not the successful read');
    assert.doesNotMatch(s.log(), /wrong-secret-value/);
  } finally { s.stop(); }
});

test('docker stop (SIGTERM) shuts the server down at once and cleanly', async () => {
  const s = await server();
  try {
    const t0 = Date.now();
    const exited = new Promise(r => s.p.on('exit', (code, signal) => r({ code, signal })));
    s.p.kill('SIGTERM');
    const res = await exited;
    assert.deepEqual(res, { code: 0, signal: null });
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
    assert.match(s.log(), /SIGTERM: shutting down/);
  } finally { s.stop(); }
});

test('the TrueNAS YAML marks the five values to replace and runs an init', () => {
  const y = readFileSync('deploy/truenas-compose.yml', 'utf8');
  assert.match(y, /BEFORE PASTING, REPLACE THE FIVE MARKED VALUES/);
  assert.deepEqual((y.match(/# ← REPLACE \((\d)\)/g) || []).map(m => m.match(/\d/)[0]), ['1', '2', '3', '4', '5']);
  assert.doesNotMatch(y, /API_TOKEN/, 'the 1.x token is gone');
  assert.match(y, /^\s+init: true$/m);
  assert.match(readFileSync('docker-compose.yml', 'utf8'), /^\s+init: true$/m);
});

test('stopping a page with a save in flight never redraws into a closed page', async () => {
  // The harness's own teardown (a CI failure on 2.39.1, ui-courses-sort): a
  // save answering after the page was closed redrew it from the action's own
  // promise, which nothing catches, and the error landed after the test had
  // ended. Hold a save open, stop, then let it answer.
  let release, holding = false, held = false;
  const gate = new Promise(r => { release = r; });
  const app = await startApp({ seed: { clubs: [club('7i', 'iron')], settings: { theme: 'system' } }, intercept: async (url, o) => {
    if (!holding || held || !/\/api\/settings\//.test(url) || !o || o.method !== 'PUT') return null;
    held = true; await gate;
    return new Response(o.body, { headers: { 'content-type': 'application/json' } });
  } });
  await app.waitFor(() => app.E('!!S.settings'), { what: 'settings loaded' });
  holding = true;
  app.E(`ACTIONS.setTheme({ v: 'dark' })`);   // not awaited, as a tap isn't
  await app.waitFor(() => held, { what: 'a save held open' });
  const errors = [];
  const onErr = e => errors.push(String(e && e.message || e));
  process.on('unhandledRejection', onErr); process.on('uncaughtException', onErr);
  try {
    const stopping = app.stop();
    release();
    await stopping;
    await sleep(300);
    assert.deepEqual(errors, [], 'nothing thrown after the page was stopped');
  } finally { process.off('unhandledRejection', onErr); process.off('uncaughtException', onErr); }
});
