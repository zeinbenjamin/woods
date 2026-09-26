// CI gate for pull requests. Every change that ships to the app gets a new
// version: if the PR changes anything in the image, the version must go up
// and CHANGELOG.md must open with that version's entry.
//   node scripts/check-version.js origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareVersions, parseChangelog, malformedHeadings } from '../server/changelog.js';

export const SHIPS = /^(web|server|scripts)\/|^Dockerfile$/;

export function check({ changed, baseVersion, headVersion, changelog }) {
  const bad = malformedHeadings(changelog);
  if (bad.length) return { ok: false, why: `CHANGELOG.md heading(s) the app can't parse: ${bad.join(' | ')} — use "## x.y.z — YYYY-MM-DD"` };
  const shipped = changed.filter(f => SHIPS.test(f));
  if (!shipped.length) return { ok: true, why: 'nothing that ships changed' };
  if (compareVersions(headVersion, baseVersion) <= 0)
    return { ok: false, why: `${shipped.length} shipped file(s) changed (${shipped.slice(0, 3).join(', ')}${shipped.length > 3 ? ', …' : ''}) but the version is still ${headVersion}. Bump it: npm version <x.y.z> --no-git-tag-version` };
  const top = parseChangelog(changelog)[0];
  if (!top || top.version !== headVersion) return { ok: false, why: `CHANGELOG.md must open with "## ${headVersion} — <date>" (it opens with ${top ? top.version : 'nothing'})` };
  if (!top.notes.length) return { ok: false, why: `CHANGELOG.md entry for ${headVersion} has no "- " notes` };
  return { ok: true, why: `${baseVersion} → ${headVersion}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] || 'origin/main';
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
  const r = check({
    changed: git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean),
    baseVersion: JSON.parse(git('show', `${base}:package.json`)).version,
    headVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    changelog: readFileSync('CHANGELOG.md', 'utf8'),
  });
  console.log(`${r.ok ? 'ok' : 'FAIL'}: ${r.why}`);
  process.exit(r.ok ? 0 : 1);
}
