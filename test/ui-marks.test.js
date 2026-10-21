// GPS marks (2.2.0): "Mark tee" and "Mark flag" in Play mode on a hole the
// map can't draw, stored raw on the shared course, refused when the fix is
// rough, kept by course edits, removable only by whoever made them, and kept
// by the server whatever copy of the course another phone saves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card, ME } from './harness.js';

const FRIEND = 'friend@example.com';
// Barnwell Park: only a boundary in OSM, so no map is linked.
const BARNWELL = { id: 'c_bw', v: 2, name: 'Barnwell Park', tee: 'white', lat: -33.8737, lng: 151.1206, holes: card(9, { par: [4, 3], metres: [300, 140] }) };
const AT = { lat: -33.8741, lng: 151.1202 };

let app;
const fix = (p, acc) => app.E(`__geo.fix(${p.lat}, ${p.lng}, ${acc})`);
const marksOn = async n => ((await app.api.get('courses', 'c_bw')).holes.find(h => h.n === n).marks || []);

before(async () => {
  app = await startApp({ seed: { clubs: [club('7i', 'iron')], courses: [BARNWELL] } });
  app.E(`window.__geo = { cbs: [], watchPosition(ok, err) { this.cbs.push({ ok, err }); return this.cbs.length; }, clearWatch(id) { this.cbs[id - 1] = null; },
    getCurrentPosition() {}, fix(lat, lng, acc) { this.cbs.forEach(c => c && c.ok({ coords: { latitude: lat, longitude: lng, accuracy: acc } })); } };
    Object.defineProperty(navigator, 'geolocation', { value: __geo, configurable: true }); true`);
  await app.api.put('sessions', 'r_bw', { id: 'r_bw', v: 2, type: 'round', date: app.E('today()'), courseId: 'c_bw', courseName: 'Barnwell Park', tee: 'White', detail: 'score_only',
    holes: card(9, { par: [4, 3], metres: [300, 140] }).map(({ n, par, metres }) => ({ n, par, metres })) });
  await app.waitFor(() => app.E(`!!session('r_bw')`), { what: 'round' });
  await app.waitFor(() => app.E('S.me') === ME, { what: 'signed-in email' });
});
after(() => app && app.stop());

test('on a hole with no map, Play offers Mark tee and Mark flag', async () => {
  app.go('rounds', { sessionId: 'r_bw', play: '1', hole: '1' });
  fix(AT, 4.2);
  await app.waitFor(() => /GPS ±4 m/.test(app.text('#playMarks')), { what: 'marks panel' });
  assert.match(app.text('#playMarks'), /isn’t on a course map yet/);
  assert.match(app.text('#playMarks'), /this hole has 0 flag marks, 0 tee marks/);
  assert.equal(app.text('[data-act=markHole][data-k=tee].primary'), 'Mark tee', 'tee first, before any shot');
  assert.ok(app.$('[data-act=markHole][data-k=flag]'));
});

test('Mark tee stores the raw fix on the shared course: position, accuracy, time, who, the tee in lower case', async () => {
  const t0 = Date.now();
  app.click('[data-act=markHole][data-k=tee]');
  await app.waitFor(async () => (await marksOn(1)).length === 1, { what: 'tee mark saved' });
  const [m] = await marksOn(1);
  assert.deepEqual({ ...m, at: undefined }, { k: 'tee', lat: AT.lat, lng: AT.lng, acc: 4.2, at: undefined, by: ME, tee: 'white' }, 'exactly the fix, never rounded or adjusted');
  assert.ok(Date.parse(m.at) >= t0 - 1000 && Date.parse(m.at) <= Date.now(), 'an ISO time');
  assert.equal(app.toast(), 'Tee marked');
  assert.equal((await app.api.get('sessions', 'r_bw')).holes[0].marks, undefined, 'on the course, not the round');
});

test('a fix rougher than ±10 m is refused, and says what to do', async () => {
  fix(AT, 18);
  await app.waitFor(() => /too rough to mark/.test(app.text('#playMarks')), { what: 'rough shown' });
  app.click('[data-act=markHole][data-k=flag]');
  await app.waitFor(() => app.toast() === 'GPS ±18 m: move into the open and try again', { what: 'refusal' });
  assert.equal((await marksOn(1)).length, 1, 'nothing stored');
});

test('once the hole is scored, Mark flag is the one offered; repeats are kept', async () => {
  app.click('[data-act=quickScore][data-s="5"]');
  await app.waitFor(() => !app.$('[data-act=markHole][data-k=tee]'), { what: 'tee gone after scoring' });
  assert.ok(app.$('[data-act=markHole][data-k=flag].primary'));
  fix({ lat: AT.lat - 0.0025, lng: AT.lng }, 3);
  await app.waitFor(() => /GPS ±3 m/.test(app.text('#playMarks')), { what: 'new fix' });
  app.click('[data-act=markHole][data-k=flag]');
  await app.waitFor(async () => (await marksOn(1)).length === 2, { what: 'flag 1' });
  await new Promise(r => setTimeout(r, 5));
  app.click('[data-act=markHole][data-k=flag]');
  await app.waitFor(async () => (await marksOn(1)).length === 3, { what: 'flag 2: repeats allowed' });
  const flags = (await marksOn(1)).filter(m => m.k === 'flag');
  assert.equal(flags.length, 2);
  assert.ok(flags.every(m => m.tee === undefined), 'only a tee mark names the tee');
  await app.waitFor(() => /this hole has 2 flag marks, 1 tee mark/.test(app.text('#playMarks')), { what: 'count' });
});

test('Hurstville offers marks on every hole: its committed map is marks only', async () => {
  // Since 2.8.0 (hole-maps chat): OSM's layout was out of date, so the map has
  // no hole lines and every hole's hm is null until it's marked.
  const m = JSON.parse((await import('node:fs')).readFileSync('web/course-maps/hurstville.json', 'utf8'));
  assert.equal(m.holesFrom, 'your GPS marks');
  assert.deepEqual(m.holes, [], 'no hole is drawn before it has marks');
});

test('a hole the map draws gets no mark buttons', async () => {
  // Same check the panel uses; a mapped hole (hm present, green not estimated) wants none.
  const hm = est => `{ map: { features: [{ k: 'green', r: [] ${est ? ', est: true' : ''} }] }, hole: { green: 0 }, green: [0, 0] }`;
  assert.equal(app.E(`wantsMarks({ hm: ${hm(false)} })`), false);
  assert.equal(app.E(`wantsMarks({ hm: ${hm(true)} })`), true, 'an estimated green does, flagged on its shape as holemap.js does');
  assert.equal(app.E(`wantsMarks({ hm: undefined })`), false, 'not while the map loads');
});

test('editing the course keeps the marks', async () => {
  app.act('editCourse', { id: 'c_bw' });
  app.fill('notes', 'Short and hilly');
  assert.equal(await app.save(), true);
  await app.waitFor(async () => (await app.api.get('courses', 'c_bw')).notes === 'Short and hilly', { what: 'edit saved' });
  assert.equal((await marksOn(1)).length, 3);
});

test('the hole page counts the marks; only your own can be removed', async () => {
  // A friend marks the same hole from their phone.
  const friend = app.api.as(FRIEND), c = await friend.get('courses', 'c_bw');
  await friend.put('courses', 'c_bw', { ...c, holes: c.holes.map(h => h.n === 1 ? { ...h, marks: h.marks.concat({ k: 'flag', lat: -33.8766, lng: 151.1202, acc: 5, at: '2026-10-18T01:00:00.000Z' }) } : h) });
  await app.waitFor(() => app.E(`course('c_bw').holes[0].marks.length`) === 4, { what: 'friend mark arrives' });
  app.go('courses', { courseId: 'c_bw', hole: '1' });
  assert.match(app.text('#holeMarks'), /^GPS marks3 flag marks, 1 tee mark, from rounds played here \(some by other players\)/);
  assert.equal(app.$$('#holeMarks [data-act=removeMark]').length, 3, 'his three, not the friend’s');
  const btn = app.$('#holeMarks [data-act=removeMark][data-k=tee]');
  btn.click();
  await app.answer(true);
  await app.waitFor(async () => (await marksOn(1)).length === 3, { what: 'removed' });
  const left = await marksOn(1);
  assert.ok(!left.some(m => m.k === 'tee'), 'the tee mark is gone');
  assert.ok(left.some(m => m.by === FRIEND), 'the friend’s stays');
});
