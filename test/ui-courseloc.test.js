// A course's stored location against its map (2.73.0): Randwick's record held
// -33.963, 151.24, typed by hand, 1.8 km from the course; the linked map's
// origin is on the course. Over 300 m apart the course page says so and offers
// the map's location, asked, never changed on its own; close enough, or no map,
// it says nothing. Worked against the real randwick.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, card } from './harness.js';

const [LAT0, LNG0] = JSON.parse(readFileSync('web/course-maps/randwick.json', 'utf8')).origin;
const MAP = { id: 'randwick', linked: '2026-10-01' };
let app;
before(async () => {
  app = await startApp({ seed: { clubs: [], sessions: [], courses: [
    { id: 'c_rw', v: 2, name: 'Randwick Golf Club', suburb: 'Malabar', lat: -33.963, lng: 151.24, holes: card(18), map: MAP, ratings: { red: { cr: 60, slope: 100 } } },
    { id: 'c_near', v: 2, name: 'Randwick Near', lat: +(LAT0 + 0.001).toFixed(4), lng: LNG0, holes: card(18), map: MAP },
    { id: 'c_noloc', v: 2, name: 'Randwick No Location', holes: card(18), map: MAP },
    { id: 'c_nomap', v: 2, name: 'No Map Park', lat: -33.963, lng: 151.24, holes: card(9) },
  ] } });
});
after(() => app && app.stop());

test('1.8 km off: said with the distance, and one tap puts the map\'s location on the record, keeping the rest', async () => {
  app.go('courses', { courseId: 'c_rw' });
  await app.waitFor(() => app.$('#locCheck'), { what: 'the map arriving' });
  assert.match(app.text('#locCheck'), /^This course's stored location is 1\.8 km from the course on its map\. It places the pin/);
  app.click('#locCheck [data-act=useMapLocation]');
  await app.waitFor(async () => (await app.api.get('courses', 'c_rw')).lat !== -33.963, { what: 'saved' });
  const c = await app.api.get('courses', 'c_rw');
  assert.deepEqual([c.lat, c.lng], [+LAT0.toFixed(4), +LNG0.toFixed(4)]);
  assert.equal(c.name, 'Randwick Golf Club'); assert.equal(c.holes.length, 18); assert.deepEqual(c.ratings, { red: { cr: 60, slope: 100 } }); assert.deepEqual(c.map, MAP);
  await app.waitFor(() => !app.$('#locCheck'), { what: 'the notice gone' });
});

test('within 300 m, or no map: nothing said; no location stored: offered', async () => {
  app.go('courses', { courseId: 'c_near' });
  await app.waitFor(() => app.$('#courseMap h2') && !/Loading/.test(app.text('#courseMap')), { what: 'map' });
  assert.equal(app.$('#locCheck'), null, '111 m off is close enough');
  app.go('courses', { courseId: 'c_nomap' });
  assert.equal(app.$('#locCheck'), null, 'no map to compare with');
  app.go('courses', { courseId: 'c_noloc' });
  await app.waitFor(() => app.$('#locCheck'), { what: 'offer' });
  assert.match(app.text('#locCheck'), /^This course has no location stored\./);
  app.click('#locCheck [data-act=useMapLocation]');
  await app.waitFor(async () => (await app.api.get('courses', 'c_noloc')).lat != null, { what: 'saved' });
});

test('the course search (2.73.0): name, suburb and who can play, every word, filtered in place', async () => {
  await app.api.put('courses', 'c_pr', { id: 'c_pr', v: 2, name: 'Cliff Top Club', suburb: 'La Perouse', bookable: false, holes: card(9) });
  await app.waitFor(() => app.E(`!!course('c_pr')`), { what: 'course' });
  app.go('courses');
  assert.match(app.text('#coursesBasis'), /^5 courses · 0 played · 3 with a map$/);
  const shown = () => app.$$('#view .list .item').filter(b => !b.hidden).map(b => b.querySelector('.t').textContent).sort();
  const type = q => { const box = app.$('#courseSearch'); box.value = q; box.dispatchEvent(new app.win.Event('input', { bubbles: true })); };
  type('malabar'); assert.deepEqual(shown(), ['Randwick Golf Club']);
  type('private'); assert.deepEqual(shown(), ['Cliff Top Club']);
  type('randwick near'); assert.deepEqual(shown(), ['Randwick Near']);
  assert.equal(app.$('#courseNoMatch').hidden, true);
  type('zzz'); assert.deepEqual(shown(), []); assert.equal(app.$('#courseNoMatch').hidden, false);
  app.go('courses');   // a redraw keeps what was typed
  assert.equal(app.$('#courseSearch').value, 'zzz'); assert.deepEqual(shown(), []);
  type(''); assert.equal(shown().length, 5);
});
