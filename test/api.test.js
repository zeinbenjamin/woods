// End-to-end against a real server process: documents, assets, blobs,
// auth, and the import script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'carry-test-'));
const TOKEN = 'test-token-123';
const PORT = 8123;
const base = `http://127.0.0.1:${PORT}`;
const hdr = { 'x-carry-token': TOKEN, 'content-type': 'application/json' };
let proc;

before(async () => {
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), API_TOKEN: TOKEN }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${base}/healthz`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); rmSync(DATA, { recursive: true, force: true }); });

test('rejects calls without the token', async () => {
  const r = await fetch(`${base}/api/courses`);
  assert.equal(r.status, 401);
});

test('stores and reads a document', async () => {
  const course = { id: 'c_test', name: 'Test GC', v: 2, tee: 'white', holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 } }] };
  const put = await fetch(`${base}/api/courses/c_test`, { method: 'PUT', headers: hdr, body: JSON.stringify(course) });
  assert.equal(put.status, 200);
  const list = await (await fetch(`${base}/api/courses`, { headers: hdr })).json();
  assert.equal(list.docs.length, 1);
  assert.equal(list.docs[0].holes[0].tees.white, 300);
});

test('unknown collections are refused', async () => {
  const r = await fetch(`${base}/api/secrets/x`, { method: 'PUT', headers: hdr, body: '{}' });
  assert.equal(r.status, 404);
});

test('round-trips an asset and serves the blob unauthenticated', async () => {
  const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
  const up = await (await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'x-carry-token': TOKEN, 'content-type': 'image/webp' }, body: bytes })).json();
  assert.match(up.id, /^[0-9a-f]{32}$/);
  assert.equal(up.url, `/_blob/${up.id}`);
  const blob = await fetch(`${base}${up.url}`);            // no token: <img src> must work
  assert.equal(blob.status, 200);
  assert.equal(blob.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
});

test('deletes an asset: the record and the file on disk', async () => {
  // Regression: DELETE /api/:collection/:id used to be registered first and
  // answered this with 404 "unknown collection", leaving the file behind.
  const up = await (await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'x-carry-token': TOKEN, 'content-type': 'image/png' }, body: Buffer.from('png-ish') })).json();
  assert.ok(existsSync(join(DATA, 'assets', `${up.id}.png`)));
  const del = await fetch(`${base}/api/assets/${up.id}`, { method: 'DELETE', headers: hdr });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, true);
  assert.equal((await fetch(`${base}/_blob/${up.id}`)).status, 404);
  assert.equal(existsSync(join(DATA, 'assets', `${up.id}.png`)), false, 'file removed from disk');
});

test('deletes a document', async () => {
  await fetch(`${base}/api/sessions/s_x`, { method: 'PUT', headers: hdr, body: JSON.stringify({ id: 's_x', type: 'range', date: '2026-01-01' }) });
  const del = await (await fetch(`${base}/api/sessions/s_x`, { method: 'DELETE', headers: hdr })).json();
  assert.equal(del.deleted, true);
  const list = await (await fetch(`${base}/api/sessions`, { headers: hdr })).json();
  assert.equal(list.docs.length, 0);
});

test('stamps move only when a collection changes', async () => {
  const a = await (await fetch(`${base}/api/stamps`, { headers: hdr })).json();
  await fetch(`${base}/api/clubs/7i`, { method: 'PUT', headers: hdr, body: JSON.stringify({ code: '7i', name: '7 Iron', category: 'iron' }) });
  const b = await (await fetch(`${base}/api/stamps`, { headers: hdr })).json();
  assert.notEqual(a.clubs, b.clubs);
  assert.equal(a.courses, b.courses);
});

test('analysis reports a missing key rather than failing silently', async () => {
  const r = await fetch(`${base}/api/analyse`, { method: 'POST', headers: hdr, body: JSON.stringify({ prompt: 'hello' }) });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'unconfigured');
});

test('reports its version, unauthenticated, at /version and in /healthz', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const v = await (await fetch(`${base}/version`)).json();       // no token
  assert.equal(v.version, pkg.version);
  assert.ok(v.commit === null || /^[0-9a-f]{7}$/.test(v.commit), `commit ${v.commit}`);
  const h = await (await fetch(`${base}/healthz`)).json();
  assert.equal(h.version, pkg.version);
  assert.equal(h.ok, true);
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
  const port = PORT + 50, url = `http://127.0.0.1:${port}`;
  const p = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), API_TOKEN: '',
    ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}`, CARRY_MODEL: 'test-model' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const post = body => fetch(`${url}/api/analyse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
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
  } finally { p.kill(); fake.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('serves the app itself', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes('platform.js'), 'shim is loaded');
  assert.ok(html.includes("claude.use('db')") || html.includes('claude.use("db")'), 'app still asks for the db capability');
});

test('imports a Carry export, assets and all', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const exp = {
    format: 'carry-export', version: 2, exportedAt: new Date().toISOString(),
    clubs: [{ code: 'PW', name: 'Pitching Wedge', category: 'wedge' }],
    courses: [{ id: 'c_imported', name: 'Imported GC', v: 2, tee: 'white',
      holes: [{ n: 1, par: 3, metres: 150, tees: { white: 150 }, art: { asset: 'aaaabbbbccccddddeeeeffff00001111', w: 540, h: 900 } }] }],
    sessions: [{ id: 'r_imported', type: 'round', date: '2026-09-14', courseId: 'c_imported', holes: [{ n: 1, par: 3, strokes: 4 }] }],
    settings: { home: { label: 'Home', lat: -33.89, lng: 151.19 } },
    assets: { aaaabbbbccccddddeeeeffff00001111: `data:image/png;base64,${png.toString('base64')}` },
  };
  const file = join(DATA, 'export.json');
  writeFileSync(file, JSON.stringify(exp));
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', ['scripts/import-export.js', file], { env: { ...process.env, DATA_DIR: DATA }, encoding: 'utf8' });
  assert.match(out, /Imported: 1 clubs, 1 courses, 1 sessions/);

  // the running server sees it, and the preserved asset id still resolves
  const courses = await (await fetch(`${base}/api/courses`, { headers: hdr })).json();
  const imported = courses.docs.find(c => c.id === 'c_imported');
  assert.ok(imported, 'imported course is served');
  const assetId = imported.holes[0].art.asset;
  const blob = await fetch(`${base}/_blob/${assetId}`);
  assert.equal(blob.status, 200, 'artwork reference resolves without rewriting ids');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
});
