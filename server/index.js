// Carry — API and static host.
//
// Everything the browser can do goes through here, so the Anthropic key,
// the database and the uploaded files all stay server-side.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, listDocs, getDoc, putDoc, deleteDoc, courseRoundsOfOthers, mergeCourseMarks, recordAsset, getAsset, deleteAsset, stamps, ASSET_DIR, COLLECTIONS } from './db.js';
import { requireUser, authMode } from './auth.js';
import { analyse, parseJson } from './anthropic.js';
import { VERSION, COMMIT, CHANGELOG } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 1818);
const MAX_ASSET = Number(process.env.MAX_ASSET_MB || 200) * 1024 * 1024;

// One line per request that changes something or fails, so the NAS's
// container log says what happened. Quiet for successful reads (the page
// polls every few seconds), and the path only: no query string reaches the log.
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
// sign-in check so the app can compare builds before anyone is signed in.
app.get('/api/version', (_req, res) => res.set('Cache-Control', 'no-store').json({ version: VERSION, commit: COMMIT, changelog: CHANGELOG }));

// Everyone is signed in through Cloudflare Access (server/auth.js); req.user
// is their email. Everything below, files included, needs it.
const signedIn = requireUser();
app.use('/api', signedIn);
app.get('/api/me', (req, res) => res.json({ email: req.user }));

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
  recordAsset(id, type, buf.length, req.user);
  res.json({ id, url: `/_blob/${id}`, sizeBytes: buf.length, contentType: type });
});
app.delete('/api/assets/:id', (req, res) => {
  const a = getAsset(req.params.id);
  // Only the person who uploaded a file deletes it (files from before 2.0.0 belong to the owner).
  if (a && a.owner && a.owner !== req.user) return res.status(403).json({ error: 'not yours' });
  if (a) { const p = join(ASSET_DIR, `${req.params.id}.${EXT[a.content_type] || 'bin'}`); if (existsSync(p)) unlinkSync(p); }
  res.json({ deleted: deleteAsset(req.params.id) });
});
// Signed-in only (an <img src> carries the Access cookie, and Cloudflare adds
// the signed header on the way through). Any signed-in person can read a file:
// course artwork is shared, and ids are unguessable. Streamed with byte ranges (a phone's video player needs them), and never
// runnable: only photo and video types are served inline; anything else
// (an SVG, say, which can carry script) is a download, and nothing is
// sniffed or allowed to run even if opened directly.
const INLINE = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
app.get('/_blob/:id', signedIn, (req, res) => {
  const a = getAsset(req.params.id);
  if (!a) return res.status(404).end();
  const file = `${req.params.id}.${EXT[a.content_type] || 'bin'}`;
  if (!existsSync(join(ASSET_DIR, file))) return res.status(404).end();
  const inline = INLINE.has(a.content_type);
  res.set({
    'Content-Type': inline ? a.content_type : 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',   // behind sign-in: never a shared cache's
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  if (!inline) res.set('Content-Disposition', `attachment; filename="${file}"`);
  res.sendFile(file, { root: ASSET_DIR, dotfiles: 'deny', acceptRanges: true, cacheControl: false });
});

/* ---------- documents ---------- */
app.get('/api/stamps', (req, res) => res.json(stamps(req.user)));
app.get('/api/:collection', (req, res) => res.json({ docs: listDocs(collectionOf(req), req.user) }));
app.get('/api/:collection/:id', (req, res) => {
  const doc = getDoc(collectionOf(req), req.user, req.params.id);
  return doc ? res.json(doc) : res.status(404).json({ error: 'not found' });
});
app.put('/api/:collection/:id', (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'body must be an object' });
  const col = collectionOf(req);
  let doc = { ...req.body, id: req.params.id };
  // A shared course keeps everyone's GPS marks, whatever copy this phone had.
  if (col === 'courses') {
    const m = mergeCourseMarks(getDoc(col, req.user, req.params.id), doc, req.user);
    if (m.error) return res.status(400).json({ error: 'bad_mark', message: m.error });
    doc = m.doc;
  }
  res.json(putDoc(col, req.user, req.params.id, doc));
});
app.delete('/api/:collection/:id', (req, res) => {
  const col = collectionOf(req);
  // A shared course someone else has played stays: their rounds point at it.
  if (col === 'courses') {
    const n = courseRoundsOfOthers(req.params.id, req.user);
    if (n) return res.status(409).json({ error: 'in_use', message: `${n} round${n === 1 ? '' : 's'} by someone else ${n === 1 ? 'was' : 'were'} played on this course` });
  }
  res.json({ deleted: deleteDoc(col, req.user, req.params.id) });
});

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
// Open for Docker's healthcheck, so it says nothing about anyone's data.
app.get('/healthz', (_req, res) => res.json({ ok: true, version: VERSION, commit: COMMIT }));

// The page carries its own version in <meta> tags, stamped here as it's
// served, so a phone running a cached copy can tell it's behind the server.
// Served only through sendIndex — never as a plain static file, or the
// placeholders reach the device unfilled.
const INDEX_HTML = readFileSync(join(here, '..', 'web', 'index.html'), 'utf8')
  .replace('content="__APP_VERSION__"', `content="${VERSION}"`)
  .replace('content="__APP_COMMIT__"', `content="${COMMIT}"`);
// The app shell (page, shim, hole maps, manifest) is revalidated on every load, or a
// phone keeps the old app after a redeploy. no-cache still allows a cheap
// 304 via the ETag. The shim must never lag the page it was written for.
const revalidate = res => res.set('Cache-Control', 'no-cache');
const sendIndex = (_req, res) => { revalidate(res); res.type('html').send(INDEX_HTML); };
app.get(['/', '/index.html'], sendIndex);           // before express.static, or the unstamped file wins
app.use(express.static(join(here, '..', 'web'), {
  index: false, maxAge: '1h',
  // Course maps are revalidated too: a rebuilt map must reach the phone with the page that reads it.
  setHeaders: (res, file) => { if (/\.(html|js|webmanifest|json)$/.test(file)) revalidate(res); },
}));

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`${new Date().toISOString()} ERROR ${req.method} ${req.originalUrl.split('?')[0]}\n${err.stack || err}`);
  res.status(status).json({ error: err.message || 'server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Carry ${VERSION} (${COMMIT}) listening on http://0.0.0.0:${PORT}`);
  const mode = authMode();
  if (mode === 'none') console.warn('WARNING: sign-in is not configured (CF_ACCESS_TEAM and CF_ACCESS_AUD), so every request for data is refused. Set them; see the README.');
  if (mode === 'dev') console.warn(`WARNING: DEV_USER is set, so every request is ${process.env.DEV_USER} with no sign-in. For local development only, never on the NAS.`);
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
