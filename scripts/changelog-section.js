// Print one version's notes from CHANGELOG.md (the GitHub release body).
//   node scripts/changelog-section.js 1.2.0
import { readFileSync } from 'node:fs';
import { parseChangelog } from '../server/changelog.js';

const v = process.argv[2];
const entry = parseChangelog(readFileSync('CHANGELOG.md', 'utf8')).find(e => e.version === v);
if (!entry || !entry.notes.length) { console.error(`CHANGELOG.md has no notes for ${v}`); process.exit(1); }
console.log(entry.notes.map(n => `- ${n}`).join('\n'));
