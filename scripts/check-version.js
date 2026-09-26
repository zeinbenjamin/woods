// CI gate for pull requests: if the PR changes anything that ships in the
// image, it must raise the version and give that version a CHANGELOG entry.
//   node scripts/check-version.js origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareVersions, sections } from './changelog.js';

export const SHIPS = /^(web|server|scripts)\/|^Dockerfile$/;

export function check({ changed, baseVersion, headVersion, changelog }) {
  const shipped = changed.filter(f => SHIPS.test(f));
  if (!shipped.length) return { ok: true, why: 'nothing that ships changed' };
  if (compareVersions(headVersion, baseVersion) <= 0)
    return { ok: false, why: `${shipped.length} shipped file(s) changed (${shipped.slice(0, 3).join(', ')}${shipped.length > 3 ? ', …' : ''}) but the version is still ${headVersion}. Run: npm run release -- patch|minor|major` };
  if (!sections(changelog).get(headVersion))
    return { ok: false, why: `version is ${headVersion} but CHANGELOG.md has no section for it` };
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
