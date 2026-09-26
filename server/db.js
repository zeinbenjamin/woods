// Storage: one SQLite table of JSON documents, plus files on disk for
// assets. Documents are small and always read whole, so a document store
// is the right shape — but it is SQLite underneath, so when strokes
// gained needs real queries the data is already relational-ready.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';
export const ASSET_DIR = join(DATA_DIR, 'assets');
mkdirSync(ASSET_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'carry.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    body       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS docs_collection ON docs(collection);
  CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    created_at   TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

export const listDocs = collection =>
  db.prepare('SELECT id, body FROM docs WHERE collection = ? ORDER BY id').all(collection)
    .map(r => ({ id: r.id, ...JSON.parse(r.body) }));

export const getDoc = (collection, id) => {
  const r = db.prepare('SELECT body FROM docs WHERE collection = ? AND id = ?').get(collection, id);
  return r ? JSON.parse(r.body) : null;
};

export const putDoc = (collection, id, body) => {
  db.prepare(`INSERT INTO docs (collection, id, body, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(collection, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`)
    .run(collection, id, JSON.stringify(body), now());
  return body;
};

export const deleteDoc = (collection, id) =>
  db.prepare('DELETE FROM docs WHERE collection = ? AND id = ?').run(collection, id).changes > 0;

export const recordAsset = (id, contentType, bytes) =>
  db.prepare('INSERT OR REPLACE INTO assets (id, content_type, bytes, created_at) VALUES (?, ?, ?, ?)')
    .run(id, contentType, bytes, now());

export const getAsset = id => db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
export const deleteAsset = id => db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes > 0;

// Cheap change detection: the web app polls this and only refetches a
// collection whose stamp moved.
export const stamps = () => Object.fromEntries(
  db.prepare('SELECT collection, MAX(updated_at) AS t, COUNT(*) AS n FROM docs GROUP BY collection').all()
    .map(r => [r.collection, `${r.t}:${r.n}`]));
