// Courses on a map (2.44.0): the Courses list's one row (the sort, the map,
// where distances are from), and the map: a pin per course with a location,
// coloured by who can play, home, a pin's course page, the courses it can't
// place, and the map kept across a redraw (where he panned, a pin he opened).
// Leaflet is the real file the page loads (web/vendor/leaflet); jsdom doesn't
// fetch scripts a page adds, so the test puts it on the page first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, card } from './harness.js';

const HOME = { label: 'Home', lat: -33.93, lng: 151.13 };
const courses = [
  { id: 'c_pub', v: 2, name: 'Public <GC>', suburb: 'Bexley', lat: -33.95, lng: 151.12, bookable: true, holes: card(9) },
  { id: 'c_priv', v: 2, name: 'Members GC', lat: -33.85, lng: 151.2, bookable: false, holes: card(9) },
  { id: 'c_shut', v: 2, name: 'Shut GC', lat: -33.97, lng: 151.15, closed: true, holes: card(9) },
  { id: 'c_nowhere', v: 2, name: 'Nowhere GC', holes: card(9) },
];
let app;
before(async () => {
  app = await startApp({ seed: { courses, settings: { home: HOME } } });
  // jsdom has no SVG geometry; Leaflet only asks whether createSVGRect exists before drawing pins as SVG.
  app.win.SVGSVGElement.prototype.createSVGRect ||= () => ({});
  app.win.eval(readFileSync(new URL('../web/vendor/leaflet/leaflet.js', import.meta.url), 'utf8'));
});
after(() => app && app.stop());

test('the sort, the map and where distances are from share one row, the location on the right', () => {
  app.go('courses');
  const bar = app.$('.courseBar');
  assert.deepEqual([...bar.children].map(e => e.id), ['courseSort', 'cmOpen', 'homeLink']);
  assert.match(app.text('#homeLink'), /Distances from Home — change/);
  assert.match(app.win.document.querySelector('style').textContent, /\.courseBar #homeLink \{ margin-left: auto;/, 'pushed to the right');
  assert.equal(app.$('#cmOpen').getAttribute('aria-label'), 'View on a map');
});

test('the map: a pin per placed course coloured by who can play, home, and the courses it can\'t place', async () => {
  app.click('#cmOpen');
  assert.equal(app.J('S.sub').view, 'map');
  await app.waitFor(() => app.E('cm.layer && cm.layer.getLayers().length'), { what: 'pins on the map' });
  const pins = app.J(`cm.layer.getLayers().filter(l => l.options.fillColor).map(l => [l.getLatLng().lat, l.options.fillColor])`);
  const css = n => app.E(`cmVar('${n}')`);
  assert.deepEqual(pins.sort(), [[-33.97, css('--flag')], [-33.95, css('--green')], [-33.85, css('--ink-3')]].sort());
  assert.equal(app.E(`cm.layer.getLayers().filter(l => !l.options.fillColor).length`), 1, 'home');
  assert.match(app.text('#cmCount'), /3 courses, and Home/);
  assert.match(app.text('#cmMissing'), /1 course with no location on its card isn't on the map/);
  const pop = app.E(`cmPopup(course('c_pub'))`);
  assert.match(pop, /Public &lt;GC&gt;/, 'names are escaped');
  assert.match(pop, /Bexley · 2\.\d km away/);
  assert.match(pop, /data-go="courses:courseId:c_pub"/);
});

test('tiles are OpenStreetMap\'s own, which need no key; dark mode darkens them, not the pins', async () => {
  // 2.44.1: CARTO's basemap answered every tile with "API key required".
  assert.equal(app.E('cm.tiles._url'), 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(app.E('cm.map.attributionControl.getContainer().textContent'), /OpenStreetMap contributors/);
  assert.match(app.win.document.querySelector('style').textContent, /#cmMap\.dark \.leaflet-tile-pane \{ filter: invert\(1\)/);
  await app.E(`ACTIONS.setTheme({ v: 'dark' })`); app.E('render()');
  assert.ok(app.$('#cmMap').classList.contains('dark'), 'dark tiles');
  await app.E(`ACTIONS.setTheme({ v: 'light' })`); app.E('render()');
  assert.ok(!app.$('#cmMap').classList.contains('dark'), 'light again');
  await app.E(`ACTIONS.setTheme({ v: 'system' })`);
});

test('a redraw keeps the map, where it was panned and the pin opened; a pin opens its course', async () => {
  app.E(`cm.map.setView([-33.9, 151.1], 14)`);
  const el = app.$('#cmMap');
  app.E(`cm.layer.getLayers().find(l => l.options.fillColor === cmVar('--green')).openPopup()`);
  app.E('render()');
  assert.equal(app.$('#cmMap'), el, 'the same map element, not a new one');
  assert.equal(app.E('cm.map.getZoom()'), 14);
  const b = app.$('.leaflet-popup [data-go]');
  assert.ok(b, 'the open pin survived the redraw');
  b.click();
  assert.deepEqual(app.J('S.sub'), { courseId: 'c_pub' });
});

test('no course with a location: no map button', async () => {
  await app.api.put('courses', 'c_pub', { ...courses[0], lat: undefined, lng: undefined });
  await app.api.put('courses', 'c_priv', { ...courses[1], lat: undefined, lng: undefined });
  await app.api.put('courses', 'c_shut', { ...courses[2], lat: undefined, lng: undefined });
  app.go('courses');
  await app.waitFor(() => !app.$('#cmOpen'), { what: 'no map button' });
  assert.ok(app.$('#homeLink'));
});
