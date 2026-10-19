// Play mode, driven through the real pages with a stand-in for the phone's
// GPS: starting a round where you stand, distances to the green and the
// hazards from a fix, marking the ball by GPS, rough fixes and being off the
// course, a course with no map, GPS stopping when you leave, and saves kept
// on the phone without signal, then sent when it comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, club, card, sleep } from './harness.js';

const PARS = [3, 4, 3, 3, 3, 3, 4, 3, 4, 3, 3, 3, 3, 4, 3, 4, 3, 3];
const REDS = [159, 330, 100, 200, 112, 230, 260, 130, 225, 103, 90, 144, 146, 285, 160, 351, 156, 174];
const MAP = JSON.parse(readFileSync('web/course-maps/randwick.json', 'utf8'));
const [LAT0, LNG0] = MAP.origin;
const RW = { id: 'c_rw', v: 2, name: 'Randwick Golf Club', tee: 'red', lat: LAT0, lng: LNG0, map: { id: 'randwick', linked: '2026-10-01' },
  holes: card(18, { tee: 'red', par: PARS, metres: REDS }) };
// Bondi, 6 km away: a course with no map, and not the nearest.
const BONDI = { id: 'c_bondi', v: 2, name: 'Bondi Golf', tee: 'white', lat: -33.8908, lng: 151.2743, holes: card(9, { par: [3], metres: [120] }) };

// Great-circle metres, written here independently of the app's projection.
const haversine = (a, b) => {
  const R = 6371008.8, rad = d => d * Math.PI / 180;
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

let app;
const fakeGps = () => app.E(`window.__geo = {
    cbs: [], cleared: 0, now: null,
    watchPosition(ok, err) { this.cbs.push({ ok, err }); return this.cbs.length; },
    clearWatch(id) { this.cleared++; this.cbs[id - 1] = null; },
    getCurrentPosition(ok) { if (this.now) setTimeout(() => ok(this.now), 0); },
    fix(lat, lng, acc = 5) { this.now = { coords: { latitude: lat, longitude: lng, accuracy: acc } }; this.cbs.forEach(c => c && c.ok(this.now)); },
    fail(code) { this.cbs.forEach(c => c && c.err({ code })); },
    get watching() { return this.cbs.filter(Boolean).length; },
  };
  Object.defineProperty(navigator, 'geolocation', { value: __geo, configurable: true }); true`);
const fix = (p, acc = 5) => app.E(`__geo.fix(${p.lat}, ${p.lng}, ${acc})`);
// A point on hole n's map (in the page's own terms) as lat/long.
const latLngOf = (sid, n, expr) => app.J(`(() => { const hm = holesOf(session('${sid}')).find(h => h.n === ${n}).hm; return HoleMap.toLatLng(hm.map, ${expr}); })()`);
const hmOf = (sid, n, expr) => app.J(`(() => { const hm = holesOf(session('${sid}')).find(h => h.n === ${n}).hm; return ${expr}; })()`);
let offline = false, putOnly = false;

// A made-up straight hole with known answers: tee at (0,0), the green a 20 m
// square centred 300 m north, and hazards placed so each number can be worked
// by hand. x is east, y north, in metres.
const sq = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const STRAIGHT = { v: 1, id: 'test-straight', name: 'Straight', origin: [-33.9, 151.2], boundary: sq(-1000, -1000, 1000, 1000),
  features: [
    { k: 'green', h: 1, r: sq(-10, 290, 10, 310) },
    { k: 'tee', h: 1, r: sq(-3, -3, 3, 3) },
    { k: 'bunker', h: 1, r: sq(25, 100, 40, 120) },     // right: reach (25,100) = 103.1, carry (40,120) = 126.5
    { k: 'bunker', h: 1, r: sq(-40, 200, 40, 215) },    // in line: reach the edge's middle (0,200) = 200, not a corner (204); carry (±40,215) = 218.7
    { k: 'water', h: 1, r: sq(15, 285, 35, 315) },      // by the green: reach (15,285) = 285.4, carry (35,315) = 316.9
    { k: 'bunker', h: 1, r: sq(-30, -40, -20, -30) },   // behind the tee: never listed
    { k: 'bunker', h: 2, r: sq(50, 150, 60, 160) },     // another hole's: never listed
  ],
  holes: [{ n: 1, line: [[0, 0], [0, 300]], green: 0, tees: [1] }] };
const SYN = { id: 'c_syn', v: 2, name: 'Straight GC', tee: 'white', map: { id: 'test-straight', linked: '2026-10-01' }, holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 }, si: 1 }] };

before(async () => {
  app = await startApp({
    seed: { clubs: [club('7i', 'iron', { order: 3, nominalCarry: 110 }), club('PW', 'wedge', { order: 5, nominalCarry: 90 }), club('P', 'putter', { order: 9 })], courses: [RW, BONDI, SYN] },
    // No signal: the request never gets anywhere (a TypeError, as fetch gives).
    // putOnly: only saves fail, the way Cloudflare answers 502 with the NAS down.
    intercept: async (url, o) => {
      if (!offline || !url.includes('/api/')) return null;
      if (putOnly) return (o.method === 'PUT') ? new Response('bad gateway', { status: 502 }) : null;
      throw new TypeError('Failed to fetch');
    },
  });
  fakeGps();
  app.E(`HoleMap._put('test-straight', ${JSON.stringify(STRAIGHT)}); true`);
});
after(() => app && app.stop());

let R;   // the round started in the first test

test('nowhere near a course, Start round picks nothing for you', async () => {
  app.E(`__geo.now = { coords: { latitude: ${LAT0 + 0.05}, longitude: ${LNG0}, accuracy: 10 } }; true`);
  app.go('rounds');
  app.click('[data-act=startPlay]');
  await sleep(100);
  assert.equal(app.field('courseId').value, '');
  assert.equal(app.text('#nearCourse'), '');
  app.click('#sheetInner [data-close]');
});
const today = () => app.E('today()');

test('Start round picks the course you are standing at, and opens the hole you start on', async () => {
  app.E(`__geo.now = { coords: { latitude: ${LAT0 + 0.0005}, longitude: ${LNG0}, accuracy: 30 } }; true`);
  app.go('rounds');
  app.click('[data-act=startPlay]');
  await app.waitFor(() => app.field('courseId').value === 'c_rw', { what: 'nearest course picked' });
  assert.match(app.text('#nearCourse'), /^You're \d+ m from Randwick Golf Club, so it's picked\.$/);
  assert.equal(app.text('#sheetInner [data-save]'), 'Start');
  assert.equal(app.field('tee').value, 'red');
  app.click('#sheetInner [data-start="10"]');
  assert.equal(await app.save(), true);
  R = app.E('S.sub.sessionId');
  const r = await app.api.get('sessions', R);
  assert.equal(r.date, today());
  assert.deepEqual([r.type, r.courseId, r.tee, r.detail, r.holes.length], ['round', 'c_rw', 'red', 'score_only', 18]);
  assert.ok(r.holes.every(h => h.strokes == null && !h.shots), 'nothing scored yet');
  assert.deepEqual(r.holes[9], { n: 10, par: 3, metres: 103 });
  assert.deepEqual(app.J('S.sub'), { sessionId: R, play: '1', hole: '10' });
  assert.match(app.text('h1'), /^Hole 10 par 3, 103m/);
  assert.equal(app.E('__geo.watching'), 1, 'GPS is on while playing');
});

test('from a fix on the tee: front, middle and back of the green, and the hazards with their side', async () => {
  app.go('rounds', { sessionId: R, play: '1', hole: '1' });
  await app.waitFor(() => app.$('#logMap'), { what: 'hole 1 map' });
  const tee = latLngOf(R, 1, 'hm.tee'), green = latLngOf(R, 1, 'hm.green');
  fix(tee, 4);
  await app.waitFor(() => app.$('#greenDist'), { what: 'distances' });
  const [front, middle, back] = app.$$('#greenDist b').map(b => Number(b.textContent));
  // The middle is the straight line to the green's centre: 159 m by the red
  // card, since the tee rule puts the red tee there on this straight hole.
  assert.ok(Math.abs(middle - haversine(tee, green)) <= 1, `middle ${middle} vs ${haversine(tee, green).toFixed(1)} on the globe`);
  assert.equal(middle, 159);
  assert.ok(front < middle && middle < back, `${front} < ${middle} < ${back}`);
  assert.match(app.text('#playLive'), /metres, straight line · GPS ±4 m/);
  // Hole 1's two bunkers, nearest first, each checked by plain geometry.
  const want = hmOf(R, 1, `hm.map.features.filter(f => f.h === 1 && f.k === 'bunker').map(f => f.r)`).map(rings => {
    const p = hmOf(R, 1, 'hm.tee'), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let reach = Infinity, carry = 0;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      carry = Math.max(carry, d(p, ring[i]));
      if (!i) continue;
      const [a, b] = [ring[i - 1], ring[i]], vx = b[0] - a[0], vy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
      reach = Math.min(reach, d(p, [a[0] + vx * t, a[1] + vy * t]));
    }
    return [Math.round(reach), Math.round(carry)];
  }).sort((a, b) => a[0] - b[0]);
  const rows = app.$$('#hazards .spread').map(r => r.textContent);
  assert.equal(rows.length, 2);
  rows.forEach((row, i) => assert.match(row, new RegExp(`^Bunker, (left|right|in line|by the green)${want[i][0]} to reach · ${want[i][1]} to carry$`)));
  // The you-are-here dot is on the map, at the tee marker.
  const dot = app.$('#logMap #you .hm-you'), teeMark = app.$('#logMap .hm-teemark');
  assert.ok(dot, 'dot drawn');
  assert.ok(Math.abs(dot.getAttribute('cx') - teeMark.getAttribute('cx')) < 0.5 && Math.abs(dot.getAttribute('cy') - teeMark.getAttribute('cy')) < 0.5);
});

test('a new fix moves the dot and the numbers without redrawing the page', async () => {
  const before = app.$('#logMap');
  const p = latLngOf(R, 1, 'HoleMap.geom.pointAt(hm.pl, HoleMap.geom.lineLen(hm.pl) - 60)');
  fix(p, 3);
  await app.waitFor(() => Number(app.$$('#greenDist b')[1].textContent) === 60, { what: '60 m out' });
  assert.equal(app.$('#logMap'), before, 'same map element: a tap in progress is not lost');
  assert.equal(app.$$('#logMap #you').length, 1, 'one dot, moved');
});

test('Mark my ball here stores the shot where you stand, in map metres, with the fix accuracy', async () => {
  const want = hmOf(R, 1, 'HoleMap.geom.pointAt(hm.pl, HoleMap.geom.lineLen(hm.pl) - 60)');
  app.click('[data-act=markBall]');
  await app.waitFor(async () => ((await app.api.get('sessions', R)).holes[0].shots || []).length === 1, { what: 'shot saved' });
  const s = (await app.api.get('sessions', R)).holes[0].shots[0];
  assert.ok(Math.abs(s.mx - want[0]) <= 0.2 && Math.abs(s.my - want[1]) <= 0.2, `${s.mx},${s.my} vs ${want}`);
  assert.equal(s.gps, 3);
  assert.equal(s.club, app.E(`armedClubFor({ n: 1, par: 3, shots: [] }, 159)`), 'the club armed for it, never a recommendation');
  assert.equal(app.toast(), 'Ball marked');
  await app.waitFor(() => /marked by GPS \(±3 m\)/.test(app.text('#view')), { what: 'shot line' });
  assert.equal(app.$$('#logMap .hm-ball').length, 1, 'drawn like a tapped shot');
});

test('a tap on the map still logs a shot in Play mode', async () => {
  const [x, y] = hmOf(R, 1, 'HoleMap.mapToView(hm, hm.green)');
  await app.tap('#logMap', x, y);
  await app.waitFor(async () => ((await app.api.get('sessions', R)).holes[0].shots || []).length === 2, { what: 'tap saved' });
  const s = (await app.api.get('sessions', R)).holes[0].shots[1];
  assert.equal(s.lie, 'green');
  assert.equal(s.gps, undefined, 'a tap is not a GPS mark');
  // Two shots and no putts: the hole isn't finished, whatever the running count says.
  await app.waitFor(() => app.text('#holeScore') === '2', { what: 'running count' });
  assert.equal(app.text('#playScore'), 'No holes scored yet');
  assert.equal(app.$('[data-go*="play=1"].primary'), null, 'no "next hole" yet');
});

test('putts finish the hole: the score, the running total and the next hole', async () => {
  app.click('[data-act=setPutts][data-p="2"]');
  await app.waitFor(() => /4 through 1 hole, \+1/.test(app.text('#playScore')), { what: 'running score' });
  assert.equal(app.text('#holeScore'), '4');
  // Started at 10, so hole 1 is mid-round; next unscored after 1 is 2.
  assert.equal(app.text('[data-go*="play=1,hole=2"].primary'), 'Hole 2 →');
});

test('a rough fix asks before marking; off the course nothing can be marked', async () => {
  app.go('rounds', { sessionId: R, play: '1', hole: '2' });
  await app.waitFor(() => app.$('#logMap'), { what: 'hole 2' });
  fix(latLngOf(R, 2, 'hm.tee'), 40);
  await app.waitFor(() => /rough fix/.test(app.text('#playLive')), { what: 'rough fix flagged' });
  const done = app.act('markBall');
  await app.answer(false);
  await done;
  assert.equal(((await app.api.get('sessions', R)).holes[1].shots || []).length, 0, 'not marked');
  fix({ lat: LAT0 + 0.05, lng: LNG0 }, 5);   // 5.5 km north
  await app.waitFor(() => /km from the course/.test(app.text('#gpsWhy')), { what: 'off course' });
  assert.match(app.text('#gpsWhy'), /^You're 5\.\d km from the course\. Distances show once you're on it\.$/);
  assert.equal(app.$('[data-act=markBall]').disabled, true);
  assert.equal(app.$('#logMap #you'), null, 'no dot off the map');
});

test('location blocked says how to allow it', async () => {
  app.E('__geo.fail(1)');
  await app.waitFor(() => /blocked|https/.test(app.text('#gpsWhy')), { what: 'blocked message' });
});

test('leaving Play mode turns GPS off', async () => {
  const cleared = app.E('__geo.cleared');
  app.go('rounds', { sessionId: R });
  assert.equal(app.E('__geo.cleared'), cleared + 1);
  assert.equal(app.E('__geo.watching'), 0);
  assert.match(app.text('[data-go*="play=1"]'), /^Play: hole 2 →$/, 'today\'s round can be picked up again');
});

test('hazards, worked by hand on a straight hole: reach the nearest edge, carry the far one, ahead only, this hole only', async () => {
  await app.api.put('sessions', 'r_syn', { id: 'r_syn', v: 2, type: 'round', date: '2026-10-19', courseId: 'c_syn', courseName: 'Straight GC', tee: 'white', detail: 'score_only', holes: [{ n: 1, par: 4, metres: 300 }] });
  await app.waitFor(() => app.E(`!!session('r_syn')`), { what: 'round arrives' });
  app.go('rounds', { sessionId: 'r_syn', play: '1', hole: '1' });
  fix(app.J(`HoleMap.toLatLng(HoleMap.get('test-straight'), [0, 0])`), 2);
  await app.waitFor(() => app.$('#hazards'), { what: 'hazards' });
  assert.deepEqual(app.$$('#greenDist b').map(b => b.textContent), ['290', '300', '310']);
  assert.deepEqual(app.$$('#hazards .spread').map(r => r.textContent), [
    'Bunker, right103 to reach · 126 to carry',
    'Bunker, in line200 to reach · 219 to carry',
    'Water, by the green285 to reach · 317 to carry',
  ]);
  // Past the first bunker it drops off the list.
  fix(app.J(`HoleMap.toLatLng(HoleMap.get('test-straight'), [0, 140])`), 2);
  await app.waitFor(() => app.$$('#hazards .spread').length === 2, { what: 'bunker passed' });
  assert.match(app.text('#hazards'), /^Bunker, in line60 to reach/);
  // A fix older than half a minute isn't where he's standing.
  app.E('S.gps.t -= 60000; playLive(); true');
  assert.equal(app.text('#gpsWhy'), 'Waiting for a fresh GPS fix…');
  assert.equal(app.$('[data-act=markBall]').disabled, true);
});

test('a course with no map can still be played by score', async () => {
  await app.api.put('sessions', 'r_bondi', { id: 'r_bondi', v: 2, type: 'round', date: '2026-10-19', courseId: 'c_bondi', courseName: 'Bondi Golf', tee: 'white', detail: 'score_only', holes: card(9, { par: [3], metres: [120] }).map(({ n, par, metres }) => ({ n, par, metres })) });
  await app.waitFor(() => app.E(`!!session('r_bondi')`), { what: 'round arrives' });
  app.go('rounds', { sessionId: 'r_bondi', play: '1', hole: '1' });
  assert.match(app.text('#playLive'), /no course map, so there are no GPS distances/);
  assert.equal(app.$('[data-act=markBall]'), null);
  app.click('[data-act=quickScore][data-s="4"]');
  await app.waitFor(async () => (await app.api.get('sessions', 'r_bondi')).holes[0].strokes === 4, { what: 'score saved' });
  await app.waitFor(() => /4 through 1 hole, \+1/.test(app.text('#playScore')), { what: 'running score' });
  app.click('[data-act=finishPlay]');
  assert.deepEqual(app.J('S.sub'), { sessionId: 'r_bondi' }, 'back to the round page');
});

/* ---------- no signal ---------- */

test('without signal a save is kept on the phone, shown, and sent when signal comes back', async () => {
  app.go('rounds', { sessionId: 'r_bondi', play: '1', hole: '2' });
  offline = true;
  app.click('[data-act=quickScore][data-s="3"]');
  await app.waitFor(() => /1 change saved on this phone, waiting for signal/.test(app.text('#status')), { what: 'waiting status' });
  assert.equal(app.E(`session('r_bondi').holes[1].strokes`), 3, 'the app shows it as saved');
  assert.equal(JSON.parse(app.win.localStorage.getItem('carry.outbox'))['sessions/r_bondi'].body.holes[1].strokes, 3, 'kept on the phone');
  offline = false;
  assert.equal((await app.api.get('sessions', 'r_bondi')).holes[1].strokes, undefined, 'not on the NAS yet');
  await app.waitFor(async () => (await app.api.get('sessions', 'r_bondi')).holes[1].strokes === 3, { what: 'sent on the next poll' });
  await app.waitFor(() => app.text('#status') === '', { what: 'status cleared' });
  assert.equal(app.toast(), 'Everything is saved');
  assert.equal(app.win.localStorage.getItem('carry.outbox'), null);
});

test('a waiting save wins over a poll until it is sent (the NAS down behind Cloudflare: 502)', async () => {
  offline = true; putOnly = true;
  app.click('[data-act=quickScore][data-s="5"]');
  await app.waitFor(() => /waiting for signal/.test(app.text('#status')), { what: 'waiting' });
  // A change from elsewhere moves the stamps, so the poll refetches the rounds.
  await app.api.put('sessions', 'r_elsewhere', { id: 'r_elsewhere', v: 2, type: 'range', date: '2026-10-18', blocks: [] });
  await app.waitFor(() => app.E(`!!session('r_elsewhere')`), { what: 'the refetch' });
  await sleep(300);
  assert.equal(app.E(`session('r_bondi').holes[1].strokes`), 5, 'the poll did not put the old score back');
  offline = false; putOnly = false;
  await app.waitFor(async () => (await app.api.get('sessions', 'r_bondi')).holes[1].strokes === 5, { what: 'sent' });
});

test('a newer save that gets through is never overwritten by an older waiting one', async () => {
  offline = true;
  await app.E(`save('sessions', 'r_bondi', { ...session('r_bondi'), notes: 'older' })`);
  offline = false;
  await app.E(`save('sessions', 'r_bondi', { ...session('r_bondi'), notes: 'newer' })`);
  await sleep(500);
  assert.equal((await app.api.get('sessions', 'r_bondi')).notes, 'newer');
  assert.equal(app.win.localStorage.getItem('carry.outbox'), null);
});

test('saves still waiting when the app was closed are sent when it opens again', async () => {
  const waiting = { 'sessions/r_left': { col: 'sessions', id: 'r_left', t: 1, body: { id: 'r_left', v: 2, type: 'round', date: '2026-10-19', courseId: 'c_bondi', courseName: 'Bondi Golf', holes: [{ n: 1, par: 3, strokes: 3 }] } } };
  // Still no signal when it opens: what's waiting shows anyway. Polls are slow
  // here, so it's the start-up send that delivers it.
  let down = true;
  const again = await startApp({ seed: { courses: [BONDI] }, pollMs: 60000, storage: { 'carry.outbox': JSON.stringify(waiting) },
    intercept: async (url, o) => (down && o.method === 'PUT' ? new Response('', { status: 502 }) : null) });
  try {
    assert.equal(again.E(`session('r_left').holes[0].strokes`), 3, 'shown from the phone');
    assert.equal(await again.api.get('sessions', 'r_left'), null);
    down = false;
    again.E('window.carryOutbox().flush(); true');   // what the browser's online event does
    await again.waitFor(async () => (await again.api.get('sessions', 'r_left')) !== null, { what: 'sent' });
    assert.equal(again.win.localStorage.getItem('carry.outbox'), null);
  } finally { again.stop(); }
});

test('opening the app with signal sends what was waiting straight away, without waiting for a poll', async () => {
  const waiting = { 'sessions/r_left2': { col: 'sessions', id: 'r_left2', t: 1, body: { id: 'r_left2', v: 2, type: 'round', date: '2026-10-19', courseId: 'c_bondi', courseName: 'Bondi Golf', holes: [{ n: 1, par: 3, strokes: 4 }] } } };
  const again = await startApp({ seed: { courses: [BONDI] }, pollMs: 60000, storage: { 'carry.outbox': JSON.stringify(waiting) } });
  try {
    await again.waitFor(async () => (await again.api.get('sessions', 'r_left2')) !== null, { what: 'sent at start' });
    assert.equal(again.win.localStorage.getItem('carry.outbox'), null);
  } finally { again.stop(); }
});
