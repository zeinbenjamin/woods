// Carry — API and static host.
//
// Everything the browser can do goes through here, so the Anthropic key,
// the database and the uploaded files all stay server-side.
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, listDocs, getDoc, putDoc, deleteDoc, recordAsset, getAsset, deleteAsset, stamps, ASSET_DIR } from './db.js';
import { analyse, parseJson } from './anthropic.js';
import { VERSION, COMMIT, CHANGELOG } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 1818);
const TOKEN = process.env.API_TOKEN || '';
const COLLECTIONS = new Set(['clubs', 'courses', 'sessions', 'settings']);
const MAX_ASSET = Number(process.env.MAX_ASSET_MB || 200) * 1024 * 1024;

// One line per request that changes something or fails, so the NAS's
// container log says what happened. Quiet for successful reads (the page
// polls every few seconds), and the path only: a ?token= never reaches the log.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode < 400) return;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  next();
});
app.use(express.json({ limit: '64mb' }));
app.use(express.raw({ type: ['image/*', 'video/*', 'application/octet-stream'], limit: `${Math.ceil(MAX_ASSET / 1048576)}mb` }));

// Which build this is, and what changed in each version. Open like
// /healthz — it says nothing about the data — and registered before the
// auth check so the app can compare builds even before it has a token.
app.get('/api/version', (_req, res) => res.set('Cache-Control', 'no-store').json({ version: VERSION, commit: COMMIT, changelog: CHANGELOG }));

// Single-user auth. Set API_TOKEN and the browser sends it back on every
// call; leave it empty only on a LAN you trust.
app.use('/api', (req, res, next) => {
  if (!TOKEN) return next();
  const given = Buffer.from(String(req.get('x-carry-token') || req.query.token || ''));
  const want = Buffer.from(TOKEN);
  if (given.length === want.length && timingSafeEqual(given, want)) return next();
  res.status(401).json({ error: 'unauthorised' });
});

const collectionOf = req => {
  const c = req.params.collection;
  if (!COLLECTIONS.has(c)) { const e = new Error('unknown collection'); e.status = 404; throw e; }
  return c;
};

/* ---------- assets ----------
   Registered before the document routes: DELETE /api/:collection/:id would
   otherwise match /api/assets/:id first and reject it as an unknown collection. */
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/pdf': 'pdf' };

app.post('/api/assets', (req, res) => {
  const type = req.get('content-type') || 'application/octet-stream';
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'empty body' });
  if (buf.length > MAX_ASSET) return res.status(413).json({ error: 'too large' });
  const id = randomBytes(16).toString('hex');
  writeFileSync(join(ASSET_DIR, `${id}.${EXT[type] || 'bin'}`), buf);
  recordAsset(id, type, buf.length);
  res.json({ id, url: `/_blob/${id}`, sizeBytes: buf.length, contentType: type });
});
app.delete('/api/assets/:id', (req, res) => {
  const a = getAsset(req.params.id);
  if (a) { const p = join(ASSET_DIR, `${req.params.id}.${EXT[a.content_type] || 'bin'}`); if (existsSync(p)) unlinkSync(p); }
  res.json({ deleted: deleteAsset(req.params.id) });
});
// Served unauthenticated so <img src> works; ids are unguessable.
// Streamed with byte ranges (a phone's video player needs them), and never
// runnable: only photo and video types are served inline; anything else
// (an SVG, say, which can carry script) is a download, and nothing is
// sniffed or allowed to run even if opened directly.
const INLINE = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
app.get('/_blob/:id', (req, res) => {
  const a = getAsset(req.params.id);
  if (!a) return res.status(404).end();
  const file = `${req.params.id}.${EXT[a.content_type] || 'bin'}`;
  if (!existsSync(join(ASSET_DIR, file))) return res.status(404).end();
  const inline = INLINE.has(a.content_type);
  res.set({
    'Content-Type': inline ? a.content_type : 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  if (!inline) res.set('Content-Disposition', `attachment; filename="${file}"`);
  res.sendFile(file, { root: ASSET_DIR, dotfiles: 'deny', acceptRanges: true, cacheControl: false });
});

/* ---------- documents ---------- */
app.get('/api/stamps', (_req, res) => res.json(stamps()));
app.get('/api/:collection', (req, res) => res.json({ docs: listDocs(collectionOf(req)) }));
app.get('/api/:collection/:id', (req, res) => {
  const doc = getDoc(collectionOf(req), req.params.id);
  return doc ? res.json(doc) : res.status(404).json({ error: 'not found' });
});
app.put('/api/:collection/:id', (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'body must be an object' });
  res.json(putDoc(collectionOf(req), req.params.id, { ...req.body, id: req.params.id }));
});
app.delete('/api/:collection/:id', (req, res) => res.json({ deleted: deleteDoc(collectionOf(req), req.params.id) }));

/* ---------- swing analysis ---------- */
app.post('/api/analyse', async (req, res) => {
  const { prompt, images = [], json = true, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  // Long answers (a 40-shot list as JSON) need more than the default; capped
  // so a request can't ask for an unbounded bill.
  const cap = Math.min(16000, Math.max(256, Number(maxTokens) || 2000));
  try {
    const { text, usage } = await analyse({ prompt, images, maxTokens: cap });
    res.json({ text, json: json ? parseJson(text) : null, usage });
  } catch (e) {
    const status = e.code === 'unconfigured' ? 503 : e.code === 'rate_limited' ? 429 : e.code === 'bad_key' ? 401 : 502;
    res.status(status).json({ error: e.code || 'failed', message: e.message });
  }
});

/* ---------- static app ---------- */
app.get('/healthz', (_req, res) => res.json({ ok: true, version: VERSION, commit: COMMIT, collections: stamps() }));

// The page carries its own version in <meta> tags, stamped here as it's
// served, so a phone running a cached copy can tell it's behind the server.
// Served only through sendIndex — never as a plain static file, or the
// placeholders reach the device unfilled.
const INDEX_HTML = readFileSync(join(here, '..', 'web', 'index.html'), 'utf8')
  .replace('content="__APP_VERSION__"', `content="${VERSION}"`)
  .replace('content="__APP_COMMIT__"', `content="${COMMIT}"`);
// The app shell (page, shim, manifest) is revalidated on every load, or a
// phone keeps the old app after a redeploy. no-cache still allows a cheap
// 304 via the ETag. The shim must never lag the page it was written for.
const revalidate = res => res.set('Cache-Control', 'no-cache');
const sendIndex = (_req, res) => { revalidate(res); res.type('html').send(INDEX_HTML); };
app.get(['/', '/index.html'], sendIndex);           // before express.static, or the unstamped file wins
app.use(express.static(join(here, '..', 'web'), {
  index: false, maxAge: '1h',
  setHeaders: (res, file) => { if (/\.(html|js|webmanifest)$/.test(file)) revalidate(res); },
}));

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`${new Date().toISOString()} ERROR ${req.method} ${req.originalUrl.split('?')[0]}\n${err.stack || err}`);
  res.status(status).json({ error: err.message || 'server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Carry ${VERSION} (${COMMIT}) listening on http://0.0.0.0:${PORT}`);
  if (!TOKEN) console.warn('WARNING: API_TOKEN is empty, so the API is open to anyone who can reach this port. Set it unless this is a trusted LAN.');
});

// docker stop sends SIGTERM. Node doesn't exit on it by default when it's
// the container's first process, so Docker waited 10s and killed it. Close
// the server and the database cleanly instead.
function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  const done = () => { try { db.close(); } catch {} process.exit(0); };
  server.close(done);
  server.closeIdleConnections?.();
  setTimeout(done, 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
