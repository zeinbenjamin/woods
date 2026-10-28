// "Getting to the green" (2.21.0): under a round's scorecard, how each score
// was made up: long shots, chips, sand shots and putts, from the traced shots
// on a traced hole and from tapped-in counts on a scores-only hole, with a
// one-paragraph narrative. Checked against a hand-worked round.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

let app;
const R = 'r_tg';
// Hole 1 traced: drive to 150 m out (long), second into a bunker by the green
// (long, from 150 m), out of the sand to 15 m (sand), chip onto the green
// (chip, from 15 m), two putts: 4 shots + 2 putts = 6. Hole 2: scores only, 5.
// Hole 3: scores only, 4, with a penalty on the hole counter.
const HOLES = [
  { n: 1, par: 4, metres: 300, shots: [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.96, u: 0.4, club: '7i', lie: 'bunker' }, { t: 0.95, u: 0, club: '56', lie: 'rough' }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], putts: 2, strokes: 6 },
  { n: 2, par: 4, metres: 300, strokes: 5 },
  { n: 3, par: 3, metres: 140, strokes: 4, penalties: 1 },
  ...card(9).slice(3).map(({ n, par, metres }) => ({ n, par, metres })),
];
before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver'), club('7i', 'iron'), club('PW', 'wedge'), club('56', 'wedge')],
    courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }],
    sessions: [{ id: R, v: 2, type: 'round', date: '2026-10-20', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes: HOLES }] } });
});
after(() => app && app.stop());

test('a traced hole is broken down from its shots: long, chips, sand, putts', () => {
  const b = app.J(`holeBreakdown(holesOf(session('${R}'))[0])`);
  assert.deepEqual(b, { long: 2, chips: 1, sand: 1, putts: 2, pens: 0, derived: true, known: true });
  assert.equal(app.J(`holeBreakdown({ n: 9, par: 4 })`), null, 'no score, nothing to break down');
  const unknown = app.J(`holeBreakdown(holesOf(session('${R}'))[1])`);
  assert.deepEqual(unknown, { long: null, chips: null, sand: null, putts: null, pens: 0, derived: false, known: false }, 'a scores-only hole with nothing tapped in');
});

test('the fold under the scorecard: table, teaser and narrative from the holes that are known', async () => {
  app.go('rounds', { sessionId: R });
  const f = app.$('#toGreen');
  assert.ok(f && f.tagName === 'DETAILS' && !f.open, 'folded, with an id');
  assert.ok(app.$('#scorecard').compareDocumentPosition(f) & 4, 'after the scorecard');
  assert.match(app.text('#toGreen summary'), /Getting to the green 2\.0 to the green · 1\.0 chips · 1\.0 sand · 2\.0 putts a hole/, 'only hole 1 is known so far');
  const rows = app.$$('#toGreen table.tg tbody tr').map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  assert.deepEqual(rows[0], ['1', '2', '1', '1', '2', '–', '6'], 'hole 1 from its shots (penalty column shown because hole 3 has one)');
  assert.deepEqual(rows[1], ['2', '–', '–', '–', '–', '–', '5'], 'hole 2: nothing tapped in yet');
  assert.deepEqual(rows[2], ['3', '–', '–', '–', '–', '1', '4']);
  assert.equal(rows.length, 4, 'three scored holes and the total; unscored holes are not listed');
  assert.deepEqual(rows[3], ['1 holes', '2', '1', '1', '2', '', '6']);
  assert.match(app.text('#toGreenStory'), /Over 1 hole with putts recorded: 6 strokes, of which 2 \(33%\) got the ball to the green and 4 \(67%\) were spent from inside 60 m: 1 chip, 1 sand shot and 2 putts\. Reaching the green took par 4s in 2\.0 long shots on average\./);
  assert.match(app.text('#toGreenEntry summary'), /2 holes without traced shots/);
  assert.equal(app.$$('#toGreenEntry .tgrow').length, 2, 'holes 2 and 3; hole 1 is decided by its shots');
});

test('tapping putts, chips and sand on a scores-only hole stores the counts; long shots are what is left', async () => {
  app.go('rounds', { sessionId: R });
  const tap = (n, field, v) => app.$(`#toGreenEntry [data-n="${n}"][data-field="${field}"][data-v="${v}"]`).click();
  tap(2, 'putts', 2);
  await app.waitFor(() => app.E(`session('${R}').holes[1].putts`) === 2, { what: 'putts saved' });
  tap(2, 'chips', 1);
  await app.waitFor(() => app.E(`session('${R}').holes[1].chips`) === 1, { what: 'chips saved' });
  assert.deepEqual(app.J(`(({ long, chips, sand, putts }) => ({ long, chips, sand, putts }))(holeBreakdown(session('${R}').holes[1]))`), { long: 2, chips: 1, sand: null, putts: 2 }, '5 − 2 putts − 1 chip = 2 long; sand not tapped counts as none');
  // Hole 3: 4 strokes with a penalty: 2 putts + 1 sand leaves 0 long; a third chip would overrun the score.
  tap(3, 'putts', 2);
  await app.waitFor(() => app.E(`session('${R}').holes[2].putts`) === 2, { what: 'putts' });
  tap(3, 'sand', 1);
  await app.waitFor(() => app.E(`session('${R}').holes[2].sand`) === 1, { what: 'sand' });
  assert.equal(app.E(`holeBreakdown(session('${R}').holes[2]).long`), 0, '4 − 2 − 1 − 1 penalty');
  tap(3, 'chips', 1);
  await app.waitFor(() => /more than the 4 strokes/.test(app.text('#toast')), { what: 'refused' });
  assert.equal(app.E(`session('${R}').holes[2].chips`), undefined, 'not stored');
  app.go('rounds', { sessionId: R });
  assert.match(app.text('#toGreen summary'), /1\.3 to the green · 0\.7 chips · 0\.7 sand · 2\.0 putts a hole/, '(2+2+0)/3, (1+1+0)/3, (1+0+1)/3, 6/3');
  const rows = app.$$('#toGreen table.tg tbody tr').map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  assert.deepEqual(rows[1], ['2', '2', '1', '–', '2', '–', '5']);
  assert.deepEqual(rows[3], ['Total', '4', '2', '2', '6', '1', '15']);
  assert.match(app.text('#toGreenStory'), /Over 3 holes with putts recorded: 15 strokes, of which 4 \(27%\)[\s\S]*plus 1 penalty stroke\. Reaching the green took par 3s in 0\.0, par 4s in 2\.0 long shots on average\./);
  assert.equal(app.$(`#toGreenEntry [data-n="2"][data-field="chips"][data-v="1"]`).getAttribute('aria-pressed'), 'true', 'the tapped value shows pressed');
});

test('a traced hole refuses tapped counts: its shots decide', async () => {
  app.go('rounds', { sessionId: R });
  app.act('setHoleCount', { sid: R, n: '1', field: 'chips', v: '3' });
  await app.waitFor(() => /shots traced/.test(app.text('#toast')), { what: 'refused' });
  assert.equal(app.E(`session('${R}').holes[0].chips`), undefined);
});
