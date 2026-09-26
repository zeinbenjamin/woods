// The Overview redesign: section order, and every number checked against a
// hand-worked scenario. Synthetic data; dates relative to today.
//
//   r_a  30 days ago, Alpha GC,   18 holes scorecard only: 3 × 8 + 15 × 6 = 114 (+42)
//   r_b  10 days ago, Bravo GC,    9 holes scorecard only: 9 × 5 = 45 (+9)
//   r_c   2 days ago, Charlie GC, 18 holes traced:
//        tee: D, fairway on odd holes (9 of 18)
//        holes 1–6:  7i from 150m onto the green
//        holes 7–18: 7i from 150m into the rough, PW from 45m onto the green
//        putts 3, 3, 1, then 2s (37); penalty on 18; first putt 1.5m (h3), ≈6m estimated (h4)
//        strokes 5, 5, 3, 4, 4, 4, then 5 × 11, 6 = 86 (+14)
//   range 20 days ago, Barton Park: 5W 12 × 147m, 7i 6 × 130m, 9i 3 × 128m, PW 12 × 80m
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const same = (n, carry, total) => Array.from({ length: n }, () => ({ carry, total }));
const rC = Array.from({ length: 18 }, (_, i) => {
  const n = i + 1, tee = { t: 0.5, u: 0, club: 'D', lie: n % 2 ? 'fairway' : 'rough' };
  const shots = n <= 6 ? [tee, { t: 0.97, u: 0, club: '7i', lie: 'green' }] : [tee, { t: 0.85, u: 0, club: '7i', lie: 'rough' }, { t: 0.98, u: 0, club: 'PW', lie: 'green' }];
  const putts = n <= 2 ? 3 : n === 3 ? 1 : 2, penalties = n === 18 ? 1 : 0;
  return { n, par: 4, metres: 300, shots, putts, penalties, strokes: shots.length + putts + penalties,
    ...(n === 3 ? { firstPutt: 1.5 } : n === 4 ? { firstPutt: 6, firstPuttEstimated: true } : {}) };
});

let app;
const seed = {
  clubs: [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 3 }), club('9i', 'iron', { order: 4 }),
    club('PW', 'wedge', { order: 5 }), club('P', 'putter', { order: 9 })],
  courses: [{ id: 'c', v: 2, name: 'Charlie GC', tee: 'white', holes: card(18) }],
  sessions: [
    { id: 'r_a', v: 2, type: 'round', date: daysAgo(30), courseId: 'x', courseName: 'Alpha GC', tee: 'white', detail: 'score_only',
      holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, metres: 300, strokes: i < 3 ? 8 : 6 })) },
    { id: 'r_b', v: 2, type: 'round', date: daysAgo(10), courseId: 'y', courseName: 'Bravo GC', tee: 'white', detail: 'score_only',
      holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, metres: 300, strokes: 5 })) },
    { id: 'r_c', v: 2, type: 'round', date: daysAgo(2), courseId: 'c', courseName: 'Charlie GC', tee: 'white', detail: 'shot_level', holes: rC },
    { id: 's1', v: 2, type: 'range', date: daysAgo(20), venue: 'Barton Park', blocks: [
      { id: 'b1', seq: 1, club: '5W', swing: 'full', shots: same(12, 147, 165) }, { id: 'b2', seq: 2, club: '7i', swing: 'full', shots: same(6, 130, 140) },
      { id: 'b3', seq: 3, club: '9i', swing: 'full', shots: same(3, 128, 136) }, { id: 'b4', seq: 4, club: 'PW', swing: 'full', shots: same(12, 80, 86) }] },
  ],
};
before(async () => { app = await startApp({ seed }); app.go('overview'); });
after(() => app && app.stop());

const tiles = sel => app.$$(`${sel} .ftile`).map(t => [t.querySelector('b').textContent, t.querySelector('small').textContent, (t.querySelector('em') || {}).textContent || '']);

test('the page is called Overview, with sections in the agreed order', () => {
  assert.equal(app.text('#view h1'), 'Overview');
  assert.ok(app.$('#view [data-act="setWindow"]'), 'the window filter is still there');
  assert.deepEqual(app.$$('#view h2').map(x => x.textContent), ['Current form', 'What to work on', 'Gapping', 'Scoring trend',
    'Where your game is being tested', 'Approach distances', 'Putting', 'Evidence', 'Recent']);
});

test('current form: last score (with penalties), to par, over par a hole, putts, fairways, greens', () => {
  assert.deepEqual(tiles('#formTiles'), [
    ['86', 'last score', `Charlie GC, ${app.E(`dateLabel(${JSON.stringify(daysAgo(2))})`)} · 1 penalty`],
    ['+14', 'to par', ''],
    ['+1.4', 'over par a hole', 'last 3 rounds'],        // (42 + 9 + 14) / 45 holes
    ['2.06', 'putts a hole', '18 holes'],                 // 37 / 18
    ['50%', 'fairways', '9 of 18'],
    ['33%', 'greens in reg', '6 of 18'],
  ]);
});

test('what to work on: the top three priorities as cards with evidence and an action, and the planner', () => {
  const cards = app.$$('#view .wcard');
  assert.equal(cards.length, 3);
  const top = app.J('rankedPractice().now.slice(0, 3).map(x => x.title)');
  assert.deepEqual(cards.map(c => c.querySelector('.wt').textContent), top, 'the existing ranking, not a new one');
  assert.ok(cards.every(c => /n=\d+|early signal|emerging|consistent|No range data/.test(c.textContent)), 'each says what it stands on');
  assert.ok(cards.some(c => c.querySelector('.wa')), 'actions where the item has one');
  assert.ok(app.$('#view [data-act="planSession"]'));
});

test('gapping keeps the ladder and says how much each club rests on', () => {
  const rungs = app.$$('#view .rung').map(r => [r.querySelector('.club').textContent, r.querySelector('.val b').textContent, r.querySelector('.conf').textContent]);
  assert.deepEqual(rungs, [['5W', '147', '12 shots · consistent'], ['7i', '130', '6 shots · emerging'], ['9i', '128', '3 shots · early signal'], ['PW', '80', '12 shots · consistent']]);
  assert.equal(app.$('#strikeProfile').open, false, 'strike profile is folded away, not lost');
});

test('distance gaps are flagged only against his own typical gap', () => {
  const gaps = app.$$('#gapList .gap').map(g => [g.children[0].textContent, g.children[1].textContent, g.children[2].textContent]);
  assert.deepEqual(gaps, [
    ['5W → 7i', '17m', ''],
    ['7i → 9i', '2m', '⚠ much closer than your other gaps · early signal'],
    ['9i → PW', '48m', '⚠ much wider than your other gaps · early signal'],
  ]);
  assert.match(app.text('#view'), /your typical gap is 17m/);
});

test('a club that carries no further than the next one down is always flagged', () => {
  const stats = [['5i', 3, 140, 20], ['7i', 4, 142, 20], ['9i', 5, 120, 20]].map(([code, order, stockCarry, n]) => ({ c: { code, order }, s: { stockCarry, n } }));
  const g = app.J(`gapHealth(${JSON.stringify(stats)}).pairs.map(p => [p.gap, p.flag || null])`);
  assert.deepEqual(g, [[-2, '5i carries no further than 7i'], [22, null]]);
});

test('scoring trend: bars oldest to newest, per-hole average, best by round length, blow-ups', () => {
  const bars = app.$$('#view .trend button');
  assert.deepEqual(bars.map(b => b.dataset.go), ['rounds:sessionId:r_a', 'rounds:sessionId:r_b', 'rounds:sessionId:r_c'], 'still tappable, oldest first');
  assert.deepEqual(bars.map(b => b.textContent), ['+42', '+99h', '+14'], '+9 on the 9-hole round, marked with a small 9h');
  assert.deepEqual(tiles('#scoreTiles'), [
    ['+1.4', 'over par a hole', '≈ +26 per 18 · 3 rounds'],   // 65 / 45 × 18
    ['+14', 'best 18', ''], ['+9', 'best 9', ''],
    ['3', 'blow-ups', 'triple bogey or worse · 3 of 45 holes'],
  ]);
});

test('where the game is being tested: counts of missed targets, labelled as not strokes gained', () => {
  const rows = app.$$('#breakdown .brk').map(r => [r.querySelector('span').textContent, r.querySelector('small').textContent, r.querySelector('em').textContent]);
  assert.deepEqual(rows, [
    ['Tee', '50%', '9 of 18 missed the fairway'],
    ['Approach', '67%', '12 of 18 missed the green'],
    ['Short game', '0%', '0 of 12 missed the green'],
    ['Putting', '11%', '2 of 18 took 3+ putts'],
    ['Penalties', '6%', '1 of 18 had a penalty'],
  ]);
  assert.match(app.text('#view'), /Counts, not strokes gained\./);
});

test('approach distances: the most common bands, the headline band, and the nearest measured club', () => {
  const bands = app.$$('#approachBands .hbar').map(b => [b.querySelector('span').textContent, b.querySelector('small').textContent, b.querySelector('em').textContent.trim()]);
  assert.deepEqual(bands, [['40–59m', '12', ''], ['140–159m', '18', '5W 147m']]);
  assert.match(app.text('#view'), /Most often 140–159m: 18 of 30 approach shots\./);
  assert.match(app.text('#view'), /These are the distances your rounds actually ask you to play/);
});

test('putting: compact metrics and how much of it is measured', () => {
  assert.deepEqual(tiles('#puttTiles'), [['2.06', 'putts a hole', ''], ['2', 'three-putts', ''], ['50%', 'one-putt', 'from a known distance'], ['3.8m', 'median first putt', '']]);
  assert.equal(app.text('#puttCover'), 'First-putt distance on 2 of 18 holes, 1 of them estimated from where you tapped.');
});

test('evidence: what everything above stands on', () => {
  assert.deepEqual(tiles('#evidenceTiles'), [['33', 'range shots', ''], ['18', 'shot-level holes', ''], ['3', 'rounds', '2 scorecard only'], ['0', 'swing analyses', '']]);
});

test('recent: a few one-line items that open the session', () => {
  const items = app.$$('#recentList .recent');
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(i => i.dataset.go), ['rounds:sessionId:r_c', 'rounds:sessionId:r_b', 'range:sessionId:s1', 'rounds:sessionId:r_a']);
  assert.match(items[1].textContent, /Bravo GC · 45 \(\+9, 9 holes\)/);
  assert.match(items[2].textContent, /Range · Barton Park · 33 shots/);
  assert.equal(app.$$('#view .scorestrip').length, 0, 'no score strips on the Overview');
});

test('nothing is shown that the data does not support', async () => {
  const lean = await startApp({ seed: { clubs: [club('7i', 'iron')], sessions: [
    { id: 'r1', v: 2, type: 'round', date: daysAgo(3), courseId: 'x', courseName: 'Solo GC', tee: 'white', detail: 'score_only',
      holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, metres: 300, strokes: 6 })) }] } });
  try {
    lean.go('overview');
    const t = lean.$$('#formTiles .ftile small').map(x => x.textContent);
    assert.deepEqual(t, ['last score', 'to par'], 'one scorecard round: no average, putts, penalties, fairways or greens');
    assert.match(lean.text('#formTiles'), /9 holes/);
    const heads = lean.$$('#view h2').map(x => x.textContent);
    for (const h of ['Where your game is being tested', 'Approach distances', 'Putting']) assert.ok(!heads.includes(h), `no ${h} without shot data`);
    assert.ok(heads.includes('Gapping') && lean.$('#view .empty'), 'gapping explains how to get it');
  } finally { lean.stop(); }
});

test('an empty app points at where to start', async () => {
  const empty = await startApp({ seed: {} });
  try {
    empty.go('overview');
    assert.equal(empty.text('#view h1'), 'Overview');
    assert.match(empty.text('#view .empty'), /Nothing logged yet/);
  } finally { empty.stop(); }
});
