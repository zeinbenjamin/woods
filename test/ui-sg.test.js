// Strokes gained (2.35.0): every traced shot against a baseline of expected
// strokes to hole out, by lie and distance, at a reference handicap level.
// Hand-worked against the table: a par 4 of 300 yards (274.32 m) at scratch,
// a par 3 with a penalty and no first-putt distance, a scores-only hole.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

let app;
const R = 'r_sg';
const HOLES = [
  // Tee shot to 100 yd (91.44 m) in the fairway, second onto the green, first putt 10 ft (3.048 m), 2 putts: 4.
  { n: 1, par: 4, metres: 274.32, shots: [{ t: 2 / 3, u: 0, club: 'D', lie: 'fairway' }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], putts: 2, firstPutt: 3.048 },
  { n: 2, par: 4, metres: 300, strokes: 5 },
  // Par 3, 140 m: tee shot into the rough 70 m out with a penalty, on the green, one putt, no first-putt distance: 4.
  { n: 3, par: 3, metres: 140, shots: [{ t: 0.5, u: 0, club: '7i', lie: 'rough', penalty: true }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], putts: 1 },
  ...card(9).slice(3).map(({ n, par, metres }) => ({ n, par, metres })),
];
before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver'), club('7i', 'iron'), club('PW', 'wedge')],
    // Lengths resolve through the course card, so the card carries the hand-worked ones.
    courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9, { par: [4, 4, 3], metres: [274.32, 300, 140] }) }],
    settings: { sgLevel: 0 },
    sessions: [{ id: R, v: 2, type: 'round', date: '2026-10-20', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes: HOLES }] } });
});
after(() => app && app.stop());

test('the baseline reads the table, interpolates between rows, adds the level allowance, and holds the last row beyond it', () => {
  // Scratch: 1 extra stroke over the table's 71, so +0.0464 a long shot, +0.0286 a short shot, +0.005 a putt.
  assert.equal(app.E(`sgBaseline('tee', 274.32, 0).toFixed(4)`), '3.7564', '300 yd off the tee: 3.71 + 0.0464');
  assert.equal(app.E(`sgBaseline('fairway', 91.44, 0).toFixed(4)`), '2.8464', '100 yd from the fairway: 2.80 + 0.0464 (100 yd counts as long)');
  assert.equal(app.E(`sgBaseline('green', 3.048, 0).toFixed(3)`), '1.631', '10 ft: 1.626 + 0.005');
  assert.equal(app.E(`sgBaseline('rough', 70, 0).toFixed(4)`), '2.9800', '76.55 yd in the rough: between 60 (2.91) and 80 (2.96), + 0.0286 short');
  assert.equal(app.E(`sgBaseline('recovery', 70, 0).toFixed(4)`), '3.4800', 'trees: rough + 0.5');
  assert.equal(app.E(`sgBaseline('sand', 500, 0).toFixed(4)`), '3.5964', 'beyond the sand column the last row holds');
  assert.equal(app.E(`sgBaseline('fairway', 91.44, 20).toFixed(4)`), '3.7750', 'a 20-handicap: 21 extra, 0.975 a long shot');
});

test('a hole is scored shot by shot and adds up to expected minus strokes; no first putt pools the last shot and the putts', () => {
  const r = app.J(`sgRound(session('${R}'), 0)`);
  assert.deepEqual(r.left, [2], 'the scores-only hole is left out and named');
  assert.equal(r.holes.length, 2);
  const h1 = r.holes[0];
  // Tee: 3.7564 − 2.8464 − 1 = −0.09. Approach: 2.8464 − 1.631 − 1 = +0.2154. Putting: 1.631 − 2 = −0.369.
  assert.deepEqual(Object.fromEntries(Object.entries(h1.cats).map(([k, c]) => [k, [c.n, +c.gained.toFixed(4)]])), { tee: [1, -0.09], approach: [1, 0.2154], putting: [1, -0.369] });
  assert.equal(h1.total.toFixed(4), '-0.2436');
  assert.equal((h1.expected - 4).toFixed(4), '-0.2436', 'the hole adds up to expected minus strokes');
  const h3 = r.holes[1];
  assert.equal(h3.pooled, true);
  // Tee shot (a par 3's first shot is an approach): 3.0295 − 2.9799 − 1 − 1 penalty = −1.9504; then pooled: 2.9799 − 1 − 1 putt = +0.9799.
  assert.deepEqual(Object.keys(h3.cats), ['approach']);
  assert.equal(h3.cats.approach.n, 2);
  assert.equal(h3.total.toFixed(4), '-0.9705');
  assert.equal((h3.expected - 4).toFixed(4), '-0.9705', 'the penalty is in the strokes and in the shot');
  assert.equal(r.total.toFixed(4), '-1.2140');
  assert.equal(r.pooled, 1);
});

test('the level is the nearest to the handicap, pinned in Settings, or 20 without one', async () => {
  assert.deepEqual(app.J(`sgLevel()`), { level: 0, how: 'pinned in Settings' });
  await app.api.put('settings', 'app', { id: 'app', sgLevel: 'auto' });
  await app.waitFor(() => app.E(`settings().sgLevel === 'auto'`), { what: 'setting' });
  assert.deepEqual(app.J(`sgLevel()`), { level: 20, how: 'no handicap estimate yet, so 20' });
  app.go('settings');
  assert.equal(app.$('#strokesGainedRef .chip[data-v="auto"]').getAttribute('aria-pressed'), 'true');
  app.click('#strokesGainedRef .chip[data-v="10"]');
  await app.waitFor(async () => (await app.api.get('settings', 'app')).sgLevel === 10, { what: 'pinned' });
  assert.deepEqual(app.J(`sgLevel()`), { level: 10, how: 'pinned in Settings' });
  await app.api.put('settings', 'app', { id: 'app', sgLevel: 0 });
  await app.waitFor(() => app.E(`settings().sgLevel === 0`), { what: 'back to scratch' });
});

test('the round page folds it under Getting to the green, with the two biggest losses as the teaser and the limits said', () => {
  app.go('rounds', { sessionId: R });
  const f = app.$('#strokesGained');
  assert.ok(f, 'the fold');
  assert.match(app.text('#strokesGained summary'), /Strokes gained −0\.8 approaches, −0\.4 putting vs a 0-handicap/);
  assert.match(app.text('#strokesGained'), /Over 2 traced holes: 8 strokes against 6\.8 expected of a 0-handicap from the same tees, −1\.2 in all\. Left out, not traced through or no putts recorded: hole 2\. On 1 hole with no first-putt distance the last shot and the putts are pooled on the shot\./);
  const rows = app.$$('#sgTable tbody tr').map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  assert.deepEqual(rows, [['Approaches', '3', '−0.8', '−0.3'], ['Putting', '1', '−0.4', '−0.4'], ['Off the tee', '1', '−0.1', '−0.1']], 'worst first');
  assert.match(app.text('#strokesGained'), /An estimate against a published table, not an official number/);
  assert.match(app.text('#strokesGained'), /changes nothing about the plan or the armed club/);
  assert.ok(app.$('#toGreen'), 'Getting to the green is still there');
});

test('the Overview fold needs three fully traced rounds and says so; nothing derived is stored', async () => {
  app.go('overview');
  assert.match(app.text('#ovStrokesGained summary'), /needs 3 fully traced rounds, you have 0/, 'the one round has a scores-only hole, so it is not fully traced');
  const s = await app.api.get('sessions', R);
  assert.equal(JSON.stringify(s).includes('gained'), false, 'no strokes-gained figure on the round document');
  assert.deepEqual(Object.keys(await app.api.get('settings', 'app')).sort(), ['id', 'sgLevel']);
});
