// End-to-end against a real server process: sign-in, documents (whose they
// are), assets, blobs, the 1.x migration, and the import script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { accessEnv, sign, header, forgedKey, ME } from './access.js';

const DATA = mkdtempSync(join(tmpdir(), 'carry-test-'));
const PORT = 8123;
const base = `http://127.0.0.1:${PORT}`;
const FRIEND = 'friend@example.com';
const hdr = (who = ME) => ({ ...header(who), 'content-type': 'application/json' });
let proc;

async function boot(env, port) {
  const p = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: '', ...env } });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${url}/healthz`)).ok) return { p, url, out: () => out }; } catch {}
    if (p.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  p.kill();
  throw new Error('server did not start:\n' + out);
}

before(async () => { proc = (await boot({ DATA_DIR: DATA, ...(await accessEnv()) }, PORT)).p; });
after(() => { proc.kill(); rmSync(DATA, { recursive: true, force: true }); });

/* ---------- sign-in ---------- */

test('without a valid Access token nothing is served, whatever else the request claims', async () => {
  const get = headers => fetch(`${base}/api/courses`, { headers }).then(r => r.status);
  assert.equal(await get({}), 401, 'no token: straight to the NAS');
  // The email header Cloudflare also adds is just a header: anyone reaching the port can send it.
  assert.equal(await get({ 'cf-access-authenticated-user-email': ME }), 401);
  const bad = {
    'signed with a key Cloudflare never published': sign(ME, { key: forgedKey }),
    'for another Access application': sign(ME, { aud: 'someone-elses-app' }),
    'from another team': sign(ME, { iss: 'https://evil.cloudflareaccess.com' }),
    'expired': sign(ME, { exp: Math.floor(Date.now() / 1000) - 3600 }),
    'with an unknown key id': sign(ME, { kid: 'nope' }),
    'with no email (a service token)': sign('', {}),
    'not a JWT': 'hello',
  };
  for (const [why, t] of Object.entries(bad)) assert.equal(await get({ 'cf-access-jwt-assertion': t }), 401, why);
  // alg "none" with the signature stripped
  const [, body] = sign(ME).split('.');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(await get({ 'cf-access-jwt-assertion': `${none}.${body}.` }), 401, 'alg none');
  const r = await fetch(`${base}/api/courses`, { headers: { 'cf-access-jwt-assertion': sign(ME, { aud: 'x' }) } });
  assert.deepEqual(await r.json(), { error: 'unauthorised', reason: 'token is for another application' }, 'says why');
});

test('a valid token, in the header or the CF_Authorization cookie, signs in as its email', async () => {
  const me = await (await fetch(`${base}/api/me`, { headers: header('Zein@Example.com') })).json();
  assert.deepEqual(me, { email: ME }, 'lower-cased');
  const viaCookie = await fetch(`${base}/api/me`, { headers: { cookie: `other=1; CF_Authorization=${sign(FRIEND)}` } });
  assert.deepEqual(await viaCookie.json(), { email: FRIEND });
  // A minute of clock difference is tolerated.
  assert.equal((await fetch(`${base}/api/me`, { headers: { 'cf-access-jwt-assertion': sign(ME, { exp: Math.floor(Date.now() / 1000) - 30 }) } })).status, 200);
});

test('with sign-in not configured (or the YAML pasted as-is), data is refused and the log says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-open-'));
  const s = await boot({ DATA_DIR: dir, CF_ACCESS_TEAM: 'REPLACE_ME.cloudflareaccess.com', CF_ACCESS_AUD: 'REPLACE_WITH_the_AUD_tag', DEV_USER: '' }, PORT + 60);
  try {
    for (let i = 0; i < 50 && !/sign-in is not configured/.test(s.out()); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(s.out(), /sign-in is not configured/);
    const r = await fetch(`${s.url}/api/courses`, { headers: hdr() });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'auth_not_configured');
    assert.equal((await fetch(`${s.url}/api/version`)).status, 200, 'the version still answers');
  } finally { s.p.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('when Cloudflare\'s keys can\'t be fetched, nobody gets in and the reason is logged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-nokeys-'));
  const s = await boot({ DATA_DIR: dir, ...(await accessEnv()), CF_ACCESS_CERTS_URL: 'http://127.0.0.1:9/cdn-cgi/access/certs' }, PORT + 66);
  try {
    const r = await fetch(`${s.url}/api/courses`, { headers: hdr() });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'auth_unavailable');
    assert.match(s.out(), /Access keys: /);
  } finally { s.p.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('DEV_USER signs every request in as that email, and says so at startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-dev-'));
  const s = await boot({ DATA_DIR: dir, CF_ACCESS_TEAM: '', CF_ACCESS_AUD: '', DEV_USER: 'dev@example.com' }, PORT + 61);
  try {
    assert.deepEqual(await (await fetch(`${s.url}/api/me`)).json(), { email: 'dev@example.com' });
    for (let i = 0; i < 50 && !/DEV_USER is set/.test(s.out()); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(s.out(), /DEV_USER is set/);
  } finally { s.p.kill(); rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- documents ---------- */

test('stores and reads a document', async () => {
  const course = { id: 'c_test', name: 'Test GC', v: 2, tee: 'white', holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 } }] };
  const put = await fetch(`${base}/api/courses/c_test`, { method: 'PUT', headers: hdr(), body: JSON.stringify(course) });
  assert.equal(put.status, 200);
  const list = await (await fetch(`${base}/api/courses`, { headers: hdr() })).json();
  assert.equal(list.docs.length, 1);
  assert.equal(list.docs[0].holes[0].tees.white, 300);
});

test('unknown collections are refused', async () => {
  const r = await fetch(`${base}/api/secrets/x`, { method: 'PUT', headers: hdr(), body: '{}' });
  assert.equal(r.status, 404);
});

test('clubs, sessions and settings are each person\'s own; courses are everyone\'s', async () => {
  const put = (who, col, id, doc) => fetch(`${base}/api/${col}/${id}`, { method: 'PUT', headers: hdr(who), body: JSON.stringify(doc) });
  const list = async (who, col) => (await (await fetch(`${base}/api/${col}`, { headers: hdr(who) })).json()).docs;
  await put(ME, 'clubs', '7i', { code: '7i', name: 'Mine', nominalCarry: 120 });
  await put(FRIEND, 'clubs', '7i', { code: '7i', name: 'Theirs', nominalCarry: 140 });   // same id, separate club
  await put(ME, 'settings', 'app', { id: 'app', home: { label: 'Mine' } });
  await put(FRIEND, 'sessions', 's_friend', { id: 's_friend', type: 'range', date: '2026-10-01' });
  assert.deepEqual((await list(ME, 'clubs')).map(c => c.name), ['Mine']);
  assert.deepEqual((await list(FRIEND, 'clubs')).map(c => c.name), ['Theirs']);
  assert.equal((await list(ME, 'sessions')).some(s => s.id === 's_friend'), false, 'a friend\'s session never reaches me');
  assert.deepEqual(await list(FRIEND, 'settings'), [], 'nor my settings them');
  assert.equal((await fetch(`${base}/api/sessions/s_friend`, { headers: hdr(ME) })).status, 404, 'not even by id');
  // Deleting goes no further than your own.
  await fetch(`${base}/api/clubs/7i`, { method: 'DELETE', headers: hdr(FRIEND) });
  assert.deepEqual((await list(ME, 'clubs')).map(c => c.name), ['Mine']);
  // Courses: one Randwick for everyone; an edit by anyone is seen by all.
  await put(FRIEND, 'courses', 'c_shared', { id: 'c_shared', name: 'Shared GC', holes: [] });
  assert.ok((await list(ME, 'courses')).some(c => c.id === 'c_shared'));
  await put(ME, 'courses', 'c_shared', { id: 'c_shared', name: 'Shared GC (fixed)', holes: [] });
  assert.equal((await list(FRIEND, 'courses')).find(c => c.id === 'c_shared').name, 'Shared GC (fixed)');
  const db = new Database(join(DATA, 'carry.db'), { readonly: true });
  try {
    const row = db.prepare("SELECT owner, updated_by FROM docs WHERE collection = 'courses' AND id = 'c_shared'").get();
    assert.deepEqual(row, { owner: '', updated_by: ME }, 'stored shared, with who changed it last');
  } finally { db.close(); }
});

test('stamps are per person: a friend\'s write doesn\'t make my app refetch', async () => {
  const st = async who => (await fetch(`${base}/api/stamps`, { headers: hdr(who) })).json();
  const a = await st(ME);
  await fetch(`${base}/api/clubs/PW`, { method: 'PUT', headers: hdr(FRIEND), body: JSON.stringify({ code: 'PW' }) });
  assert.deepEqual(await st(ME), a);
  await fetch(`${base}/api/clubs/PW`, { method: 'PUT', headers: hdr(ME), body: JSON.stringify({ code: 'PW' }) });
  const b = await st(ME);
  assert.notEqual(a.clubs, b.clubs);
  assert.equal(a.courses, b.courses);
});

test('a course someone else has played on can\'t be deleted from under them', async () => {
  const put = (who, col, id, doc) => fetch(`${base}/api/${col}/${id}`, { method: 'PUT', headers: hdr(who), body: JSON.stringify(doc) });
  await put(ME, 'courses', 'c_played', { id: 'c_played', name: 'Played GC', holes: [] });
  await put(ME, 'sessions', 'r_mine', { id: 'r_mine', type: 'round', courseId: 'c_played', date: '2026-10-02' });
  await put(FRIEND, 'sessions', 'r_theirs', { id: 'r_theirs', type: 'round', courseId: 'c_played', date: '2026-10-03' });
  const r = await fetch(`${base}/api/courses/c_played`, { method: 'DELETE', headers: hdr(ME) });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'in_use', message: '1 round by someone else was played on this course' });
  // Once only my own rounds point at it, it's mine to delete (they keep their own copy of the card).
  await fetch(`${base}/api/sessions/r_theirs`, { method: 'DELETE', headers: hdr(FRIEND) });
  const ok = await fetch(`${base}/api/courses/c_played`, { method: 'DELETE', headers: hdr(ME) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).deleted, true);
});

test('deletes a document', async () => {
  await fetch(`${base}/api/sessions/s_x`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ id: 's_x', type: 'range', date: '2026-01-01' }) });
  const del = await (await fetch(`${base}/api/sessions/s_x`, { method: 'DELETE', headers: hdr() })).json();
  assert.equal(del.deleted, true);
  const list = await (await fetch(`${base}/api/sessions`, { headers: hdr() })).json();
  assert.equal(list.docs.some(s => s.id === 's_x'), false);
});

test('GPS marks on a shared course survive any phone\'s copy: others\' always stay, only yours are yours to change', async () => {
  const put = (who, doc) => fetch(`${base}/api/courses/c_marks`, { method: 'PUT', headers: hdr(who), body: JSON.stringify(doc) });
  const get = async who => (await fetch(`${base}/api/courses/c_marks`, { headers: hdr(who) })).json();
  const card = (marks = []) => ({ id: 'c_marks', name: 'Barnwell Park', holes: [{ n: 1, par: 4, metres: 300, ...(marks.length ? { marks } : {}) }, { n: 2, par: 3, metres: 140 }] });
  const mark = (k, at, extra = {}) => ({ k, lat: -33.874, lng: 151.12, acc: 5, at, ...extra });
  await put(ME, card());
  const blank = await get(FRIEND);                                  // a friend's phone loads the course now
  // Mine, sent without a "by" (or claiming to be someone else): stored as mine, raw, the tee in lower case.
  assert.equal((await put(ME, card([mark('tee', '2026-10-19T00:00:00.000Z', { by: 'someone@else.com', tee: 'White', extra: 1 })]))).status, 200);
  let marks = (await get(ME)).holes[0].marks;
  assert.equal(marks, undefined, 'a new mark claiming someone else is never stored (and no empty list is added)');
  await put(ME, card([mark('tee', '2026-10-19T00:00:00.000Z', { tee: 'White', extra: 1 })]));
  marks = (await get(ME)).holes[0].marks;
  assert.deepEqual(marks, [{ k: 'tee', lat: -33.874, lng: 151.12, acc: 5, at: '2026-10-19T00:00:00.000Z', by: ME, tee: 'white' }], 'only the mark\'s own fields');
  // The friend saves their old copy (no marks), with a flag of their own: mine stays, theirs is added.
  await put(FRIEND, { ...blank, holes: [{ ...blank.holes[0], marks: [mark('flag', '2026-10-19T01:00:00.000Z')] }, blank.holes[1]] });
  marks = (await get(ME)).holes[0].marks;
  assert.deepEqual(marks.map(m => [m.k, m.by]), [['tee', ME], ['flag', FRIEND]]);
  // I can't remove the friend's by leaving it out; I can remove mine.
  await put(ME, card([]));
  assert.deepEqual((await get(ME)).holes[0].marks.map(m => [m.k, m.by]), [['flag', FRIEND]]);
  // The friend's copy still has my old tee mark: it isn't brought back.
  await put(FRIEND, { ...blank, holes: [{ ...blank.holes[0], marks: [{ ...mark('tee', '2026-10-19T00:00:00.000Z', { tee: 'white' }), by: ME }, { ...mark('flag', '2026-10-19T01:00:00.000Z'), by: FRIEND }] }, blank.holes[1]] });
  assert.deepEqual((await get(ME)).holes[0].marks.map(m => [m.k, m.by]), [['flag', FRIEND]], 'removed stays removed');
  // A rough or broken fix is refused, and the course is left as it was.
  for (const [bad, why] of [[{ acc: 18 }, /GPS ±18 m is too rough for a mark \(10 m or better\)/], [{ k: 'pin' }, /a tee or a flag/], [{ lat: null }, /latitude and longitude/], [{ at: 'yesterday' }, /the time it was taken/], [{ acc: undefined }, /GPS accuracy/]]) {
    const r = await put(ME, card([{ ...mark('flag', '2026-10-19T02:00:00.000Z'), ...bad }]));
    assert.equal(r.status, 400, JSON.stringify(bad));
    const body = await r.json();
    assert.equal(body.error, 'bad_mark');
    assert.match(body.message, why);
    assert.match(body.message, /^Hole 1: /);
  }
  assert.deepEqual((await get(ME)).holes[0].marks.map(m => m.by), [FRIEND], 'unchanged by the refusals');
});

/* ---------- assets ---------- */

const upload = (bytes, type, who = ME) =>
  fetch(`${base}/api/assets`, { method: 'POST', headers: { ...header(who), 'content-type': type }, body: bytes }).then(r => r.json());

test('round-trips an asset; the blob needs sign-in but any signed-in person can read it', async () => {
  const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
  const up = await upload(bytes, 'image/webp');
  assert.match(up.id, /^[0-9a-f]{32}$/);
  assert.equal(up.url, `/_blob/${up.id}`);
  assert.equal((await fetch(`${base}${up.url}`)).status, 401, 'not without signing in');
  const blob = await fetch(`${base}${up.url}`, { headers: { cookie: `CF_Authorization=${sign(ME)}` } });   // what an <img src> sends
  assert.equal(blob.status, 200);
  assert.equal(blob.headers.get('content-type'), 'image/webp');
  assert.match(blob.headers.get('cache-control'), /^private/, 'never kept by a shared cache');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}${up.url}`, { headers: header(FRIEND) })).status, 200, 'course artwork is shared');
});

test('deletes an asset: only its uploader, the record and the file on disk', async () => {
  // Regression: DELETE /api/:collection/:id used to be registered first and
  // answered this with 404 "unknown collection", leaving the file behind.
  const up = await upload(Buffer.from('png-ish'), 'image/png');
  assert.ok(existsSync(join(DATA, 'assets', `${up.id}.png`)));
  const theirs = await fetch(`${base}/api/assets/${up.id}`, { method: 'DELETE', headers: hdr(FRIEND) });
  assert.equal(theirs.status, 403);
  assert.ok(existsSync(join(DATA, 'assets', `${up.id}.png`)), 'still there');
  const del = await fetch(`${base}/api/assets/${up.id}`, { method: 'DELETE', headers: hdr() });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, true);
  assert.equal((await fetch(`${base}/_blob/${up.id}`, { headers: header(ME) })).status, 404);
  assert.equal(existsSync(join(DATA, 'assets', `${up.id}.png`)), false, 'file removed from disk');
});

test('stored files stream with byte ranges, so a phone can play a swing video', async () => {
  const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const up = await upload(bytes, 'video/mp4');
  const full = await fetch(`${base}/_blob/${up.id}`, { headers: header(ME) });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  const part = await fetch(`${base}/_blob/${up.id}`, { headers: { ...header(ME), Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/5000');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));
});

test('stored files can never run as a page: only photos and video are served inline, and nothing is sniffed', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const up = await upload(svg, 'image/svg+xml');
  const r = await fetch(`${base}/_blob/${up.id}`, { headers: header(ME) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition'), /^attachment/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  const png = await upload(Buffer.from('png'), 'image/png');
  const p = await fetch(`${base}/_blob/${png.id}`, { headers: header(ME) });
  assert.equal(p.headers.get('content-type'), 'image/png');
  assert.equal(p.headers.get('content-disposition'), null, 'photos stay inline');
  assert.equal(p.headers.get('x-content-type-options'), 'nosniff');
});

/* ---------- the rest ---------- */

test('analysis reports a missing key rather than failing silently', async () => {
  const r = await fetch(`${base}/api/analyse`, { method: 'POST', headers: hdr(), body: JSON.stringify({ prompt: 'hello' }) });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'unconfigured');
});

test('/api/version answers without signing in: the package version, the build, and the changelog', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const r = await fetch(`${base}/api/version`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const v = await r.json();
  assert.equal(v.version, pkg.version);
  assert.equal(v.commit, 'dev', 'no APP_COMMIT outside an image build');
  assert.equal(v.changelog[0].version, pkg.version, 'the top changelog entry is this version');
  assert.match(v.changelog[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(v.changelog[0].notes.length > 0);
  const h = await (await fetch(`${base}/healthz`)).json();
  assert.deepEqual(h, { ok: true, version: pkg.version, commit: 'dev' }, 'health says nothing about the data');
  assert.equal((await fetch(`${base}/api/courses`)).status, 401, 'the rest of /api still needs sign-in');
});

test('the page is served with its version stamped in and is revalidated on every load', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const path of ['/', '/index.html']) {
    const r = await fetch(`${base}${path}`);
    const html = await r.text();
    assert.equal(r.headers.get('cache-control'), 'no-cache', `${path} revalidates`);
    assert.doesNotMatch(html, /__APP_/, `${path}: no placeholders left`);
    assert.ok(html.includes(`<meta name="app-version" content="${pkg.version}">`));
    assert.ok(html.includes('<meta name="app-commit" content="dev">'));
  }
  assert.equal((await fetch(`${base}/index`)).status, 404, 'no unstamped copy by another name');
  assert.equal((await fetch(`${base}/platform.js`)).headers.get('cache-control'), 'no-cache', 'the shim never lags the page');
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).headers.get('cache-control'), 'no-cache');
  assert.match((await fetch(`${base}/icon.svg`)).headers.get('cache-control'), /max-age=3600/);
});

test('analysis sends images then prompt upstream, and caps the output length it asks for', async () => {
  // A fake Anthropic API, and a second Carry server pointed at it.
  const { createServer } = await import('node:http');
  const seen = [];
  const fake = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      seen.push({ key: req.headers['x-api-key'], body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'carry-up-'));
  const s = await boot({ DATA_DIR: dir, ...(await accessEnv()), APP_COMMIT: '0123456789abcdef', ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}`, CARRY_MODEL: 'test-model' }, PORT + 50);
  try {
    const post = body => fetch(`${s.url}/api/analyse`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) }).then(r => r.json());
    assert.equal((await (await fetch(`${s.url}/api/version`)).json()).commit, '0123456', 'APP_COMMIT, shortened');
    assert.ok((await (await fetch(`${s.url}/`)).text()).includes('<meta name="app-commit" content="0123456">'));
    const out = await post({ prompt: 'read this', images: [{ mediaType: 'image/png', data: 'AAAA' }] });
    assert.deepEqual(out.json, { ok: true }, 'fenced JSON reply parsed');
    await post({ prompt: 'x', maxTokens: 10 ** 9 });
    await post({ prompt: 'x', maxTokens: 12000 });
    await post({ prompt: 'x', maxTokens: 3 });
    assert.deepEqual(seen.map(x => x.body.max_tokens), [2000, 16000, 12000, 256]);
    assert.equal(seen[0].key, 'sk-test');
    assert.equal(seen[0].body.model, 'test-model');
    assert.deepEqual(seen[0].body.messages[0].content.map(c => c.type), ['image', 'text'], 'images before the prompt');
    assert.equal(seen[0].body.messages[0].content[0].source.media_type, 'image/png');
  } finally { s.p.kill(); fake.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('serves the app itself', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes('platform.js'), 'shim is loaded');
  assert.ok(html.includes("claude.use('db')") || html.includes('claude.use("db")'), 'app still asks for the db capability');
});

/* ---------- from 1.x ---------- */

// A database exactly as Carry 1.x left it: no owners anywhere.
function oneX(dir) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const d = new Database(join(dir, 'carry.db'));
  d.exec(`CREATE TABLE docs (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id));
    CREATE INDEX docs_collection ON docs(collection);
    CREATE TABLE assets (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);`);
  const put = d.prepare('INSERT INTO docs VALUES (?, ?, ?, ?)');
  put.run('clubs', '7i', JSON.stringify({ code: '7i', nominalCarry: 120 }), '2026-09-01T00:00:00.000Z');
  put.run('courses', 'c_randwick', JSON.stringify({ name: 'Randwick', holes: [] }), '2026-09-01T00:00:00.000Z');
  put.run('sessions', 'r_1', JSON.stringify({ type: 'round', courseId: 'c_randwick', date: '2026-09-02' }), '2026-09-02T00:00:00.000Z');
  put.run('settings', 'app', JSON.stringify({ home: { label: 'Home' } }), '2026-09-01T00:00:00.000Z');
  d.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run('a'.repeat(32), 'image/png', 3, '2026-09-01T00:00:00.000Z');
  writeFileSync(join(dir, 'assets', 'a'.repeat(32) + '.png'), 'png');
  d.close();
}

test('a 1.x database won\'t start without OWNER_EMAIL, and is left untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-1x-'));
  try {
    oneX(dir);
    for (const OWNER_EMAIL of ['', 'REPLACE_WITH_you@example.com', 'zein']) {
      const r = spawnSync('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT + 62), OWNER_EMAIL, ...(await accessEnv()) }, encoding: 'utf8', timeout: 10000 });
      assert.notEqual(r.status, 0, `refuses to start with OWNER_EMAIL "${OWNER_EMAIL}"`);
      assert.match(r.stderr, /Set OWNER_EMAIL/);
      assert.match(r.stderr, /3 personal records and 1 files/);
    }
    const d = new Database(join(dir, 'carry.db'), { readonly: true });
    try { assert.deepEqual(d.prepare('PRAGMA table_info(docs)').all().map(c => c.name), ['collection', 'id', 'body', 'updated_at'], 'unchanged'); }
    finally { d.close(); }
    assert.equal(existsSync(join(dir, 'carry-before-2.0.0.db')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a 1.x database becomes the owner\'s, with courses shared and a copy of the old one kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-1x-'));
  oneX(dir);
  const s = await boot({ DATA_DIR: dir, OWNER_EMAIL: ' Zein@Example.com ', ...(await accessEnv()) }, PORT + 63);
  try {
    const list = async (who, col) => (await (await fetch(`${s.url}/api/${col}`, { headers: hdr(who) })).json()).docs;
    assert.deepEqual((await list(ME, 'clubs')).map(c => [c.code, c.nominalCarry]), [['7i', 120]]);
    assert.equal((await list(ME, 'sessions'))[0].id, 'r_1');
    assert.equal((await list(ME, 'settings'))[0].home.label, 'Home');
    assert.deepEqual(await list(FRIEND, 'clubs'), [], 'a friend starts with nothing of his');
    assert.deepEqual(await list(FRIEND, 'sessions'), []);
    assert.deepEqual((await list(FRIEND, 'courses')).map(c => c.name), ['Randwick'], 'but sees the courses');
    const del = await fetch(`${s.url}/api/assets/${'a'.repeat(32)}`, { method: 'DELETE', headers: hdr(FRIEND) });
    assert.equal(del.status, 403, 'his old files are his');
    assert.match(s.out(), /Converted the database to Carry 2: 3 personal records now belong to zein@example.com/);
    // The copy is the 1.x database as it was.
    const old = new Database(join(dir, 'carry-before-2.0.0.db'), { readonly: true });
    try {
      assert.deepEqual(old.prepare('PRAGMA table_info(docs)').all().map(c => c.name), ['collection', 'id', 'body', 'updated_at']);
      assert.equal(old.prepare('SELECT COUNT(*) AS n FROM docs').get().n, 4);
    } finally { old.close(); }
  } finally { s.p.kill(); }
  // A restart is a no-op: already converted.
  const again = await boot({ DATA_DIR: dir, OWNER_EMAIL: '', ...(await accessEnv()) }, PORT + 64);
  try {
    assert.deepEqual((await (await fetch(`${again.url}/api/clubs`, { headers: hdr(ME) })).json()).docs.map(c => c.code), ['7i']);
    assert.doesNotMatch(again.out(), /Converted/);
  } finally { again.p.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('an empty 1.x database converts without needing an owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-1x-'));
  const d = new Database(join(dir, 'carry.db'));
  d.exec('CREATE TABLE docs (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id))');
  d.prepare('INSERT INTO docs VALUES (?, ?, ?, ?)').run('courses', 'c_x', '{"name":"X","holes":[]}', '2026-09-01T00:00:00.000Z');
  d.close();
  const s = await boot({ DATA_DIR: dir, OWNER_EMAIL: '', ...(await accessEnv()) }, PORT + 65);
  try { assert.deepEqual((await (await fetch(`${s.url}/api/courses`, { headers: hdr(FRIEND) })).json()).docs.map(c => c.id), ['c_x']); }
  finally { s.p.kill(); rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- import ---------- */

test('imports a Carry export for its owner, assets and all', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const exp = {
    format: 'carry-export', version: 2, exportedAt: new Date().toISOString(),
    clubs: [{ code: 'LW', name: 'Lob Wedge', category: 'wedge' }],
    courses: [{ id: 'c_imported', name: 'Imported GC', v: 2, tee: 'white',
      holes: [{ n: 1, par: 3, metres: 150, tees: { white: 150 }, art: { asset: 'aaaabbbbccccddddeeeeffff00001111', w: 540, h: 900 } }] }],
    sessions: [{ id: 'r_imported', type: 'round', date: '2026-09-14', courseId: 'c_imported', holes: [{ n: 1, par: 3, strokes: 4 }] }],
    settings: { home: { label: 'Home', lat: -33.89, lng: 151.19 } },
    assets: { aaaabbbbccccddddeeeeffff00001111: `data:image/png;base64,${png.toString('base64')}` },
  };
  const file = join(DATA, 'export.json');
  writeFileSync(file, JSON.stringify(exp));
  const env = { ...process.env, DATA_DIR: DATA };
  const without = spawnSync('node', ['scripts/import-export.js', file], { env, encoding: 'utf8' });
  assert.notEqual(without.status, 0, 'needs to know whose it is');
  assert.match(without.stderr, /--owner <email>/);
  const out = execFileSync('node', ['scripts/import-export.js', file, '--owner', FRIEND], { env, encoding: 'utf8' });
  assert.match(out, /Imported: 1 clubs, 1 courses, 1 sessions, 1 settings, 1 assets/);

  // the running server sees it, as the owner's, and the preserved asset id still resolves
  const clubs = async who => (await (await fetch(`${base}/api/clubs`, { headers: hdr(who) })).json()).docs.map(c => c.code);
  assert.ok((await clubs(FRIEND)).includes('LW'));
  assert.equal((await clubs(ME)).includes('LW'), false, 'not mine');
  const courses = await (await fetch(`${base}/api/courses`, { headers: hdr(ME) })).json();
  const imported = courses.docs.find(c => c.id === 'c_imported');
  assert.ok(imported, 'imported course is shared');
  // Importing an older export again keeps a mark made since (and the export's own).
  const withMark = { ...imported, holes: imported.holes.map(h => ({ ...h, marks: [{ k: 'flag', lat: -33.9, lng: 151.2, acc: 4, at: '2026-10-19T03:00:00.000Z' }] })) };
  await fetch(`${base}/api/courses/c_imported`, { method: 'PUT', headers: hdr(ME), body: JSON.stringify(withMark) });
  writeFileSync(file, JSON.stringify({ ...exp, courses: [{ ...exp.courses[0], holes: exp.courses[0].holes.map(h => ({ ...h, marks: [{ k: 'tee', lat: -33.9, lng: 151.2, acc: 3, at: '2026-09-14T00:00:00.000Z', by: FRIEND }] })) }] }));
  execFileSync('node', ['scripts/import-export.js', file, '--owner', FRIEND], { env, encoding: 'utf8' });
  const again = await (await fetch(`${base}/api/courses/c_imported`, { headers: hdr(ME) })).json();
  assert.deepEqual(again.holes[0].marks.map(m => [m.k, m.by]), [['flag', ME], ['tee', FRIEND]], 'both kept');
  const blob = await fetch(`${base}/_blob/${imported.holes[0].art.asset}`, { headers: header(ME) });
  assert.equal(blob.status, 200, 'artwork reference resolves without rewriting ids');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
});

