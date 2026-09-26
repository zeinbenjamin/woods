// The version in the app: the label stamped into the page, the version
// sheet behind the title, and "this device is behind the server". The
// server's /api/version is real unless a test swaps in a different answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, club, sleep } from './harness.js';
import { parseChangelog } from '../server/changelog.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const LOG = parseChangelog(readFileSync('CHANGELOG.md', 'utf8'));
let app, versionReply = null, versionCalls = 0;

before(async () => {
  app = await startApp({
    seed: { clubs: [club('7i', 'iron')] },   // the Bag's data section only shows with a bag
    intercept: async url => {
      if (!url.endsWith('/api/version')) return null;
      versionCalls++;
      if (versionReply === 'offline') throw new TypeError('fetch failed');
      if (versionReply) return new Response(JSON.stringify(versionReply), { status: 200, headers: { 'content-type': 'application/json' } });
      return null;                                           // the real server
    },
  });
});
after(() => app && app.stop());

const openVersionSheet = async () => {
  app.click('#brand');
  await app.waitFor(() => !/Checking/.test(app.text('#verStatus')), { what: 'version check' });
};
const newer = { version: '9.9.9', commit: 'abcdef1', changelog: [{ version: '9.9.9', date: '2026-10-01', notes: ['<b>bold</b> & new'] }, ...LOG] };

test('the title shows the version this page was served as, from its own meta tags', () => {
  assert.equal(app.text('#sub'), `v${pkg.version}`);
  assert.equal(app.$('meta[name="app-version"]').content, pkg.version);
  assert.deepEqual(app.J('APP'), { version: pkg.version, commit: 'dev' });
});

test('tapping the title shows the build, "up to date", and the whole history', async () => {
  versionReply = null;
  await openVersionSheet();
  assert.match(app.text('#sheetInner h2'), new RegExp(`Carry ${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(app.text('#sheetInner'), /Build dev/);
  assert.equal(app.text('#verStatus'), 'Up to date with the server.');
  const items = app.$$('#verList > li');
  assert.equal(items.length, LOG.length);
  assert.match(items[0].textContent, /this device/);
  assert.match(items[0].textContent, new RegExp(LOG[0].notes[0].slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(items[1].textContent, /this device/);
  assert.equal(app.$$('#sheetInner [data-save]').length, 0, 'a read-only sheet: Close, no Save');
  app.click('#sheetInner [data-close]');
});

test('when the server is newer, the sheet says this device is behind — and notes are escaped', async () => {
  versionReply = newer;
  await openVersionSheet();
  assert.match(app.text('#verStatus'), new RegExp(`The server has 9\\.9\\.9 \\(build abcdef1\\), but this device is still running ${pkg.version.replace(/\./g, '\\.')}\\. Close the app fully and reopen it to update\\.`));
  const first = app.$('#verList > li');
  assert.match(first.textContent, /<b>bold<\/b> & new/, 'shown as text');
  assert.equal(first.querySelector('ul b'), null, 'not as markup');
  app.click('#sheetInner [data-close]');
});

test('on startup a device that is behind gets a toast that stays up long enough to read', async () => {
  versionReply = newer;
  app.E('lastUpdateCheck = 0');
  await app.E('checkForUpdate()');
  assert.equal(app.toast(), 'Version 9.9.9 is ready. Close and reopen the app to update.');
  await sleep(2500);
  assert.ok(app.$('#toast').classList.contains('show'), 'still showing after 2.5s');
});

test('coming back to the foreground checks again, at most every ten minutes', async () => {
  versionReply = newer;
  app.E('lastUpdateCheck = 0');
  versionCalls = 0;
  app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
  await app.waitFor(() => versionCalls === 1, { what: 'check on resume' });
  app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
  await sleep(100);
  assert.equal(versionCalls, 1, 'throttled');
});

test('same version rebuilt from another commit counts as behind; dev builds are never compared by commit', () => {
  const stale = (appCommit, info) => app.E(`(() => { const was = APP.commit; APP.commit = ${JSON.stringify(appCommit)};
    try { return isStale(${JSON.stringify(info)}); } finally { APP.commit = was; } })()`);
  const v = pkg.version;
  assert.equal(stale('aaaaaaa', { version: v, commit: 'bbbbbbb' }), true, 'forgot to bump');
  assert.equal(stale('aaaaaaa', { version: v, commit: 'aaaaaaa' }), false);
  assert.equal(stale('aaaaaaa', { version: v, commit: 'dev' }), false, 'server is a dev build');
  assert.equal(stale('dev', { version: v, commit: 'bbbbbbb' }), false, 'this page is a dev build');
  assert.equal(stale('dev', { version: '0.0.1', commit: 'dev' }), true, 'a different version always counts');
  assert.equal(app.E('isStale(null)'), false);
});

test('offline, the sheet says it could not check rather than guessing', async () => {
  versionReply = 'offline';
  await openVersionSheet();
  assert.equal(app.text('#verStatus'), "Couldn't reach the server, so I can't check for a newer version.");
  app.click('#sheetInner [data-close]');
  versionReply = null;
});

test('the Bag screen names the build; exports record the version that made them', async () => {
  app.go('bag');
  assert.equal(app.text('#about'), `Carry ${pkg.version}, build dev. Tap the title for what's changed.`);
  const data = await app.win.eval(`buildExport({ withImages: false })`);
  assert.equal(data.appVersion, pkg.version);
});
