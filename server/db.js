// Storage: one SQLite table of JSON documents, plus files on disk for
// assets. Documents are small and always read whole, so a document store
// is the right shape — but it is SQLite underneath, so when strokes
// gained needs real queries the data is already relational-ready.
//
// Since 2.0.0 every document has an owner: the email of the person it
// belongs to, from Cloudflare Access. Courses are shared — one Randwick for
// everyone — and are stored with owner '' so anyone signed in reads and
// edits them. Clubs, sessions (rounds and range) and settings are each
// person's own: the same id ('7i', 'app') can exist once per person.
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';
export const ASSET_DIR = join(DATA_DIR, 'assets');
mkdirSync(ASSET_DIR, { recursive: true });

export const SHARED = new Set(['courses']);
export const COLLECTIONS = new Set(['clubs', 'courses', 'sessions', 'settings']);
export const BACKUP_BEFORE_2 = join(DATA_DIR, 'carry-before-2.0.0.db');

export const db = new Database(join(DATA_DIR, 'carry.db'));
db.pragma('journal_mode = WAL');

const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const hasTable = table => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

// 1.x had one person's data and no owner. Converting it needs to know whose
// it is (OWNER_EMAIL), and keeps a copy of the database as it was first.
function migrateTo2() {
  if (!hasTable('docs') || columns('docs').includes('owner')) return;
  // The YAML's placeholder, or anything that isn't an email, is no owner.
  let owner = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (/replace/.test(owner) || !/^[^@\s]+@[^@\s]+$/.test(owner)) owner = '';
  const personal = db.prepare("SELECT COUNT(*) AS n FROM docs WHERE collection != 'courses'").get().n;
  const files = hasTable('assets') ? db.prepare('SELECT COUNT(*) AS n FROM assets').get().n : 0;
  if ((personal || files) && !owner) {
    throw new Error(`This database is from Carry 1.x and holds ${personal} personal records and ${files} files with no owner. ` +
      'Set OWNER_EMAIL to the email you sign in to Cloudflare Access with, and start again. Nothing has been changed.');
  }
  if (!existsSync(BACKUP_BEFORE_2)) db.exec(`VACUUM INTO '${BACKUP_BEFORE_2.replace(/'/g, "''")}'`);
  db.transaction(() => {
    db.exec(`CREATE TABLE docs_v2 (
      collection TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL,
      body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT,
      PRIMARY KEY (collection, owner, id))`);
    db.prepare(`INSERT INTO docs_v2 (collection, owner, id, body, updated_at, updated_by)
                SELECT collection, CASE WHEN collection = 'courses' THEN '' ELSE ? END, id, body, updated_at, ? FROM docs`).run(owner, owner || null);
    db.exec('DROP TABLE docs; ALTER TABLE docs_v2 RENAME TO docs;');
    if (hasTable('assets') && !columns('assets').includes('owner')) {
      db.exec('ALTER TABLE assets ADD COLUMN owner TEXT');
      db.prepare('UPDATE assets SET owner = ?').run(owner || null);
    }
  })();
  console.log(`Converted the database to Carry 2: ${personal} personal records now belong to ${owner || '(nobody: it was empty)'}; ` +
    `courses are shared. The old database is kept at ${BACKUP_BEFORE_2}.`);
}
migrateTo2();

db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL,
    body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT,
    PRIMARY KEY (collection, owner, id)
  );
  CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner, collection);
  CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    owner        TEXT
  );
`);

const now = () => new Date().toISOString();
// Whose row a document is: '' for the shared collections, the person otherwise.
const ownerOf = (collection, user) => (SHARED.has(collection) ? '' : user);

export const listDocs = (collection, user) =>
  db.prepare('SELECT id, body FROM docs WHERE collection = ? AND owner = ? ORDER BY id').all(collection, ownerOf(collection, user))
    .map(r => ({ id: r.id, ...JSON.parse(r.body) }));

export const getDoc = (collection, user, id) => {
  const r = db.prepare('SELECT body FROM docs WHERE collection = ? AND owner = ? AND id = ?').get(collection, ownerOf(collection, user), id);
  return r ? JSON.parse(r.body) : null;
};

export const putDoc = (collection, user, id, body) => {
  db.prepare(`INSERT INTO docs (collection, owner, id, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(collection, owner, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(collection, ownerOf(collection, user), id, JSON.stringify(body), now(), user);
  return body;
};

export const deleteDoc = (collection, user, id) =>
  db.prepare('DELETE FROM docs WHERE collection = ? AND owner = ? AND id = ?').run(collection, ownerOf(collection, user), id).changes > 0;

/* ---------- GPS marks on a shared course (2.3.0) ----------
   holes[i].marks: raw tee and flag fixes from Play mode, {k, lat, lng, acc,
   at, by, tee?}, used by the course maps where OSM has no hole line. The
   course is one document everyone saves whole, so a phone with an older copy
   would otherwise drop the marks someone else just added. On every save:
   - marks by someone else that are already stored always stay;
   - your own stored marks stay only if your copy still has them (that's how
     you remove one);
   - a mark that isn't stored yet is added only as yours (by = you), and must
     be a real fix: tee or flag, a latitude and longitude, accuracy 10 m or
     better, a time. Anyone else's unstored mark in your copy is ignored, so a
     mark its owner removed can't come back from a friend's old copy.
   trusted (the import script) keeps every mark from both sides. */
export const MARK_ACC = 10;
const markKey = m => `${m.by}|${m.at}|${m.k}`;
function badMark(m) {
  if (!m || (m.k !== 'tee' && m.k !== 'flag')) return 'a mark is a tee or a flag';
  if (!Number.isFinite(m.lat) || Math.abs(m.lat) > 90 || !Number.isFinite(m.lng) || Math.abs(m.lng) > 180) return 'a mark needs a latitude and longitude';
  if (!Number.isFinite(m.acc) || m.acc < 0) return 'a mark needs its GPS accuracy';
  if (m.acc > MARK_ACC) return `GPS ±${Math.round(m.acc)} m is too rough for a mark (${MARK_ACC} m or better)`;
  if (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at))) return 'a mark needs the time it was taken';
  return null;
}
export function mergeCourseMarks(stored, incoming, user, { trusted = false } = {}) {
  if (!Array.isArray(incoming.holes)) return { doc: incoming };
  const before = new Map(((stored && stored.holes) || []).map(h => [h.n, h.marks || []]));
  const holes = [];
  for (const h of incoming.holes || []) {
    const old = before.get(h.n) || [], oldKeys = new Set(old.map(markKey));
    const mine = new Set((h.marks || []).map(m => markKey({ ...m, by: m.by || user })));
    const kept = old.filter(m => trusted || m.by !== user || mine.has(markKey(m)));
    const added = [];
    for (const m of h.marks || []) {
      const by = trusted ? m.by : (m.by || user);
      if (oldKeys.has(markKey({ ...m, by }))) continue;
      if (!trusted && by !== user) continue;                    // someone else's, not stored: never resurrected
      const why = badMark(m); if (why) return { error: `Hole ${h.n}: ${why}.` };
      const mark = { k: m.k, lat: m.lat, lng: m.lng, acc: m.acc, at: m.at, by };
      if (m.k === 'tee' && m.tee) mark.tee = String(m.tee).toLowerCase();
      added.push(mark);
    }
    const marks = kept.concat(added);
    const { marks: _, ...rest } = h;
    holes.push(marks.length ? { ...rest, marks } : rest);
  }
  return { doc: { ...incoming, holes } };
}

// Someone else's rounds that were played on this shared course.
export const courseRoundsOfOthers = (courseId, user) =>
  db.prepare("SELECT COUNT(*) AS n FROM docs WHERE collection = 'sessions' AND owner != ? AND json_extract(body, '$.courseId') = ?").get(user, courseId).n;

export const recordAsset = (id, contentType, bytes, user) =>
  db.prepare('INSERT OR REPLACE INTO assets (id, content_type, bytes, created_at, owner) VALUES (?, ?, ?, ?, ?)')
    .run(id, contentType, bytes, now(), user || null);

export const getAsset = id => db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
export const deleteAsset = id => db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes > 0;

// Cheap change detection: the web app polls this and only refetches a
// collection whose stamp moved. Each person sees the stamps of their own
// documents and the shared ones, never anyone else's.
export const stamps = user => Object.fromEntries(
  db.prepare("SELECT collection, MAX(updated_at) AS t, COUNT(*) AS n FROM docs WHERE owner = ? OR owner = '' GROUP BY collection").all(user)
    .map(r => [r.collection, `${r.t}:${r.n}`]));
