// Print one version's CHANGELOG.md section (the release notes).
//   node scripts/changelog-section.js 1.1.0
import { readFileSync } from 'node:fs';
import { sections } from './changelog.js';

const v = process.argv[2];
const body = sections(readFileSync('CHANGELOG.md', 'utf8')).get(v);
if (!body) { console.error(`CHANGELOG.md has no section for ${v}`); process.exit(1); }
console.log(body);
