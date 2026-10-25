// Artwork → map (2.16.x): rounds traced on a hole's uploaded picture move
// onto the course map once it has the hole. Checked against hand-worked
// geometry on a straight hole and a dogleg, then end to end on the real
// Hunter Valley map file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

let app;
before(async () => { app = await startApp({ seed: { clubs: [club('7i', 'iron'), club('D', 'driver')] } }); });
after(() => app && app.stop());

// A straight 400 m hole: artwork tee (50, 900) → green (50, 100), 800 px, so 0.5 m a pixel;
// map line from (0, 0) north to (0, 400). y is down in pixels and up in metres.
const straight = { n: 1, par: 4, metres: 400, art: { asset: 'a', w: 100, h: 1000, tee: [50, 900], green: [50, 100], gr: 30 }, hm: { pl: [[0, 0], [0, 400]] } };

test('a shot halfway up the picture, 30 px right of the line, lands halfway up the map line 15 m to the right', () => {
  const out = app.J(`artShotToMap(${JSON.stringify(straight)}, { x: 80, y: 500, club: '7i', lie: 'rough', penalty: true })`);
  assert.deepEqual(out, { mx: 15, my: 200, club: '7i', lie: 'rough', penalty: true, approx: true, art: { x: 80, y: 500 } });
  // Left of the line, near the green.
  assert.deepEqual(app.J(`artShotToMap(${JSON.stringify(straight)}, { x: 30, y: 140, club: '7i' })`), { mx: -10, my: 380, club: '7i', approx: true, art: { x: 30, y: 140 } });
  assert.equal(app.J(`artShotToMap(${JSON.stringify({ ...straight, hm: null })}, { x: 80, y: 500 })`), null, 'no map line, no move');
  assert.equal(app.J(`artShotToMap(${JSON.stringify(straight)}, { t: 0.5, u: 0 })`), null, 'not an art shot');
});

test('on a dogleg, the fraction follows the bent line and the map line alike', () => {
  // Art: tee (0, 1000) up to the turn (0, 600) then right to the green (400, 600): 800 px for 400 m.
  // Map: tee (0, 0) north to (0, 200) then east to (200, 200).
  const dog = { n: 2, par: 4, metres: 400, art: { asset: 'a', w: 500, h: 1100, tee: [0, 1000], turn: [0, 600], green: [400, 600], gr: 30 }, hm: { pl: [[0, 0], [0, 200], [200, 200]] } };
  // Three quarters along: 200 px past the turn, 20 px below the second leg (right of travel when heading right, y down).
  const out = app.J(`artShotToMap(${JSON.stringify(dog)}, { x: 200, y: 620, club: 'D' })`);
  assert.deepEqual([out.mx, out.my], [100, 190], '100 m along the second leg, 10 m to the right (south) of it');
});

test('on the course page, rounds on artwork can be moved onto the real Hunter Valley map, and distances then come from it', async () => {
  const fs = await import('node:fs');
  const m = JSON.parse(fs.readFileSync('web/course-maps/hunter-valley.json', 'utf8')), line = m.holes.find(h => h.n === 1).line;
  // Artwork for hole 1: a straight picture, tee at the bottom, green at the top, 800 px for the card's 300 m.
  const art = { asset: 'hvart', w: 200, h: 1000, tee: [100, 900], green: [100, 100], gr: 30 };
  const holes = card(18, { par: [4], metres: [300] }).map(h => h.n === 1 ? { ...h, art } : h);
  await app.api.put('courses', 'c_hv', { id: 'c_hv', v: 2, name: 'Hunter Valley Golf Club', tee: 'white', map: { id: 'hunter-valley', linked: '2026-10-25' }, holes });
  await app.api.put('sessions', 'r_hv', { id: 'r_hv', v: 2, type: 'round', date: '2026-09-14', courseId: 'c_hv', courseName: 'Hunter Valley Golf Club', tee: 'white', detail: 'shot_level',
    holes: holes.map(({ n, par, metres }) => n === 1 ? { n, par, metres, putts: 2, strokes: 4, shots: [{ x: 100, y: 500, club: 'D', lie: 'fairway' }, { x: 100, y: 110, club: '7i', lie: 'green' }] } : { n, par, metres, strokes: par }) });
  await app.waitFor(() => app.E(`!!session('r_hv') && !!course('c_hv')`), { what: 'seeded' });
  app.go('courses', { courseId: 'c_hv' });
  await app.waitFor(() => app.E(`HoleMap.get('hunter-valley') !== undefined`), { what: 'map loaded' });
  app.go('courses', { courseId: 'c_hv' });
  assert.match(app.text('#artConvert'), /1 round here \(1 hole, 2 shots\) were traced on the uploaded hole pictures/);
  const before = app.J(`roundStats(session('r_hv')).byClub`);
  assert.ok(before.D && Math.abs(before.D[0] - 150) < 1, `the drive measured 150 m on the artwork (half of 300), got ${before.D && before.D[0]}`);
  app.click('#artConvert [data-act="convertArt"]');
  await app.answer(true);
  await app.waitFor(async () => (await app.api.get('sessions', 'r_hv')).holes[0].shots[0].mx != null, { what: 'converted' });
  const got = (await app.api.get('sessions', 'r_hv')).holes[0].shots;
  assert.deepEqual(got.map(s => [s.approx, s.art, s.club, s.lie]), [[true, { x: 100, y: 500 }, 'D', 'fairway'], [true, { x: 100, y: 110 }, '7i', 'green']], 'pixels kept, lie and club kept, marked approximate');
  assert.ok(got.every(s => s.x === undefined && s.y === undefined), 'no longer art shots');
  // The drive sits halfway along the hole as the app draws it: OSM's line with the tee
  // placed the card's 300 m from the green (the tee rule), not OSM's raw line.
  const pl = app.J(`holesOf(session('r_hv'))[0].hm.pl`), total = app.J(`polyLen(${JSON.stringify(pl)})`);
  assert.ok(Math.abs(total - 300) < 0.5, `the drawn line is the card's 300 m (${total}); OSM's ${line.length}-point line is longer, so the tee rule moves the tee forward`);
  const half = app.J(`atFraction(${JSON.stringify(pl)}, 0.5).p`);
  assert.ok(Math.abs(got[0].mx - half[0]) < 0.11 && Math.abs(got[0].my - half[1]) < 0.11, 'at the line\'s midpoint');
  await app.waitFor(() => app.E(`usesMap(holesOf(session('r_hv'))[0])`), { what: 'drawn on the map now' });
  const after = app.J(`roundStats(session('r_hv')).byClub`);
  assert.ok(Math.abs(after.D[0] - total / 2) < 1, `measured along the map now: ${after.D[0]} vs ${total / 2}`);
  assert.equal(app.$('#artConvert'), null, 'nothing left to move');
  assert.equal(app.J(`calibration().filter(c => c.club === 'D').length`), 0, 'an approximate position is not a measured distance: out of range vs course');
  assert.ok(app.J(`shotRecords().filter(x => x.r.id === 'r_hv').every(x => !x.full)`), 'no full-swing measurement from moved shots');
  app.go('courses', { courseId: 'c_hv', hole: '1' });
  assert.ok(app.$('#holeMap'), 'the hole page draws the map with the moved dots');
});
