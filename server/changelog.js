// CHANGELOG.md, in the one format the app shows:
//
//   ## 1.4.0 — 2026-09-24
//   - New: something he'll notice.
//   - A fix, said the way he'd describe it.
//
// A heading is "## ", the version, an em dash (or hyphens), and an ISO date;
// notes are "- " bullets, one line each. Anything else (the intro) is
// ignored. Shared by the server (in-app history) and the release scripts.
export const HEADING = /^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+[—-]+\s+(\d{4}-\d{2}-\d{2})\s*$/;
export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseChangelog(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const h = HEADING.exec(line);
    if (h) { out.push({ version: h[1], date: h[2], notes: [] }); continue; }
    const b = /^-\s+(.+)/.exec(line);
    if (b && out.length) out[out.length - 1].notes.push(b[1].trim());
  }
  return out;
}

// "## " lines that look like a release but don't parse: the app would drop them.
export const malformedHeadings = text => String(text || '').split('\n')
  .filter(l => /^##\s/.test(l) && !HEADING.test(l));

export function parseVersion(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return { nums: m.slice(1, 4).map(Number), pre: m[4] || null };
}
// Numeric per part; a pre-release (1.4.0-alpha) sorts before its release.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
