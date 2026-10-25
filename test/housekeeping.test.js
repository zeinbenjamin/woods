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

test('when the Access session runs out, the app asks to sign in again', async () => {
  // Cloudflare answers an expired session with a redirect to its login page
  // (seen as one with redirect: 'manual'), or with a 401 of its own.
  for (const expired of [
    () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } }),
    () => new Response('<html>Forbidden</html>', { status: 401, headers: { 'content-type': 'text/html' } }),
  ]) {
    let out = false;
    const app = await startApp({ seed: { clubs: [club('7i', 'iron')] }, intercept: url => (out && url.includes('/api/') ? expired() : null) });
    try {
      assert.equal(app.E('S.clubs.length'), 1, 'signed in, loaded');
      out = true;
      await app.waitFor(() => app.sheetOpen(), { what: 'sign-in sheet' });
      assert.match(app.text('#sheetInner h2'), /Sign in again/);
      assert.equal(app.text('#sheetInner [data-save]'), 'Sign in again');
      assert.equal(app.text('#status'), 'Signed out');
      assert.equal(app.E('S.clubs.length'), 1, 'what was on screen stays');
    } finally { app.stop(); }
  }
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
