// What's running. The version is package.json's — the one number a release
// bumps. The commit and build time are baked in by the image build
// (CARRY_COMMIT / CARRY_BUILT); outside an image, git is asked instead.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function gitCommit() {
  try { return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
  catch { return null; }
}

export const VERSION = Object.freeze({
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  commit: (process.env.CARRY_COMMIT || '').slice(0, 7) || gitCommit(),
  built: process.env.CARRY_BUILT || null,
});
