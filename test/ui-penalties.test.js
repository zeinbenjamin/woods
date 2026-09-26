// The penalty report: which shots cost penalty strokes, and where.
//
// Scenario (synthetic):
//   r1 (20 days ago), traced:
//     h1  D off the tee into the water, marked as the penalty shot
//     h2  D into the trees; a penalty added with the hole's counter (not tied to a shot)
//     h3  D to the fairway, then a 7i approach into the water, marked
//   r2 (5 days ago), traced:
//     h1  D into the water again, marked      h2  clean
//   r3 scorecard only — says nothing about penalties
//   → 4 penalty strokes: 3 tied to a shot (D ×2, 7i ×1), 1 not; hole 1 is a repeat
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hole = (n, shots, extra = {}) => ({ n, par: 4, metres: 300, shots, putts: 2, strokes: shots.length + 2 + (extra.penalties || 0) + shots.filter(s => s.penalty).length, ...extra });
const round = (id, ago, holes, name = 'Test GC') => ({ id, v: 2, type: 'round', date: daysAgo(ago), courseId: 'c', courseName: name, tee: 'white', detail: 'shot_level', holes });

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 3 }), club('PW', 'wedge', { order: 5 })],
    courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }],
    sessions: [
      round('r1', 20, [
        hole(1, [{ t: 0.5, u: 1.3, club: 'D', lie: 'water', penalty: true }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }]),
        hole(2, [{ t: 0.5, u: 1.3, club: 'D', lie: 'trees' }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }], { penalties: 1 }),
        hole(3, [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.9, u: 1.3, club: '7i', lie: 'water', penalty: true }, { t: 0.97, u: 0, club: 'PW', lie: 'green' }]),
      ]),
      round('r2', 5, [
        hole(1, [{ t: 0.5, u: 1.3, club: 'D', lie: 'water', penalty: true }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }]),
        hole(2, [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }]),
      ]),
      { id: 'r3', v: 2, type: 'round', date: daysAgo(1), courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'score_only',
        holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, metres: 300, strokes: 6 })) },
    ],
  } });
});
after(() => app && app.stop());

test('the totals: tied to a shot, not tied to one, and how many holes had any', () => {
  const p = app.J('penaltyReport()');
  assert.deepEqual([p.total, p.attached.length, p.loose, p.traced, p.holesWith, p.scorecardOnly], [4, 3, 1, 5, 3, 1]);
});

test('broken down by club (with how often the club was used), by shot, and by where the ball went', () => {
  const p = app.J('penaltyReport()');
  assert.deepEqual(p.byClub, [{ club: 'D', n: 2, of: 5 }, { club: '7i', n: 1, of: 1 }]);
  assert.deepEqual(p.byKind, [['Tee shot', 2], ['Approach', 1]]);
  assert.deepEqual(p.byLie, [['water', 3]]);
});

test('holes are ranked, and a hole that costs penalties in more than one round is called a repeat', () => {
  const p = app.J('penaltyReport()');
  assert.deepEqual(p.holes.map(h => [h.n, h.strokes, new Set(h.rounds).size, h.latest.id]), [[1, 2, 2, 'r2'], [2, 1, 1, 'r1'], [3, 1, 1, 'r1']]);
});

test('the report page shows it all, links each hole to its latest trace, and says what it leaves out', () => {
  app.go('rounds', { view: 'penalties' });
  assert.equal(app.text('#view h1'), 'Penalty report');
  const tiles = app.$$('#penTiles .ftile').map(t => [t.querySelector('b').textContent, t.querySelector('small').textContent]);
  assert.deepEqual(tiles, [['4', 'penalty strokes'], ['3', 'holes with one'], ['3', 'tied to a shot'], ['1', 'not tied to a shot']]);
  assert.match(app.text('#penLoose'), /1 penalty was added with a hole's penalty counter, so what caused it isn't known/);
  assert.deepEqual(app.$$('#penClub tr').map(tr => [...tr.cells].map(c => c.textContent)), [['D', '2', 'of 5 shots with it on traced holes'], ['7i', '1', 'of 1 shot with it on traced holes']]);
  const first = app.$('#penHoles .item');
  assert.equal(first.dataset.go, 'rounds:sessionId=r2,hole=1');
  assert.match(first.textContent, /Test GC · hole 1.*2 penalty strokes in 2 rounds — a repeat/s);
  assert.match(app.text('#view'), /1 scorecard-only round not included/);
});

test('reachable from the Rounds list and from the Overview', () => {
  app.go('rounds');
  const link = app.$('#view [data-go="rounds:view=penalties"]');
  assert.match(link.textContent, /Penalty report: 4 penalty strokes/);
  app.go('overview');
  assert.ok(app.$('#view [data-go="rounds:view=penalties"]'));
  app.click('#view [data-go="rounds:view=penalties"]');
  assert.equal(app.text('#view h1'), 'Penalty report');
});

test('with no traced holes it explains why there is nothing to show', async () => {
  const bare = await startApp({ seed: { sessions: [{ id: 'r', v: 2, type: 'round', date: daysAgo(1), courseId: 'c', courseName: 'X', tee: 'white',
    holes: [{ n: 1, par: 4, metres: 300, strokes: 7 }] }] } });
  try {
    bare.go('rounds', { view: 'penalties' });
    assert.match(bare.text('#view'), /Penalties are only known on holes you traced shot by shot/);
    bare.go('rounds');
    assert.equal(bare.$('#view [data-go="rounds:view=penalties"]'), null, 'no link when there is nothing to report');
  } finally { bare.stop(); }
});

test('two penalties on one hole in the same round are not a repeat', async () => {
  const one = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('PW', 'wedge', { order: 5 })],
    courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }],
    sessions: [round('r', 2, [hole(1, [{ t: 0.5, u: 1.3, club: 'D', lie: 'water', penalty: true }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }], { penalties: 1 })])],
  } });
  try {
    one.go('rounds', { view: 'penalties' });
    const text = one.text('#penHoles');
    assert.match(text, /2 penalty strokes in 1 round/);
    assert.doesNotMatch(text, /a repeat/);
  } finally { one.stop(); }
});
