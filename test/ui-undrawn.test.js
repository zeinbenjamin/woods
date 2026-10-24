// Marking the ball on a hole the map hasn't drawn yet (2.10.0): Lane Cove has
// only a boundary until his tee and flag marks draw each hole. A GPS fix is
// still a point in the map file's fixed frame, so the shot is kept as a map
// shot, "not measurable" until the hole is drawn, then measured from the real
// tee: nothing derived is stored, so the round re-measures itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, ME } from './harness.js';

const sq = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
// A boundary-only map, as Lane Cove's is: no holes, no shapes. x east, y north.
const MAP = { v: 1, id: 'test-bound', name: 'Boundary only', origin: [-33.81, 151.16], boundary: sq(-600, -600, 600, 600), features: [], holes: [] };
const COURSE = { id: 'c_lc', v: 2, name: 'Lane Cove Golf Club', tee: 'white', lat: -33.81, lng: 151.16, map: { id: 'test-bound', linked: '2026-10-24' },
  holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 }, si: 1 }, { n: 2, par: 3, metres: 140, tees: { white: 140 }, si: 2 }] };

let app;
const ll = p => app.J(`HoleMap.toLatLng(HoleMap.get('test-bound'), ${JSON.stringify(p)})`);
const fix = (p, acc = 4) => { const q = ll(p); app.E(`__geo.fix(${q.lat}, ${q.lng}, ${acc})`); };
const round = () => app.api.get('sessions', 'r_lc');

before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 3 })], courses: [COURSE] } });
  app.E(`HoleMap._put('test-bound', ${JSON.stringify(MAP)}); mapArrived(); true`);
  app.E(`window.__geo = { cbs: [], watchPosition(ok) { this.cbs.push(ok); return this.cbs.length; }, clearWatch(id) { this.cbs[id - 1] = null; }, getCurrentPosition() {},
    fix(lat, lng, acc) { this.cbs.forEach(c => c && c({ coords: { latitude: lat, longitude: lng, accuracy: acc } })); } };
    Object.defineProperty(navigator, 'geolocation', { value: __geo, configurable: true }); true`);
  await app.api.put('sessions', 'r_lc', { id: 'r_lc', v: 2, type: 'round', date: app.E('today()'), courseId: 'c_lc', courseName: 'Lane Cove Golf Club', tee: 'white', detail: 'score_only',
    holes: [{ n: 1, par: 4, metres: 300 }, { n: 2, par: 3, metres: 140 }] });
  await app.waitFor(() => app.E(`!!session('r_lc')`), { what: 'round' });
});
after(() => app && app.stop());

test('on a hole the map hasn\'t drawn, Play still offers Mark my ball here, and says the shot is measured later', async () => {
  app.go('rounds', { sessionId: 'r_lc', play: '1', hole: '1' });
  fix([0, 0]);
  await app.waitFor(() => app.$('#undrawnNote'), { what: 'undrawn note' });
  assert.match(app.text('#undrawnNote'), /^This hole isn't drawn yet, so there are no distances\. Marking your ball still saves where it is; the shots are measured once your tee and flag marks draw the hole\. Mark the tee first if you haven't\.$/);
  assert.equal(app.$('[data-act=markBall]').disabled, false);
  assert.ok(app.$('[data-act=markHole][data-k=tee]'), 'and the tee and flag marks, as before');
  assert.equal(app.$('#logMap'), null, 'no drawing to tap on');
});

test('the ball is saved where he stands, in the map file\'s frame, with the fix\'s accuracy', async () => {
  fix([0, 0]); app.click('[data-act=markHole][data-k=tee]');
  await app.waitFor(async () => ((await app.api.get('courses', 'c_lc')).holes[0].marks || []).length === 1, { what: 'tee marked' });
  fix([4, 160], 5); app.click('[data-act=markBall]');
  await app.waitFor(async () => ((await round()).holes[0].shots || []).length === 1, { what: 'first shot' });
  fix([-2, 285], 3); app.click('[data-act=markBall]');
  await app.waitFor(async () => ((await round()).holes[0].shots || []).length === 2, { what: 'second shot' });
  const shots = (await round()).holes[0].shots;
  assert.deepEqual(shots.map(s => [s.mx, s.my, s.gps, s.lie]), [[4, 160, 5, undefined], [-2, 285, 3, undefined]], 'raw positions; no mapped ground, so no lie guessed');
  assert.equal(shots[0].club, 'D', 'the armed club, as on a drawn hole');
  assert.equal(app.toast(), 'Ball marked — measured once the hole is drawn');
  await app.waitFor(() => /2 shots saved by GPS, waiting for this hole to be drawn\./.test(app.text('#waitingShots')), { what: 'waiting line' });
  // He can still say where it finished.
  app.click('#lastShot [data-lie="green"]');
  await app.waitFor(async () => (await round()).holes[0].shots[1].lie === 'green', { what: 'lie set' });
});

test('off the course, the button is there but greyed out, and it says why', async () => {
  app.go('rounds', { sessionId: 'r_lc', play: '1', hole: '2' });
  fix([0, 3000]);
  await app.waitFor(() => /from the course/.test(app.text('#gpsWhy')), { what: 'off course' });
  assert.equal(app.$('[data-act=markBall]').disabled, true);
  fix([0, 0]);   // back on the course for what follows
});

test('until the hole is drawn those shots are not measurable, never a guess', () => {
  assert.equal(app.E(`shotRecords().filter(x => x.r.id === 'r_lc').length`), 0);
  assert.equal(app.E(`shotLen(holesOf(session('r_lc'))[0], 0)`), null);
});

test('the hole logger won\'t put an outline tap on a hole of GPS shots', async () => {
  app.go('rounds', { sessionId: 'r_lc', hole: '1' });
  await app.tap('#logMap', 100, 100);
  assert.match(app.toast(), /This hole’s shots are GPS positions, kept until the hole is drawn on the course map/);
  assert.equal((await round()).holes[0].shots.length, 2, 'no outline shot added');
});

test('once his flag mark draws the hole, the shots are measured from his own tee', async () => {
  app.go('rounds', { sessionId: 'r_lc', play: '1', hole: '1' });
  fix([0, 300]); app.click('[data-act=markHole][data-k=flag]');
  await app.waitFor(() => app.E(`!!holesOf(session('r_lc'))[0].hm`), { what: 'hole drawn from marks' });
  // Tee mark (0,0), flag (0,300), card 300m: the tee sits on the tee mark.
  const recs = app.J(`shotRecords().filter(x => x.r.id === 'r_lc').map(x => [Math.round(x.from), Math.round(x.len)])`);
  assert.deepEqual(recs, [[300, 160], [140, 125]], 'D: 300m out, √(4² + 160²) = 160m; then from 140m out, √(6² + 125²) = 125m');
  await app.waitFor(() => app.$('#logMap'), { what: 'the drawn hole in Play' });
  assert.equal(app.$$('#logMap .hm-ball').length, 2, 'both shots drawn on it');
});

test('a course with no map file at all is unchanged: no Mark my ball, scores and marks only', async () => {
  await app.api.put('courses', 'c_none', { id: 'c_none', v: 2, name: 'No Map GC', tee: 'white', holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 } }] });
  await app.api.put('sessions', 'r_none', { id: 'r_none', v: 2, type: 'round', date: app.E('today()'), courseId: 'c_none', courseName: 'No Map GC', tee: 'white', detail: 'score_only', holes: [{ n: 1, par: 4, metres: 300 }] });
  await app.waitFor(() => app.E(`!!session('r_none')`), { what: 'round' });
  app.go('rounds', { sessionId: 'r_none', play: '1', hole: '1' });
  assert.match(app.text('#playLive'), /no course map, so there are no GPS distances/);
  assert.equal(app.$('[data-act=markBall]'), null);
});
