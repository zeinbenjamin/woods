// The app, the shim and the server together: load the real index.html in
// a DOM, point fetch at a live server, and check that writes land in
// SQLite and reads come back. Signed in with DEV_USER, the local-development
// mode, so this also shows that mode runs the whole app with no Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const DATA = mkdtempSync(join(tmpdir(), 'carry-web-'));
const PORT = 8124, base = `http://127.0.0.1:${PORT}`;
let proc, dom, win;

const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), CF_ACCESS_TEAM: '', CF_ACCESS_AUD: '', DEV_USER: 'web@example.com' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(100); }

  // Inline the shim rather than letting jsdom fetch it: the resource
  // loader is slow and unnecessary here. A browser loads it by src.
  const shim = readFileSync('web/platform.js', 'utf8'), holemap = readFileSync('web/holemap.js', 'utf8');
  const html = readFileSync('web/index.html', 'utf8')
    .replace('<script src="platform.js?v=__APP_BUILD__"></script>', () => `<script>${shim}</script>`)
    .replace('<script src="holemap.js?v=__APP_BUILD__"></script>', () => `<script>${holemap}</script>`);
  dom = new JSDOM(html, {
    url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      win = w;
      w.HTMLElement.prototype.showModal = function () { this.open = true; };
      w.HTMLElement.prototype.close = function () { this.open = false; if (this.onclose) this.onclose(); };
      w.scrollTo = () => {};
      // real network, absolute-ised so the shim's relative paths resolve
      w.fetch = (u, o) => fetch(String(u).startsWith('http') ? u : base + u, o);
      w.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(a => { this.result = 'data:' + (b.type || '') + ';base64,' + Buffer.from(a).toString('base64'); this.onload && this.onload(); }); } };
    },
  });
  await sleep(800);   // boot, first fetches, first render
});
after(() => {
  // the shim's poll timer would otherwise hold the event loop open
  try { win.close(); } catch {}
  proc.kill();
  rmSync(DATA, { recursive: true, force: true });
});

test('the shim satisfies the capability surface the app expects', async () => {
  const caps = await win.eval(`(async()=>({ db: !!(await claude.use('db')), assets: !!(await claude.use('assets')),
     sample: !!(await claude.use('sample')), downloads: !!(await claude.use('downloads')),
     images: !!(await (await claude.use('sample')).limits()).images }))()`);
  // compared field by field: the object comes from jsdom's realm
  for (const k of ['db', 'assets', 'sample', 'downloads', 'images']) assert.equal(caps[k], true, `${k} capability`);
});

test('the app booted and rendered against an empty server', () => {
  const view = win.document.querySelector('#view');
  assert.ok(view && view.textContent.length > 20, 'something rendered');
  assert.equal(win.eval('S.courses.length'), 0);
});

test('a write from the app reaches SQLite and comes back', async () => {
  await win.eval(`save('courses','c_web',{ id:'c_web', v:2, name:'Web GC', tee:'white',
    holes:[{n:1,par:4,metres:300,tees:{white:300}}] })`);
  await sleep(200);
  const onServer = await (await fetch(`${base}/api/courses`)).json();
  assert.equal(onServer.docs.length, 1);
  assert.equal(onServer.docs[0].name, 'Web GC');
  assert.equal(win.eval('S.courses.length'), 1, 'and the app sees its own write immediately');
});

test('an upload becomes a blob the app can reference', async () => {
  const id = await win.eval(`(async()=>{ const a = await claude.use('assets');
    const r = await a.upload(new Blob([new Uint8Array([1,2,3,4])], { type:'image/webp' }), { type:'image/webp' });
    return r.id; })()`);
  assert.match(id, /^[0-9a-f]{32}$/);
  const blob = await fetch(`${base}/_blob/${id}`);
  assert.equal(blob.status, 200);
});

test('a change made elsewhere arrives by polling', async () => {
  await fetch(`${base}/api/clubs/9i`, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '9i', name: '9 Iron', category: 'iron', order: 7 }) });
  for (let i = 0; i < 40 && win.eval('S.clubs.length') === 0; i++) await sleep(200);
  assert.equal(win.eval('S.clubs.length'), 1, 'polled the change in without a reload');
});

test('a poll after a change asks for what changed since, not the whole collection (2.59.0)', async () => {
  const seen = []; const real = win.fetch;
  win.fetch = (u, o) => { seen.push(String(u)); return real(u, o); };
  try {
    // A change made elsewhere: the poll asks with ?since= and the app gets it.
    await fetch(`${base}/api/clubs/PW`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PW', name: 'Pitching wedge', category: 'wedge', order: 8 }) });
    for (let i = 0; i < 40 && !win.eval(`S.clubs.some(c => c.code === 'PW')`); i++) await sleep(200);
    assert.ok(win.eval(`S.clubs.some(c => c.code === 'PW')`), 'arrived');
    assert.ok(seen.some(u => /\/api\/clubs\?since=/.test(u)), seen.join(' '));
    assert.ok(!seen.some(u => /\/api\/clubs$/.test(u)), 'never the whole collection again');
    // The app's own save coming round again redraws nothing.
    const draws = () => win.eval('window.__draws || 0');
    win.eval(`(() => { const r = render; window.__draws = 0; render = (...a) => { window.__draws++; return r(...a); }; })()`);
    await win.eval(`save('clubs', '9i', { ...S.clubs.find(c => c.code === '9i'), nominalCarry: 101 })`);
    const after = draws(); seen.length = 0;
    for (let i = 0; i < 25 && !seen.some(u => /\/api\/clubs\?since=/.test(u)); i++) await sleep(200);
    await sleep(300);
    assert.ok(seen.some(u => /\/api\/clubs\?since=/.test(u)), 'the poll asked');
    assert.equal(draws(), after, 'its own save coming back changed nothing on screen');
    // A deletion elsewhere is seen too.
    await fetch(`${base}/api/clubs/PW`, { method: 'DELETE' });
    for (let i = 0; i < 40 && win.eval(`S.clubs.some(c => c.code === 'PW')`); i++) await sleep(200);
    assert.ok(!win.eval(`S.clubs.some(c => c.code === 'PW')`), 'gone from the app');
  } finally { win.fetch = real; }
});

test('deleting from the app removes it from the server', async () => {
  await win.eval(`(async()=>{ const db = await claude.use('db'); await db.collection('courses').doc('c_web').delete(); })()`);
  await sleep(200);
  const left = await (await fetch(`${base}/api/courses`)).json();
  assert.equal(left.docs.length, 0);
});
