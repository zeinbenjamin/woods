// Courses on a map, drawn as a yardage book (2.49.0): OpenFreeMap's vector
// tiles through MapLibre with Carry's own style. jsdom has no WebGL, so the
// style is checked as data (what's drawn, what's left out, the palette, the
// theme) and the map code runs against a stand-in MapLibre that records what
// it was asked to do. The real drawing was checked in Chromium with WebGL
// against hand-made tiles; OpenFreeMap itself can't be reached from here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, card } from './harness.js';

const courses = [
  { id: 'c_pub', v: 2, name: 'Public <GC>', lat: -33.95, lng: 151.12, bookable: true, holes: card(9) },
  { id: 'c_priv', v: 2, name: 'Members GC', lat: -33.85, lng: 151.2, bookable: false, holes: card(9) },
];
let app, made;
before(async () => {
  app = await startApp({ seed: { courses, settings: { home: { label: 'Home', lat: -33.93, lng: 151.13 } } } });
  // A stand-in MapLibre: records maps, layers' handlers, markers and popups.
  made = { maps: [], markers: [], popups: [] };
  app.win.eval(`window.maplibregl = (() => {
    class Map { constructor(o) { this.o = o; this.images = {}; this.handlers = {}; this.data = null; this.removed = false; this.zoom = o.zoom; this.center = o.center; window.__made.maps.push(this); }
      addControl() {} addImage(id, img) { this.images[id] = img; } hasImage(id) { return !!this.images[id]; }
      on(ev, layer, fn) { (this.handlers[ev + ':' + (fn ? layer : '')] = fn || layer); }
      getSource(id) { return id === 'courses' ? { setData: d => { this.data = d; } } : null; }
      fitBounds(b) { this.fitted = b; } jumpTo(v) { Object.assign(this, v); } resize() { this.resized = (this.resized || 0) + 1; }
      getCenter() { return this.center; } getZoom() { return this.zoom; } getCanvas() { return { style: {} }; } remove() { this.removed = true; } }
    class Marker { constructor(o) { this.el = o.element; window.__made.markers.push(this); } setLngLat(p) { this.at = p; return this; } addTo() { return this; } remove() { this.gone = true; } }
    class Popup { constructor() { window.__made.popups.push(this); } setLngLat(p) { this.at = p; return this; } setHTML(h) { this.el = document.createElement('div'); this.el.innerHTML = h; return this; } addTo() { return this; } getElement() { return this.el; } }
    class NavigationControl {}
    return { Map, Marker, Popup, NavigationControl };
  })();`);
  app.win.__made = made;
  app.E('cmWebGL = () => true');
});
after(() => app && app.stop());

const style = dark => app.J(`cmStyle(cmVar, ${dark})`);
const plain = x => JSON.parse(JSON.stringify(x));   // the page's objects come from another realm

test('the style: OpenFreeMap\'s tiles, the yardage-book layers, and the clutter left out', () => {
  const s = style(false);
  assert.equal(s.sources.ofm.url, 'https://tiles.openfreemap.org/planet');
  assert.match(s.sources.ofm.attribution, /OpenFreeMap.*OpenMapTiles.*OpenStreetMap/);
  assert.equal(s.glyphs, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
  const used = new Set(s.layers.map(l => l['source-layer']).filter(Boolean));
  for (const gone of ['building', 'boundary', 'aeroway', 'aerodrome_label', 'transportation_name', 'water_name']) assert.ok(!used.has(gone), `no ${gone}`);
  const byId = Object.fromEntries(s.layers.map(l => [l.id, l]));
  assert.deepEqual(['cm-road-motor', 'cm-road-main', 'cm-road-minor'].map(id => [byId[id].minzoom, byId[id].filter[2]]),
    [[8, ['motorway', 'trunk']], [11, ['primary', 'secondary']], [13, ['tertiary']]], 'main roads only, and only as he zooms in; never minor streets');
  assert.equal(byId['cm-ground'].paint['background-pattern'], 'cm-l-hatch', 'parchment with hatching');
  assert.equal(byId['cm-water'].paint['fill-pattern'], 'cm-l-wave');
  assert.equal(byId['cm-park'].paint['fill-pattern'], 'cm-l-stipple');
  assert.deepEqual(byId['cm-golf'].filter, ['==', ['get', 'subclass'], 'golf_course'], 'golf courses picked out');
  assert.equal(byId['cm-golf'].paint['fill-color'], app.E(`cmVar('--hm-fw')`), "in the hole maps' fairway colour");
  assert.equal(byId['cm-shore'].paint['line-color'], app.E(`cmVar('--hm-ink')`), 'an inked shoreline');
  assert.deepEqual(s.layers.filter(l => l.type === 'symbol').map(l => [l.id, l.filter[2]]), [['cm-name-suburb', ['suburb', 'town', 'village']], ['cm-name-city', ['city']]], 'only place names');
  assert.equal(s.layers[s.layers.length - 1].id, 'cm-courses', 'the pins on top');
  assert.equal(style(true).layers[0].paint['background-pattern'], 'cm-d-hatch', 'dark mode has its own textures');
});

test('the map: made with the style, pins as data, home a marker, a pin opening its course', () => {
  app.go('courses', { view: 'map' });
  return app.waitFor(() => made.maps.length === 1 && app.E('cm.kind') === 'gl', { what: 'the GL map' }).then(() => {
    const m = made.maps[0];
    assert.equal(m.o.style.sources.ofm.url, 'https://tiles.openfreemap.org/planet');
    assert.equal(m.o.dragRotate, false, 'north stays up, as on the hole maps');
    const pins = m.o.style.sources.courses.data.features;
    assert.deepEqual(plain(pins.map(f => f.properties.id).sort()), ['c_priv', 'c_pub']);
    assert.equal(pins.find(f => f.properties.id === 'c_pub').properties.fill, app.E(`cmVar('--green')`));
    assert.deepEqual(plain(made.markers[0].at), [151.13, -33.93], 'home');
    assert.ok(m.fitted, 'fitted to the courses and home');
    m.handlers['click:cm-courses']({ features: [{ properties: { id: 'c_pub' }, geometry: { coordinates: [151.12, -33.95] } }] });
    const pop = made.popups[0];
    assert.match(pop.el.textContent, /Public <GC>/, 'the name, escaped as text');
    pop.el.querySelector('[data-go]').click();
    assert.deepEqual(app.J('S.sub'), { courseId: 'c_pub' });
  });
});

test('a redraw keeps the map; new courses go in as data; another theme makes it again where it was', async () => {
  app.go('courses', { view: 'map' });
  const m = made.maps[0];
  assert.equal(made.maps.length, 1, 'the same map, put back'); assert.ok(m.resized >= 1);
  await app.api.put('courses', 'c_new', { id: 'c_new', v: 2, name: 'New GC', lat: -33.9, lng: 151.0, holes: card(9) });
  await app.waitFor(() => m.data && m.data.features.length === 3, { what: 'the new course as data' });
  assert.equal(made.maps.length, 1, 'no new map for new data');
  m.zoom = 12.5; m.center = [151.2, -33.9];
  await app.E(`ACTIONS.setTheme({ v: 'dark' })`);
  await app.waitFor(() => made.maps.length === 2, { what: 'made again for dark' });
  assert.ok(m.removed, 'the light one removed');
  assert.deepEqual(plain([made.maps[1].o.zoom, made.maps[1].o.center]), [12.5, [151.2, -33.9]], 'where he was');
  assert.equal(made.maps[1].o.style.layers[0].paint['background-pattern'], 'cm-d-hatch');
  await app.E(`ACTIONS.setTheme({ v: 'system' })`);
});
