// Versioning: the changelog parser, the release script (run for real in a
// scratch directory), the pull-request gate, and the invariant that the
// version in package.json always has a CHANGELOG entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sections, bump, compareVersions, release, parseVersion } from '../scripts/changelog.js';
import { check, SHIPS } from '../scripts/check-version.js';

const LOG = `# Changelog

## [Unreleased]

### Added
- a thing

## [1.2.3] - 2026-01-02

- older thing
`;

test('package.json carries a semver version, and CHANGELOG.md has a section for it', () => {
  const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
  assert.doesNotThrow(() => parseVersion(v));
  assert.ok(sections(readFileSync('CHANGELOG.md', 'utf8')).get(v), `no CHANGELOG section for ${v}`);
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(lock.version, v, 'package-lock.json agrees');
  assert.equal(lock.packages[''].version, v);
});

test('versions bump and compare numerically, not as strings', () => {
  assert.equal(bump('1.9.9', 'patch'), '1.9.10');
  assert.equal(bump('1.9.9', 'minor'), '1.10.0');
  assert.equal(bump('1.9.9', 'major'), '2.0.0');
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.throws(() => bump('1.2.3', 'huge'), /major, minor or patch/);
  assert.throws(() => parseVersion('v1.2'), /not a version/);
});

test('the changelog parser finds each section by its heading', () => {
  const s = sections(LOG);
  assert.deepEqual([...s.keys()], ['Unreleased', '1.2.3']);
  assert.equal(s.get('Unreleased'), '### Added\n- a thing');
  assert.equal(s.get('1.2.3'), '- older thing');
});

test('releasing moves the Unreleased notes under the new version, and refuses an empty one', () => {
  const out = release(LOG, '1.3.0', '2026-09-26');
  const s = sections(out);
  assert.equal(s.get('Unreleased'), '');
  assert.equal(s.get('1.3.0'), '### Added\n- a thing');
  assert.ok(out.includes('## [Unreleased]\n\n## [1.3.0] - 2026-09-26\n\n### Added\n- a thing'), out);
  assert.throws(() => release(out, '1.3.1', '2026-09-27'), /Nothing under/);
  assert.throws(() => release(LOG, '1.2.3', '2026-09-27'), /already has 1\.2\.3/);
});

test('npm run release bumps package.json, the lockfile and the changelog together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-release-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'carry', version: '1.2.3' }, null, 2));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'carry', version: '1.2.3', packages: { '': { version: '1.2.3' } } }, null, 2));
    writeFileSync(join(dir, 'CHANGELOG.md'), LOG);
    const script = resolve('scripts/release.js');
    execFileSync('node', [script, 'minor'], { cwd: dir, encoding: 'utf8' });
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.3.0');
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    assert.deepEqual([lock.version, lock.packages[''].version], ['1.3.0', '1.3.0']);
    assert.equal(sections(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).get('1.3.0'), '### Added\n- a thing');
    // Nothing new under Unreleased: refuses, and writes nothing.
    const again = spawnSync('node', [script, 'patch'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.3.0', 'untouched after a refusal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the release notes script prints one version\'s section, and fails for a missing one', () => {
  const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const out = execFileSync('node', ['scripts/changelog-section.js', v], { encoding: 'utf8' });
  assert.ok(out.trim().length > 0);
  assert.doesNotMatch(out, /^## \[/m, 'body only, no headings of other versions');
  assert.notEqual(spawnSync('node', ['scripts/changelog-section.js', '0.0.1']).status, 0);
});

test('the PR gate: shipped changes need a higher version with a changelog entry', () => {
  const log = release(LOG, '1.3.0', '2026-09-26');
  assert.equal(check({ changed: ['README.md', 'test/x.test.js', 'deploy/truenas-compose.yml'], baseVersion: '1.2.3', headVersion: '1.2.3', changelog: LOG }).ok, true, 'docs, tests and deploy config need no bump');
  const same = check({ changed: ['web/index.html'], baseVersion: '1.2.3', headVersion: '1.2.3', changelog: LOG });
  assert.equal(same.ok, false);
  assert.match(same.why, /npm run release/);
  assert.equal(check({ changed: ['server/index.js'], baseVersion: '1.2.3', headVersion: '1.3.0', changelog: LOG }).ok, false, 'bumped but undocumented');
  assert.equal(check({ changed: ['server/index.js'], baseVersion: '1.2.3', headVersion: '1.3.0', changelog: log }).ok, true);
  assert.equal(check({ changed: ['Dockerfile'], baseVersion: '1.3.0', headVersion: '1.2.9', changelog: log }).ok, false, 'going backwards fails');
  assert.ok(['web/platform.js', 'server/db.js', 'scripts/release.js', 'Dockerfile'].every(f => SHIPS.test(f)));
});
