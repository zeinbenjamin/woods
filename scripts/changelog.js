// CHANGELOG.md, in the Keep a Changelog shape:
//
//   ## [Unreleased]
//   ...what's on main but not released yet...
//
//   ## [1.1.0] - 2026-09-26
//   ...
//
// Shared by release.js, check-version.js and changelog-section.js.
export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return m.slice(1).map(Number);
}
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
export function bump(v, part) {
  const [M, m, p] = parseVersion(v);
  if (part === 'major') return `${M + 1}.0.0`;
  if (part === 'minor') return `${M}.${m + 1}.0`;
  if (part === 'patch') return `${M}.${m}.${p + 1}`;
  throw new Error(`bump what? major, minor or patch — got ${part}`);
}

// Sections keyed by heading: 'Unreleased' or a version. Body is trimmed.
export function sections(md) {
  const out = new Map(); let key = null, body = [];
  const flush = () => { if (key) out.set(key, body.join('\n').trim()); };
  for (const line of md.split('\n')) {
    const h = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (h) { flush(); key = h[1]; body = []; continue; }
    if (key) body.push(line);
  }
  flush();
  return out;
}

// Move everything under Unreleased into a new version section.
export function release(md, version, date) {
  const s = sections(md);
  if (!s.has('Unreleased')) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (!s.get('Unreleased')) throw new Error('Nothing under "## [Unreleased]" — write what changed first');
  if (s.has(version)) throw new Error(`CHANGELOG.md already has ${version}`);
  return md.replace(/^## \[Unreleased\][ \t]*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`);
}
