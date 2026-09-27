// Course maps in the app, driven through the real pages and real taps:
// linking a course to its map, the tee rule and the card check on the course
// page, taps stored in real metres with the lie read from the shape under
// them, holes already traced on the outline staying on it, course edits
// keeping the link, and unlinking without losing a shot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

// Randwick's red card, as the screenshots gave it.
const PARS = [3, 4, 3, 3, 3, 3, 4, 3, 4, 3, 3, 3, 3, 4, 3, 4, 3, 3];
const REDS = [159, 330, 100, 200, 112, 230, 260, 130, 225, 103, 90, 144, 146, 285, 160, 351, 156, 174];
// Except hole 3: the real 100 m lands on Randwick's long mapped tee box, so
// nothing is flagged. 60 m doesn't land on any box, which is what a flag is for.
const holes = card(18, { tee: 'red', par: PARS, metres: REDS.map((m, i) => i === 2 ? 60 : m) });
const roundHoles = () => holes.map(h => ({ n: h.n, par: h.par, metres: h.metres }));

let app;
const R = 'r_map', OLD = 'r_old';
const round = async id => app.api.get('sessions', id);
// View coordinates of a map point on hole n of round id, as the logger draws it.
const onView = (id, n, expr) => app.J(`(() => { const hm = holesOf(session('${id}')).find(h => h.n === ${n}).hm; return HoleMap.mapToView(hm, ${expr}); })()`);
const tapAt = async (id, n, expr) => { const [x, y] = onView(id, n, expr); await app.tap('#logMap', x, y); };
const openHole = async (id, n) => { app.go('rounds', { sessionId: id, hole: String(n) }); await app.waitFor(() => app.$('#logMap'), { what: `hole ${n} map` }); };

before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 3 }), club('PW', 'wedge', { order: 5 }), club('P', 'putter', { order: 9 })],
    courses: [{ id: 'c_rw', v: 2, name: 'Randwick Golf Club', tee: 'red', holes: holes.map(h => h.n === 1 ? { ...h, shape: { bend: 0.3, bendAt: 0.5, hazards: [] } } : h) }],
    sessions: [
      { id: R, v: 2, type: 'round', date: '2026-09-20', courseId: 'c_rw', courseName: 'Randwick Golf Club', tee: 'red', detail: 'score_only', holes: roundHoles() },
      // Traced on the drawn outline before the course had a map.
      { id: OLD, v: 2, type: 'round', date: '2026-08-01', courseId: 'c_rw', courseName: 'Randwick Golf Club', tee: 'red', detail: 'shot_level',
        holes: roundHoles().map(h => h.n === 1 ? { ...h, shots: [{ t: 0.9, u: 0.1, club: '7i', lie: 'rough' }], strokes: 3, putts: 2 } : h) },
    ],
  } });
});
after(() => app && app.stop());

test('the map files are served, and revalidated like the app shell', async () => {
  const r = await fetch(`${app.base}/course-maps/randwick.json`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache', 'a rebuilt map reaches the phone with the page');
  assert.equal((await r.json()).attribution, '© OpenStreetMap contributors');
});

test('a course is linked to its map from the course page, and the card is checked against it', async () => {
  app.go('courses', { courseId: 'c_rw' });
  const pick = await app.waitFor(() => app.$('#courseMap [name=mapPick]'), { what: 'map picker' });
  assert.equal(pick.value, 'randwick', 'the map with the same name is suggested');
  assert.equal(app.$$('.tile svg.holemap').length, 0, 'nothing changes until he says so');
  app.click('#courseMap [data-act=linkMap]');
  await app.waitFor(async () => (await app.api.get('courses', 'c_rw')).map?.id === 'randwick', { what: 'link saved' });
  const c = await app.api.get('courses', 'c_rw');
  assert.deepEqual(Object.keys(c.map).sort(), ['id', 'linked'], 'only the link is stored, never the shapes');
  await app.waitFor(() => app.$('#mapFlags'), { what: 'card check' });
  assert.match(app.text('#mapFlags'), /^One hole where the card distance doesn't land on a mapped tee box/);
  assert.match(app.text('#mapFlags'), /: hole 3 \(card 60m, map 124m\)\.$/);
  // Hole 5's card is 15 m (12%) shorter than its line, but that tee is mapped: not flagged.
  assert.doesNotMatch(app.text('#mapFlags'), /hole 5/);
  assert.equal(app.$$('.tile svg.holemap').length, 18, 'every hole is drawn from the map');
  assert.match(app.text('#courseMap'), /© OpenStreetMap contributors/);
  // The hole's own page says how its card and line compare.
  app.go('courses', { courseId: 'c_rw', hole: '3' });
  await app.waitFor(() => app.$('#holeCheck'), { what: 'hole check' });
  assert.match(app.text('#holeCheck'), /Card 60m, mapped line 124m, and no mapped tee box at the card distance\. The tee is placed from the card, ahead of the mapped tee\./);
  app.go('courses', { courseId: 'c_rw', hole: '5' });
  await app.waitFor(() => app.$('.map-credit'), { what: 'hole 5 page' });
  assert.equal(app.$('#holeCheck'), null, 'on a mapped tee: nothing to say');
});

test('taps are stored in metres, measured from the tee the card puts there', async () => {
  await openHole(R, 7);
  assert.ok(app.$('#logMap.holemap'), 'the logger draws the map');
  assert.match(app.text('.map-credit'), /OpenStreetMap contributors/);
  // 150 m along the play line from the red tee: 110 m left on a 260 m card.
  await tapAt(R, 7, 'HoleMap.geom.pointAt(hm.pl, 150)');
  await app.waitFor(async () => ((await round(R)).holes[6].shots || []).length === 1, { what: 'shot saved' });
  const s = (await round(R)).holes[6].shots[0];
  assert.ok(typeof s.mx === 'number' && typeof s.my === 'number' && s.t == null && s.x == null, 'the map frame only');
  assert.equal(s.lie, undefined, 'the estimated fairway never decides a lie: he picks');
  await app.waitFor(() => /110m to the green/.test(app.text('.map-hint')), { what: 'distance left' });
  assert.match(app.text('.shotrow'), /from 260m/, 'the first shot starts at the card distance');
});

test('the lie is read from the shape under the tap', async () => {
  await openHole(R, 17);
  const bunker = 'HoleMap.geom.centroid(hm.map.features.find(f => f.k === "bunker" && f.h === 17).r[0])';
  await tapAt(R, 17, bunker);
  await app.waitFor(async () => ((await round(R)).holes[16].shots || []).length === 1, { what: 'bunker shot' });
  assert.equal((await round(R)).holes[16].shots[0].lie, 'bunker');
  await tapAt(R, 17, 'hm.green');
  await app.waitFor(async () => ((await round(R)).holes[16].shots || []).length === 2, { what: 'green shot' });
  const h = (await round(R)).holes[16];
  assert.equal(h.shots[1].lie, 'green');
  assert.equal(h.firstPuttEstimated, true, 'a tap on the green estimates the first putt');
  assert.ok(h.firstPutt < 1, 'from the middle of the green');
});

test('a hole already traced on the outline stays on it', async () => {
  await openHole(OLD, 1);
  assert.equal(app.$('#logMap.holemap'), null, 'frames are never mixed on one hole');
  assert.match(app.text('.map-hint'), /logged on the drawn outline/);
  const p = app.J(`(() => { const all = holesOf(session('${OLD}')); const h = all.find(x => x.n === 1); const maxM = Math.max(...all.map(x => x.metres || 0), 1); return holePt(holeGeom(h, (h.metres || maxM) / maxM), 0.97, 0); })()`);
  await app.tap('#logMap', p.x, p.y);
  await app.waitFor(async () => (await round(OLD)).holes[0].shots.length === 2, { what: 'outline shot' });
  const s = (await round(OLD)).holes[0].shots[1];
  assert.ok(s.t != null && s.mx == null, 'still an outline shot');
  // The next hole, untraced, uses the map.
  await openHole(OLD, 2);
  assert.ok(app.$('#logMap.holemap'));
});

test('editing the course keeps its map', async () => {
  app.act('editCourse', { id: 'c_rw' });
  app.fill('m_2', 331);
  assert.equal(await app.save(), true);
  const c = await app.api.get('courses', 'c_rw');
  assert.equal(c.map.id, 'randwick');
  assert.deepEqual(c.holes[0].shape, { bend: 0.3, bendAt: 0.5, hazards: [] }, 'and everything else the form does not own');
});

test('stopping the map warns, keeps every shot, and using it again brings them back', async () => {
  app.go('courses', { courseId: 'c_rw' });
  await app.waitFor(() => app.$('#courseMap [data-act=unlinkMap]'), { what: 'unlink button' });
  app.click('#courseMap [data-act=unlinkMap]');
  await app.waitFor(() => app.confirmOpen(), { what: 'confirm' });
  assert.match(app.text('#confirmDlg'), /1 round here has shots traced on it; they'll show as not measurable until the map is used again\. Nothing is deleted\./);
  await app.answer(true);
  await app.waitFor(async () => !(await app.api.get('courses', 'c_rw')).map, { what: 'unlinked' });
  assert.equal((await round(R)).holes[6].shots.length, 1, 'the shot is still there');
  await openHole(R, 7);
  assert.equal(app.$('#logMap.holemap'), null);
  assert.match(app.text('.shotrow'), /not measurable/, 'no map, no distance: never a guess');
  app.go('courses', { courseId: 'c_rw' });
  await app.waitFor(() => app.$('#courseMap [data-act=linkMap]'), { what: 'link again' });
  app.click('#courseMap [data-act=linkMap]');
  await app.waitFor(async () => (await app.api.get('courses', 'c_rw')).map, { what: 'relinked' });
  await openHole(R, 7);
  await app.waitFor(() => /110m to the green/.test(app.text('.map-hint')), { what: 'measured again' });
});
