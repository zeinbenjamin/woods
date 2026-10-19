#!/usr/bin/env node
// Load a Carry export (the JSON the app's "Export everything" button
// produces) into this server's database and asset store.
//
//   npm run import -- ./carry-export-2026-09-25.json --owner you@example.com
//
// Since 2.0.0 clubs, sessions and settings belong to someone: --owner is the
// email they sign in to Cloudflare Access with. Courses are shared and land
// in everyone's list (an older copy of a course overwrites the current one).
//
// Asset ids are preserved, so every reference inside the documents keeps
// resolving without rewriting. Safe to re-run: documents are upserted by
// id and assets are written by id.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { putDoc, getDoc, recordAsset, listDocs, mergeCourseMarks, ASSET_DIR } from '../server/db.js';

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

const args = process.argv.slice(2);
const at = args.indexOf('--owner');
const owner = at >= 0 ? String(args.splice(at, 2)[1] || '').trim().toLowerCase() : '';
const file = args[0];
if (!file || !owner.includes('@')) { console.error('usage: npm run import -- <carry-export.json> --owner <email>'); process.exit(1); }

const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.format !== 'carry-export') { console.error('Not a Carry export (missing format marker)'); process.exit(1); }
console.log(`Export from ${data.exportedAt}, schema v${data.version}`);

let assets = 0;
for (const [id, dataUrl] of Object.entries(data.assets || {})) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) { console.warn(`  skipped asset ${id}: not a data URL`); continue; }
  const [, type, b64] = m;
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(join(ASSET_DIR, `${id}.${EXT[type] || 'bin'}`), buf);
  recordAsset(id, type, buf.length, owner);
  assets++;
}

const counts = {};
for (const name of ['clubs', 'courses', 'sessions']) {
  for (const doc of (data[name] || [])) {
    const id = name === 'clubs' ? doc.code : doc.id;
    if (!id) { console.warn(`  skipped a ${name} record with no id`); continue; }
    // A course keeps the GPS marks already on it as well as the export's.
    putDoc(name, owner, id, name === 'courses' ? mergeCourseMarks(getDoc(name, owner, id), doc, owner, { trusted: true }).doc : doc);
    counts[name] = (counts[name] || 0) + 1;
  }
}
if (data.settings && Object.keys(data.settings).length) { putDoc('settings', owner, 'app', { ...data.settings, id: 'app' }); counts.settings = 1; }

console.log(`Imported: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}, ${assets} assets`);
console.log(`Now in the database for ${owner}:`, ['clubs', 'courses', 'sessions', 'settings'].map(c => `${listDocs(c, owner).length} ${c}`).join(', '));
