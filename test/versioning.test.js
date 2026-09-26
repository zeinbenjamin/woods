// Versioning: the changelog format the app parses, the version/changelog
// agreement CI enforces, the pull-request gate, and the release notes script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseChangelog, malformedHeadings, compareVersions, parseVersion } from '../server/changelog.js';
import { check, SHIPS } from '../scripts/check-version.js';

const LOG = `# Changelog

Intro text the parser ignores.
- including bullets before the first version

## 1.3.0 — 2026-09-26
- New: a thing.
- A fix, said plainly.

## 1.2.9 -- 2026-09-20
- Hyphens work as the dash too.
`;
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('package.json, the lockfile and the top of CHANGELOG.md all name the same version', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.deepEqual([lock.version, lock.packages[''].version], [pkg.version, pkg.version]);
  const log = readFileSync('CHANGELOG.md', 'utf8');
  const top = parseChangelog(log)[0];
  assert.equal(top.version, pkg.version);
  assert.ok(top.notes.length, 'with notes');
  assert.deepEqual(malformedHeadings(log), [], 'every heading parses');
});

test('CHANGELOG.md is newest first, one entry per version, backfilled to 1.0.0', () => {
  const vs = parseChangelog(readFileSync('CHANGELOG.md', 'utf8')).map(e => e.version);
  assert.equal(vs.at(-1), '1.0.0');
  assert.equal(new Set(vs).size, vs.length, 'no version twice');
  for (let i = 1; i < vs.length; i++) assert.ok(compareVersions(vs[i - 1], vs[i]) > 0, `${vs[i - 1]} before ${vs[i]}`);
});

test('the parser reads the exact format and ignores the intro', () => {
  assert.deepEqual(parseChangelog(LOG), [
    { version: '1.3.0', date: '2026-09-26', notes: ['New: a thing.', 'A fix, said plainly.'] },
    { version: '1.2.9', date: '2026-09-20', notes: ['Hyphens work as the dash too.'] },
  ]);
  assert.deepEqual(malformedHeadings('## 1.4.0\n## [1.4.0] - 2026-01-01\n## 1.4.0 — 2026-01-01'), ['## 1.4.0', '## [1.4.0] - 2026-01-01']);
});

test('versions are three numbers compared numerically; a pre-release comes before its release', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.14.0-alpha', '1.14.0') < 0);
  assert.ok(compareVersions('1.14.0-alpha', '1.13.9') > 0);
  assert.throws(() => parseVersion('1.13'), /not a version/, 'never two numbers');
  assert.throws(() => parseVersion('v1.2.3'), /not a version/);
});

test('the PR gate: shipped changes need a higher version that opens the changelog', () => {
  const base = { baseVersion: '1.2.9', changelog: LOG };
  assert.equal(check({ ...base, changed: ['README.md', 'test/x.test.js', 'deploy/truenas-compose.yml', 'CHANGELOG.md'], headVersion: '1.2.9' }).ok, true, 'docs, tests and deploy need no bump');
  const same = check({ ...base, changed: ['web/index.html'], headVersion: '1.2.9' });
  assert.equal(same.ok, false);
  assert.match(same.why, /npm version <x\.y\.z> --no-git-tag-version/);
  assert.equal(check({ ...base, changed: ['server/index.js'], headVersion: '1.3.0' }).ok, true);
  assert.match(check({ ...base, changed: ['server/index.js'], headVersion: '1.3.1' }).why, /must open with "## 1\.3\.1/, 'bumped but not written up');
  assert.equal(check({ ...base, changed: ['Dockerfile'], baseVersion: '1.3.0', headVersion: '1.2.9' }).ok, false, 'backwards');
  assert.match(check({ ...base, changed: [], headVersion: '1.2.9', changelog: '## 1.3.0\n- x' }).why, /can't parse/, 'a malformed heading fails even without code changes');
  assert.ok(['web/platform.js', 'server/db.js', 'scripts/check-version.js', 'Dockerfile'].every(f => SHIPS.test(f)));
});

test('the release notes are that version\'s bullets, and a missing version fails', () => {
  const out = execFileSync('node', ['scripts/changelog-section.js', pkg.version], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(out.length > 0 && out.every(l => l.startsWith('- ')));
  assert.notEqual(spawnSync('node', ['scripts/changelog-section.js', '0.0.1']).status, 0);
});
