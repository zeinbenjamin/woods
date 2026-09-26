// Cut a release on your branch:
//   npm run release -- minor      (or patch / major)
//
// Bumps the version in package.json and package-lock.json and moves the
// "Unreleased" notes in CHANGELOG.md under the new version. Commit the
// result; when it merges to main, the publish workflow tags v<version>,
// publishes the image as :<version>, and makes the GitHub release.
import { readFileSync, writeFileSync } from 'node:fs';
import { bump, release } from './changelog.js';

const part = process.argv[2];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const next = bump(pkg.version, part);
const today = new Date().toISOString().slice(0, 10);

const log = release(readFileSync('CHANGELOG.md', 'utf8'), next, today);   // throws before anything is written
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
lock.version = next; if (lock.packages && lock.packages['']) lock.packages[''].version = next;
writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
writeFileSync('CHANGELOG.md', log);
console.log(`${pkg.name} ${next} — package.json, package-lock.json and CHANGELOG.md updated. Commit them.`);
