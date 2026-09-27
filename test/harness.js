// Shared harness for the UI suites: a real server process on a free port,
// and the real web/index.html + web/platform.js loaded into jsdom against
// it. Only what jsdom lacks is stubbed, and each stub is narrow:
//
//   dialog.showModal/close   jsdom has no <dialog> behaviour
//   SVG createSVGPoint/CTM   identity transform, so a click's clientX/Y
//                            IS the SVG coordinate — taps can be placed exactly
//   URL.createObjectURL      records the blob, so downloads can be inspected
//   <a download>.click()     recorded instead of navigating
//   Blob.arrayBuffer/text    missing from jsdom's Blob
//   TextEncoder              missing from jsdom's window
//   canvas getContext        returns null (jsdom has no canvas) without the console noise
//   fetch                    real network; jsdom Blob bodies sent as bytes, abort signals dropped
//
// Everything else — the app, the shim, the server, SQLite — is the real thing.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.unref(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

export async function waitFor(cond, { timeout = 4000, step = 20, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    let v; try { v = await cond(); } catch { v = false; }
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}

// Start a server with `seed` already in SQLite, then boot the app against it.
// seed: { clubs: [], courses: [], sessions: [], settings: {} }
export async function startApp({ seed = {}, pollMs = 150, intercept, query = '', serverToken = '' } = {}) {
  const DATA = mkdtempSync(join(tmpdir(), 'carry-ui-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['server/index.js'], {
    env: { ...process.env, DATA_DIR: DATA, PORT: String(port), API_TOKEN: serverToken, ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`${base}/healthz`)).ok, { timeout: 8000, what: 'server start' });

  const auth = serverToken ? { 'x-carry-token': serverToken } : {};
  const api = {
    async put(col, id, doc) {
      const r = await fetch(`${base}/api/${col}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(doc) });
      if (!r.ok) throw new Error(`PUT ${col}/${id}: ${r.status}`);
      return r.json();
    },
    async get(col, id) { const r = await fetch(`${base}/api/${col}/${encodeURIComponent(id)}`, { headers: auth }); return r.ok ? r.json() : null; },
    async list(col) { return (await (await fetch(`${base}/api/${col}`, { headers: auth })).json()).docs; },
    async upload(bytes, type = 'image/png') {
      return (await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'content-type': type }, body: bytes })).json();
    },
    async blobStatus(id) { return (await fetch(`${base}/_blob/${id}`)).status; },
  };
  for (const c of seed.clubs || []) await api.put('clubs', c.code, c);
  for (const c of seed.courses || []) await api.put('courses', c.id, c);
  for (const s of seed.sessions || []) await api.put('sessions', s.id, s);
  if (seed.settings) await api.put('settings', 'app', { id: 'app', ...seed.settings });

  const downloads = [];        // { filename, blob }
  const objectURLs = new Map();
  let win;
  // The page as the server serves it (version stamped into its meta tags),
  // with its scripts inlined: jsdom's resource loader is slow and unnecessary.
  const served = await (await fetch(`${base}/`)).text();
  let html = served;
  for (const f of ['platform.js', 'holemap.js']) {
    const tag = `<script src="${f}"></script>`;
    if (!html.includes(tag)) throw new Error(`harness: ${f} script tag not found in the served page`);
    html = html.replace(tag, () => `<script>${readFileSync('web/' + f, 'utf8')}</script>`);
  }

  const dom = new JSDOM(html, {
    url: base + '/' + query, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      win = w;
      w.CARRY_POLL_MS = pollMs;
      w.HTMLElement.prototype.showModal = function () { this.open = true; };
      w.HTMLElement.prototype.close = function () { const was = this.open; this.open = false; if (was && this.onclose) this.onclose(); };
      w.scrollTo = () => {};
      w.TextEncoder = TextEncoder;   // every browser has it; jsdom doesn't
      w.HTMLCanvasElement.prototype.getContext = () => null;   // no canvas in jsdom: say so quietly
      // A tap's client coordinates are its SVG coordinates.
      w.SVGElement.prototype.createSVGPoint = function () { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; };
      w.SVGElement.prototype.getScreenCTM = function () { return { inverse() { return {}; } }; };
      let n = 0;
      w.URL.createObjectURL = b => { const u = `blob:carry-test/${++n}`; objectURLs.set(u, b); return u; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download')) downloads.push({ filename: this.download, blob: objectURLs.get(this.href) });
      };
      const RealFR = w.FileReader;
      const toAB = b => typeof b.arrayBuffer === 'function' && !(b instanceof w.Blob) ? b.arrayBuffer()
        : new Promise((res, rej) => { const fr = new RealFR(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(b); });
      w.Blob.prototype.arrayBuffer = function () { return toAB(this); };
      w.Blob.prototype.text = async function () { return Buffer.from(await toAB(this)).toString('utf8'); };
      // Node Blobs (from fetch) and jsdom Blobs both have to read as data URLs.
      w.FileReader = class {
        readAsDataURL(b) { toAB(b).then(a => { this.result = 'data:' + (b.type || '') + ';base64,' + Buffer.from(a).toString('base64'); this.onload && this.onload(); }, e => this.onerror && this.onerror(e)); }
      };
      w.fetch = async (u, o = {}) => {
        const url = String(u).startsWith('http') || String(u).startsWith('data:') ? String(u) : base + u;
        if (intercept) { const r = await intercept(url, o); if (r) return r; }
        let body = o.body;
        if (body instanceof w.Blob) body = Buffer.from(await toAB(body));
        const { signal, ...rest } = o;   // jsdom's AbortSignal isn't one node's fetch accepts
        return fetch(url, { ...rest, body });
      };
    },
  });

  // Booted: storage connected, the first snapshot of every collection in,
  // and the migration pass (scheduled 400ms after connect) finished.
  await waitFor(() => win.eval(`S.dbState === 'ready'`), { what: 'db ready' });
  await sleep(700);
  await waitFor(() => !win.eval('migrating'), { what: 'migrations' });

  const doc = win.document;
  const $ = (sel, el = doc) => el.querySelector(sel);
  const $$ = (sel, el = doc) => [...el.querySelectorAll(sel)];
  const E = expr => win.eval(expr);
  const app = {
    base, win, doc, api, downloads, $, $$, E, dataDir: DATA,
    // Plain JSON copy of a value computed inside the page's realm.
    J: expr => JSON.parse(win.eval(`JSON.stringify(${expr})`)),
    text: sel => ($(sel) || {}).textContent || '',
    toast: () => $('#toast').textContent,
    sheetOpen: () => $('#sheet').open,
    confirmOpen: () => $('#confirmDlg').open,
    click(target) {
      const el = typeof target === 'string' ? $(target) : target;
      if (!el) throw new Error(`nothing to click: ${target}`);
      el.click(); return el;
    },
    fill(name, value, root = $('#sheetInner')) {
      const el = root.querySelector(`[name="${name}"]`);
      if (!el) throw new Error(`no field ${name}`);
      if (el.type === 'checkbox') el.checked = !!value; else el.value = value == null ? '' : String(value);
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    field(name, root = $('#sheetInner')) { return root.querySelector(`[name="${name}"]`); },
    // Press Save on the open sheet; resolves once it closes (true) or
    // stays open after the save handler finished (false, e.g. validation).
    async save() {
      const btn = $('#sheetInner [data-save]'); btn.click();
      await waitFor(() => !btn.disabled || !app.sheetOpen(), { what: 'save handler' });
      await sleep(30);
      return !app.sheetOpen();
    },
    async answer(yes) {
      await waitFor(() => app.confirmOpen(), { what: 'in-page confirm' });
      app.click(yes ? '#confirmYes' : '#confirmNo');
      await sleep(40);
    },
    go(tab, sub) { win.eval(`go(${JSON.stringify(tab)}, ${JSON.stringify(sub || null)})`); },
    // Click an SVG map at SVG coordinates (identity CTM above).
    async tap(sel, x, y) {
      const el = $(sel); if (!el) throw new Error(`no map ${sel}`);
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      await sleep(60);
    },
    act(name, data = {}) { return win.eval(`ACTIONS[${JSON.stringify(name)}](${JSON.stringify(data)})`); },
    waitFor,
    stop() {
      try { win.close(); } catch {}
      proc.kill();
      rmSync(DATA, { recursive: true, force: true });
    },
  };
  return app;
}

/* ---------- fixtures ----------
   Synthetic, for tests only. They are shaped like the real documents in
   SCHEMA.md but the numbers are made up and never touch the real database. */
export const club = (code, category, extra = {}) => ({ code, name: code, category, order: 1, retired: false, ...extra });

export function card(n, { tee = 'white', par = [4], metres = [300], extra = {} } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const m = metres[i % metres.length];
    return { n: i + 1, par: par[i % par.length], metres: m, tees: { [tee]: m }, si: i + 1, ...(extra[i + 1] || {}) };
  });
}

export const rangeSession = (id, date, blocks) => ({ id, v: 2, type: 'range', date, blocks });
export const block = (id, club, shots, extra = {}) => ({ id, seq: 1, club, swing: 'full', shots: shots.map(([carry, total]) => ({ carry, total })), ...extra });
