// What's running: the version from package.json, the commit the image was
// built from (APP_COMMIT, passed in by the Actions build; "dev" for a local
// run), and the version history from CHANGELOG.md. Read once at startup.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from './changelog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
export const COMMIT = (process.env.APP_COMMIT || 'dev').slice(0, 7);
export const CHANGELOG = (() => {
  try { return parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')); } catch { return []; }
})();
