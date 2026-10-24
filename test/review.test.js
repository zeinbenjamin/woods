// Bugs found in the 2.11.1 end-to-end review, each reproduced here before it
// was fixed: the Edit round form dropping shot-tied penalties from a traced
// hole's score; the practice list's "Penalty strokes" item ignoring penalties
// tied to a shot; a round's tee matched to the card's tee sets by exact case,
// so "Blue" fell back to the primary tee's lengths; a lie never recorded
// counted as a miss; a missing hole on a round's grid opening a course edit
// for the round's id; a course's "best" mixing 9- and 18-hole rounds; a
// booking link with a script scheme; a round with no score yet shown as 0.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const COURSE = { id: 'c_rv', v: 2, name: 'Review Park', tee: 'white', holes: card(9, { par: [4, 3], metres: [300, 140] }).map(h => ({ ...h, tees: { white: h.metres, blue: h.metres + 20 } })) };
const PEN = { t: 0.5, u: 1.3, club: 'D', lie: 'water', penalty: true };
let app;
const round = (id, holes, extra = {}) => ({ id, v: 2, type: 'round', date: '2026-10-20', courseId: 'c_rv', courseName: 'Review Park', tee: 'white', detail: 'shot_level', holes, ...extra });

before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver'), club('7i', 'iron'), club('PW', 'wedge')], courses: [COURSE], sessions: [
    // Hole 1 traced with a shot-tied penalty: 2 shots + 2 putts + 1 penalty = 5.
    round('r_pen', card(9, { par: [4, 3], metres: [300, 140] }).map(h => h.n === 1 ? { ...h, shots: [PEN, { t: 0.96, u: 0, club: 'PW', lie: 'green' }], putts: 2, strokes: 5 } : { ...h, strokes: h.par })),
  ] } });
});
after(() => app && app.stop());

test('editing a round through its form keeps shot-tied penalties in a traced hole\'s score', async () => {
  app.act('editRound', { id: 'r_pen' });
  app.fill('notes', 'windy');
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`session('r_pen').notes`) === 'windy', { what: 'saved' });
  assert.equal(app.E(`session('r_pen').holes[0].strokes`), 5, 'shots + putts + the penalty on the shot, as the logger counts it');
});

test('a penalty tied to a shot makes the "Penalty strokes" practice item, like one on the hole counter', () => {
  const it = app.J(`practiceItems().find(x => x.key === 'penalty') || null`);
  assert.ok(it, 'the item exists');
  assert.equal(it.title, 'Penalty strokes: 1 in 1 hole');
  assert.equal(it.score, 0.6);
});

test('a round\'s tee matches the card\'s tee sets ignoring case', () => {
  assert.equal(app.E(`teeMetres(course('c_rv').holes[0], 'Blue')`), 320);
  assert.equal(app.E(`teeMetres(course('c_rv').holes[0], 'BLUE')`), 320);
  assert.equal(app.E(`teeMetres(course('c_rv').holes[0], 'red')`), 300, 'an unknown tee still falls back to the primary');
  const r = { ...round('r_blue', card(9, { par: [4, 3], metres: [300, 140] }).map(h => ({ ...h, strokes: h.par })), { tee: 'Blue' }) };
  assert.equal(app.E(`holesOf(${JSON.stringify(r)})[0].metres`), 320, 'the round\'s distances resolve through the blue set');
});

test('a shot whose lie was never recorded is neither a hit nor a miss', async () => {
  // A map-style shot ({mx, my}) with no lie, on a hole with no map: lieOf is 'unknown'.
  const r = round('r_unk', card(9, { par: [4, 3], metres: [300, 140] }).map(h => h.n === 3 ? { ...h, shots: [{ t: 0.5, u: 0, club: 'D' }, { t: 0.95, u: 0, club: '7i', lie: 'green' }], putts: 2, strokes: 4 } : { ...h, strokes: h.par }));
  await app.api.put('sessions', 'r_unk', r);
  await app.waitFor(() => app.E(`!!session('r_unk')`), { what: 'round' });
  // The outline gives shot 1 a lie (fairway) from its position; strip it by making it unplaceable on the outline but still measurable? No: use the explicit route.
  assert.equal(app.E(`lieOf({ par: 4, metres: 300 }, { mx: 1, my: 2 })`), 'unknown', 'no lie, no outline position: unknown');
  const rows = app.J(`gameBreakdown().rows`);
  const tee = rows.find(x => x.key === 'tee');
  assert.deepEqual({ of: tee.of, missed: tee.missed }, { of: 2, missed: 1 }, 'the two outline tee shots count (hole 1 water, hole 3 fairway)');
  // Now an unknown lie on a tee shot: a map shot on a course with no map.
  await app.api.put('sessions', 'r_unk', { ...r, holes: r.holes.map(h => h.n === 3 ? { ...h, shots: [{ mx: 10, my: 20, club: 'D' }, { t: 0.95, u: 0, club: '7i', lie: 'green' }] } : h) });
  await app.waitFor(() => app.E(`session('r_unk').holes[2].shots[0].mx`) === 10, { what: 'unknown lie' });
  const t2 = app.J(`gameBreakdown().rows`).find(x => x.key === 'tee');
  assert.deepEqual({ of: t2.of, missed: t2.missed }, { of: 1, missed: 1 }, 'the unknown one is left out, not counted as a miss');
  assert.equal(app.J(`practiceItems().filter(x => x.key === 'tee:D')`)[0].n, 1);
  const fir = app.J(`roundStats(session('r_unk')).fir`);
  assert.deepEqual(fir, { hit: 0, of: 0 }, 'fairways hit on this round: no drive with a known lie');
});

test('a missing hole on a round\'s grid opens the course, not a crash', async () => {
  await app.api.put('courses', 'c_rv', { ...COURSE, holes: COURSE.holes.filter(h => h.n !== 9) });
  await app.api.put('sessions', 'r_gap', round('r_gap', [...card(8, { par: [4, 3], metres: [300, 140] }).map(h => ({ ...h, strokes: h.par })), { n: 9 }]));
  await app.waitFor(() => app.E(`!!session('r_gap') && course('c_rv').holes.length === 8`), { what: 'gap' });
  app.go('rounds', { sessionId: 'r_gap' });
  const tile = app.$('#view .tile.missing');
  assert.ok(tile, 'hole 9 shows as missing');
  tile.click();
  await app.waitFor(() => app.sheetOpen(), { what: 'course form' });
  assert.match(app.text('#sheetInner h2'), /Edit course/);
  assert.equal(app.field('name').value, 'Review Park');
  app.click('#sheetInner [data-close]');
  await app.api.put('courses', 'c_rv', COURSE);
  await app.waitFor(() => app.E(`course('c_rv').holes.length === 9`), { what: 'card back' });
});

test('a course\'s best score is the best full round, not a nine against an eighteen', async () => {
  await app.api.put('sessions', 'r_half', round('r_half', card(9, { par: [4, 3], metres: [300, 140] }).map(h => h.n <= 4 ? { ...h, strokes: 3 } : h)));
  await app.waitFor(() => app.E(`!!session('r_half')`), { what: 'partial round' });
  app.go('courses');
  const item = app.$$('#view .item').find(b => /Review Park/.test(b.textContent));
  assert.equal(item.querySelector('.n').textContent, '32', 'the best of the full rounds (r_unk 32, r_pen 33; r_half and r_gap are not full, and r_half\'s 12 is not a score)');
});

test('a booking link only opens http(s)', async () => {
  await app.api.put('courses', 'c_rv', { ...COURSE, bookingUrl: 'javascript:alert(1)' });
  await app.waitFor(() => app.E(`course('c_rv').bookingUrl`) === 'javascript:alert(1)', { what: 'link' });
  app.go('courses', { courseId: 'c_rv' });
  assert.equal(app.$('#view #courseInfo a[href^="javascript"]'), null, 'no script link');
  await app.api.put('courses', 'c_rv', COURSE);
});

test('a round with nothing scored yet says so instead of 0 +0', async () => {
  await app.api.put('sessions', 'r_new', round('r_new', card(9, { par: [4, 3], metres: [300, 140] }).map(({ n, par, metres }) => ({ n, par, metres })), { date: '2026-10-24', detail: 'score_only' }));
  await app.waitFor(() => app.E(`!!session('r_new')`), { what: 'empty round' });
  app.go('rounds');
  const item = app.$$('#view .item').find(b => /24 Oct 2026/.test(b.textContent));
  assert.match(item.textContent, /not scored yet/);
  assert.doesNotMatch(item.textContent, /\+0/);
});
