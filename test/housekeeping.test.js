// 1.5.0 housekeeping: the app asks for its token instead of failing with
// "Storage error: unauthorised"; the server logs what changes and fails
// (never a token), and shuts down at once on docker stop; the TrueNAS YAML
// shouts about the three values to replace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, club, sleep } from './harness.js';

test('without the right token the app asks for it, re-asks after a wrong one, and loads once it is right', async () => {
  const app = await startApp({ serverToken: 'right-token', seed: { clubs: [club('7i', 'iron')] } });
  try {
    // Every time the app asks, and which token had been refused, for the failure message.
    app.win.eval(`window.__asks = []; { const ask = askToken; askToken = r => { __asks.push([Math.round(performance.now()), r, localStorage.getItem('carry.token'), askingToken]); return ask(r); }; }`);
    const asks = () => JSON.stringify(app.J('__asks'));
    await app.waitFor(() => app.sheetOpen() && app.field('token'), { what: 'token prompt' });
    assert.equal(app.text('#status'), 'Needs your access token');
    assert.equal(app.E('S.clubs.length'), 0);
    // A wrong token is stored and refused on the next poll, which can come
    // back within milliseconds; so check for a fresh, empty prompt rather
    // than for the sheet having closed in between.
    const first = app.field('token');
    app.fill('token', 'wrong-token');
    app.click('#sheetInner [data-save]');
    await app.waitFor(() => app.win.localStorage.getItem('carry.token') === 'wrong-token', { what: 'wrong token stored' });
    await app.waitFor(() => app.sheetOpen() && app.field('token') && app.field('token') !== first && app.field('token').value === '',
      { what: 'asked again after a wrong token' });
    app.fill('token', 'right-token');
    assert.equal(await app.save(), true, `the right token closes the sheet; asks: ${asks()}`);
    await app.waitFor(() => app.E('S.clubs.length') === 1, { what: 'data loads with the right token' });
    assert.equal(app.win.localStorage.getItem('carry.token'), 'right-token');
    await sleep(400);
    assert.equal(app.sheetOpen(), false, `and it stops asking; asks: ${asks()}`);
    assert.doesNotMatch(app.text('#status'), /unauthorised/);
  } finally { app.stop(); }
});

test('a refusal that comes back for a token already replaced does not ask again', async () => {
  // Four collections load at once; each comes back 401 with the old token.
  // If one is still in flight when the new token is saved, it must not
  // reopen the sheet (on a slow runner it did, within 30ms).
  const app = await startApp({ serverToken: 'right-token', seed: { clubs: [club('7i', 'iron')] } });
  try {
    await app.waitFor(() => app.sheetOpen() && app.field('token'), { what: 'token prompt' });
    app.fill('token', 'right-token');
    assert.equal(await app.save(), true);
    app.E(`askToken('')`);             // the first load, sent with no token
    app.E(`askToken('wrong-token')`);  // or with an earlier wrong one
    assert.equal(app.sheetOpen(), false, 'no second prompt for an old request');
    await app.waitFor(() => app.E('S.clubs.length') === 1, { what: 'data loads' });
    app.E(`askToken('right-token')`);  // but a refusal of the current token is real
    assert.equal(app.sheetOpen(), true);
  } finally { app.stop(); }
});

async function server(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'carry-hk-'));
  const port = 18900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const p = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), API_TOKEN: 'tok', ...env } });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  for (let i = 0; i < 50 && !/listening/.test(out); i++) await sleep(100);
  return { p, base, log: () => out, dir, stop: () => { p.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

test('the server logs changes and failures, not reads, and never a token', async () => {
  const s = await server();
  try {
    const h = { 'x-carry-token': 'tok', 'content-type': 'application/json' };
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

test('the TrueNAS YAML marks the three values to replace and runs an init', () => {
  const y = readFileSync('deploy/truenas-compose.yml', 'utf8');
  assert.match(y, /BEFORE PASTING, REPLACE THE THREE MARKED VALUES/);
  assert.equal((y.match(/# ← REPLACE \(\d\)/g) || []).length, 3);
  assert.match(y, /^\s+init: true$/m);
  assert.match(readFileSync('docker-compose.yml', 'utf8'), /^\s+init: true$/m);
});
