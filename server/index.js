// Carry — API and static host.
//
// Everything the browser can do goes through here, so the Anthropic key,
// the database and the uploaded files all stay server-side.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDocs, getDoc, putDoc, deleteDoc, recordAsset, getAsset, deleteAsset, stamps, ASSET_DIR } from './db.js';
import { analyse, parseJson } from './anthropic.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 1818);
const TOKEN = process.env.API_TOKEN || '';
const COLLECTIONS = new Set(['clubs', 'courses', 'sessions', 'settings']);
const MAX_ASSET = Number(process.env.MAX_ASSET_MB || 200) * 1024 * 1024;

app.use(express.json({ limit: '64mb' }));
app.use(express.raw({ type: ['image/*', 'video/*', 'application/octet-stream'], limit: `${Math.ceil(MAX_ASSET / 1048576)}mb` }));

// Single-user auth. Set API_TOKEN and the browser sends it back on every
// call; leave it empty only on a LAN you trust.
app.use('/api', (req, res, next) => {
  if (!TOKEN) return next();
  const given = req.get('x-carry-token') || req.query.token;
  if (given === TOKEN) return next();
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
app.get('/_blob/:id', (req, res) => {
  const a = getAsset(req.params.id);
  if (!a) return res.status(404).end();
  const p = join(ASSET_DIR, `${req.params.id}.${EXT[a.content_type] || 'bin'}`);
  if (!existsSync(p)) return res.status(404).end();
  res.type(a.content_type).set('Cache-Control', 'public, max-age=31536000, immutable').send(readFileSync(p));
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
  const { prompt, images = [], json = true } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const { text, usage } = await analyse({ prompt, images });
    res.json({ text, json: json ? parseJson(text) : null, usage });
  } catch (e) {
    const status = e.code === 'unconfigured' ? 503 : e.code === 'rate_limited' ? 429 : e.code === 'bad_key' ? 401 : 502;
    res.status(status).json({ error: e.code || 'failed', message: e.message });
  }
});

/* ---------- static app ---------- */
app.get('/healthz', (_req, res) => res.json({ ok: true, collections: stamps() }));
app.use(express.static(join(here, '..', 'web'), { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

app.listen(PORT, () => console.log(`Carry listening on http://0.0.0.0:${PORT}`));
