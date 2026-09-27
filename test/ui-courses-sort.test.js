// Sorting the Courses list: closest, recently added, A–Z. Closest is the
// default when his location is set; otherwise recently added.
//
// Courses (synthetic):
//   Zeta Park   hand-made id (no date)            ~1 km from home
//   Alpha GC    app-made id from 10 days ago      ~20 km
//   Mid Links   created stamp from 1 day ago      no coordinates
//   Bravo       12-letter hand-made id, no digit  no coordinates  (must not decode to a date)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, card } from './harness.js';

const HOME = { label: 'Home', lat: -33.87, lng: 151.21 };
const ago = d => Date.now() - d * 864e5;
const appId = t => 'c_' + t.toString(36) + '7k2q';
const courses = [
  { id: 'c_zeta', v: 2, name: 'Zeta Park', lat: HOME.lat + 0.009, lng: HOME.lng, holes: card(9) },
  { id: appId(ago(10)), v: 2, name: 'Alpha GC', lat: HOME.lat + 0.18, lng: HOME.lng, holes: card(9) },
  { id: 'c_mid', v: 2, name: 'Mid Links', created: ago(1), holes: card(9) },
  { id: 'c_lanecovegcsy', v: 2, name: 'Bravo', holes: card(9) },
];
const names = app => app.$$('#view .list .item .t').map(e => e.textContent);

let app;
before(async () => { app = await startApp({ seed: { courses } }); });
after(() => app && app.stop());

test('without a location: recently added first, courses with no known date last A–Z, and no Closest option', () => {
  app.go('courses');
  assert.deepEqual(names(app), ['Mid Links', 'Alpha GC', 'Bravo', 'Zeta Park']);
  assert.equal(app.$('#courseSort [aria-pressed="true"]').dataset.v, 'recent');
  assert.equal(app.$('#courseSort [data-v="near"]'), null);
  assert.match(app.text('#courseSortNote'), /2 courses added before the app kept the date are listed last, A–Z/);
});

test('when a course was added: its stamp, the time inside an app-made id, or unknown', () => {
  assert.equal(app.E(`addedAt(course('c_mid'))`), courses[2].created);
  assert.equal(app.E(`addedAt(course('${courses[1].id}'))`), parseInt(courses[1].id.slice(2, -4), 36));
  assert.equal(app.E(`addedAt(course('c_zeta'))`), null);
  assert.equal(app.E(`addedAt(course('c_lanecovegcsy'))`), null, 'a word-like id of the right length is not read as a date');
  // A fresh uid() decodes to now, unless (about 1 in 50) it happens to have no
  // digit: then it is undated, never misdated. Checked deterministically, since a
  // random id made this test fail 1 run in 50 (the 1.7.0 publish).
  const at = t => app.E(`addedAt({ id: 'c_${t.toString(36)}' + ${JSON.stringify(t.toString(36).match(/\d/) ? 'abcd' : 'ab1d')} })`);
  const now = Date.now();
  assert.equal(at(now), now, 'an id made now decodes to now');
  const ids = app.J(`Array.from({ length: 200 }, () => uid('c'))`);
  for (const id of ids) { const t = app.E(`addedAt({ id: ${JSON.stringify(id)} })`); assert.ok(t === null ? !/\d/.test(id) : Math.abs(t - now) < 60000, id); }
  assert.equal(app.E(`addedAt({ id: 'c_' + Date.now().toString(36).replace(/[0-9]/g, 'a') + 'wxyz' })`), null, 'no digit at all: undated');
});

test('with a location set: closest by default, courses without coordinates last A–Z', async () => {
  await app.api.put('settings', 'app', { id: 'app', home: HOME });
  await app.waitFor(() => app.E(`!!home()`), { what: 'home set' });
  app.go('courses');
  assert.deepEqual(names(app), ['Zeta Park', 'Alpha GC', 'Bravo', 'Mid Links']);
  assert.equal(app.$('#courseSort [aria-pressed="true"]').dataset.v, 'near');
  assert.match(app.text('#courseSortNote'), /2 courses with no location on their card are listed last, A–Z/);
});

test('a chosen order is kept', async () => {
  app.click('#courseSort [data-v="az"]');
  await app.waitFor(async () => (await app.api.get('settings', 'app')).courseSort === 'az', { what: 'saved' });
  app.go('overview'); app.go('courses');
  assert.deepEqual(names(app), ['Alpha GC', 'Bravo', 'Mid Links', 'Zeta Park']);
  assert.equal(app.$('#courseSortNote'), null);
  app.click('#courseSort [data-v="recent"]');
  await app.waitFor(async () => (await app.api.get('settings', 'app')).courseSort === 'recent', { what: 'saved' });
  assert.deepEqual(names(app), ['Mid Links', 'Alpha GC', 'Bravo', 'Zeta Park']);
});

test('a course added now is stamped and goes to the top of Recently added', async () => {
  app.click('#view [data-act="newCourse"]');
  app.fill('name', 'New Muni');
  app.$('#sheetInner [data-holes="9"]').click();
  for (let i = 1; i <= 9; i++) app.fill(`par_${i}`, '4');
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`S.courses.some(c => c.name === 'New Muni')`), { what: 'saved' });
  app.go('courses');   // saving opens the new course's page
  assert.equal(names(app)[0], 'New Muni');
  const saved = app.J(`S.courses.find(c => c.name === 'New Muni')`);
  assert.ok(Math.abs(saved.created - Date.now()) < 60000);
});
