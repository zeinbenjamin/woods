// Appearance (2.37.0): light, dark or the system's, picked in Settings, kept in
// the settings document, applied to the root's data-theme (the CSS has honoured
// that attribute since 1.0) and copied to localStorage so the next open starts
// in the right mode before the server answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './harness.js';

let app;
before(async () => { app = await startApp({ seed: { clubs: [], courses: [], sessions: [] } }); });
after(() => app && app.stop());
const root = () => app.win.document.documentElement.dataset.theme;

test('System by default: no data-theme, so the CSS follows prefers-color-scheme', () => {
  app.go('settings');
  const chips = app.$$('#appearance [data-act="setTheme"]');
  assert.deepEqual(chips.map(c => [c.dataset.v, c.getAttribute('aria-pressed')]), [['system', 'true'], ['light', 'false'], ['dark', 'false']]);
  assert.equal(root(), undefined);
});

test('Dark sets the root at once, is stored in settings and copied locally; System clears it', async () => {
  app.click('#appearance [data-act="setTheme"][data-v="dark"]');
  assert.equal(root(), 'dark', 'applied before the save lands');
  await app.waitFor(async () => (await app.api.get('settings', 'app') || {}).theme === 'dark', { what: 'saved' });
  assert.equal(app.win.localStorage.getItem('carry.theme'), 'dark');
  assert.equal(app.$('#appearance [data-v="dark"]').getAttribute('aria-pressed'), 'true');
  app.click('#appearance [data-act="setTheme"][data-v="light"]');
  assert.equal(root(), 'light');
  await app.waitFor(async () => (await app.api.get('settings', 'app') || {}).theme === 'light', { what: 'saved' });
  app.click('#appearance [data-act="setTheme"][data-v="system"]');
  assert.equal(root(), undefined);
  await app.waitFor(async () => (await app.api.get('settings', 'app') || {}).theme === 'system', { what: 'saved' });
  assert.equal(app.win.localStorage.getItem('carry.theme'), 'system');
});

test('a setting arriving from the server (another phone) is applied on the next draw; nonsense is System', async () => {
  await app.api.put('settings', 'app', { id: 'app', theme: 'dark' });
  await app.waitFor(() => root() === 'dark', { what: 'poll' });
  await app.api.put('settings', 'app', { id: 'app', theme: 'sepia' });
  await app.waitFor(() => app.E(`settings().theme === 'sepia'`), { what: 'poll' });
  app.go('settings');
  assert.equal(root(), undefined);
  assert.equal(app.$('#appearance [data-v="system"]').getAttribute('aria-pressed'), 'true');
});
