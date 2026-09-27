// The estimated handicap: the World Handicap System applied to his rounds.
//
// Hand-worked scenario (synthetic). Test GC: 18 holes, all par 4 (par 72),
// stroke index = hole number, white tees rated 70.0 / slope 125, so each
// differential is 113/125 × (adjusted gross − 70) = 0.904 × (AGS − 70).
//
//   r1  no index yet: 17×6 + a 10 on hole 1, capped at par+5 = 9 → 111 → 37.1
//   r2  all 6 → 108 → 34.4
//   r3  all 7 → 126 → 50.6
//       3 scores: lowest 1 (34.4) − 2.0 → index 32.4
//   r4  course handicap round(32.4 × 125/113 + (70 − 72)) = 34: two strokes on
//       SI 1–16, one on SI 17–18. A 12 on hole 1 caps at 4+2+2 = 8, a 9 on
//       hole 17 (the first hole with only one stroke) caps at 4+2+1 = 7, the rest 6 → 111 → 37.1
//       4 scores: lowest 1 − 1.0 → 33.4
//   r5  all 5 except a 6 on hole 1 → 91 → 19.0. That is 14.4 below 33.4, so
//       exceptional: every score so far loses 2 → 35.1 32.4 48.6 35.1 17.0
//       5 scores: lowest 1 → 17.0
//   r6+r7  two front nines of all 6 (54 each, under every cap), paired:
//       108 against 35.0 + 35.0 (half the 18-hole rating each) → 34.4
//       6 scores: lowest 2 (17.0, 32.4) averaged, − 1.0 → 23.7
//   r8  at a course with no rating: can't count, and says which rating is missing
//   r9  12 holes scored (1–12): posted as a front-nine score, waiting for a pair
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const scores = (list, from = 1) => list.map((strokes, i) => ({ n: from + i, par: 4, metres: 300, strokes }));
const all = (n, v) => Array(n).fill(v);
const round = (id, ago, holes, extra = {}) => ({ id, v: 2, type: 'round', date: daysAgo(ago), courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'score_only', holes, ...extra });
const rated = { id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(18), ratings: { white: { cr: 70, slope: 125 } } };

let app;
before(async () => {
  app = await startApp({ seed: {
    courses: [rated, { id: 'u', v: 2, name: 'Unrated GC', tee: 'white', holes: card(18) }],
    sessions: [
      round('r1', 90, scores([10, ...all(17, 6)])),
      round('r2', 80, scores(all(18, 6))),
      round('r3', 70, scores(all(18, 7))),
      round('r4', 60, scores([12, ...all(15, 6), 9, 6])),
      round('r5', 50, scores([6, ...all(17, 5)])),
      round('r6', 40, scores(all(9, 6))),
      round('r7', 30, scores(all(9, 6))),
      round('r8', 20, scores(all(18, 6)), { courseId: 'u', courseName: 'Unrated GC' }),
      round('r9', 10, scores(all(12, 6))),
    ],
  } });
});
after(() => app && app.stop());

test('each score and the index after it, worked by hand', () => {
  const h = app.J(`(() => { const h = handicap(); return { index: h.index, scores: h.scores.map(s => [s.rounds.map(r => r.id).join('+'), s.ags, s.diff, s.adj]), history: h.history.map(x => x.hi) }; })()`);
  assert.deepEqual(h.scores, [['r1', 111, 37.1, -2], ['r2', 108, 34.4, -2], ['r3', 126, 50.6, -2], ['r4', 111, 37.1, -2], ['r5', 91, 19, -2], ['r6+r7', 108, 34.4, 0]]);
  assert.deepEqual(h.history, [32.4, 33.4, 17, 23.7]);
  assert.equal(h.index, 23.7);
});

test('rounds that can\'t count say why, and name the rating that is missing', () => {
  const left = app.J(`handicap().left.map(x => [x.r.id, x.why])`);
  assert.deepEqual(left, [['r8', 'no course rating for the white tees']]);
  assert.deepEqual(app.J(`(() => { const w = handicap().waiting; return [w.rounds[0].id, w.n, w.ags, w.cr]; })()`), ['r9', 9, 54, 35], '12 holes post the nine with more of them');
  assert.deepEqual(app.J('handicap().needsRatings'), [{ id: 'u', name: 'Unrated GC', tee: 'white' }]);
});

test('the Overview shows the estimate, how it was worked out, and the scores behind it', () => {
  app.go('overview');
  assert.equal(app.text('#hcp .hcp-v'), '23.7');
  assert.match(app.text('#hcp'), /average of your lowest 2 score differentials of the last 6, −1\.0\. Not an official Golf Australia handicap; some 9-hole ratings are half the 18-hole rating/);
  const rows = app.$$('#hcpDetail .hrow').map(r => [r.textContent.replace(/\s+/g, ' ').trim(), r.classList.contains('counted')]);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], [`${app.E(`dateLabel('${daysAgo(30)}')`)} · Test GC + Test GC adjusted 108 · rating 70.0 / 125 · two nines · est. rating 34.4`, false]);
  assert.deepEqual(rows.filter(r => r[1]).map(r => r[0]), [
    `${app.E(`dateLabel('${daysAgo(50)}')`)} · Test GC adjusted 91 · rating 70.0 / 125 · −2 exceptional score 17.0`,
    `${app.E(`dateLabel('${daysAgo(80)}')`)} · Test GC adjusted 108 · rating 70.0 / 125 · −2 exceptional score 32.4`,
  ], 'the two lowest count, after the exceptional-score reduction');
  assert.match(app.text('#hcpNeeds'), /Add them from the scorecard: Unrated GC \(white\)/);
  assert.equal(app.$('#hcpNeeds [data-go]').dataset.go, 'courses:courseId=u');
});

test('the ratings are typed on the course form, checked, and kept with everything else on the course', async () => {
  app.go('courses', { courseId: 'u' });
  app.click('#view [data-act="editCourse"]');
  assert.equal(app.field('rtee_0').value, 'white');
  app.fill('cr_0', '71.5');
  app.fill('slope_0', '300');
  assert.equal(await app.save(), false, 'a slope outside 55–155 is refused');
  app.fill('slope_0', '');
  assert.equal(await app.save(), false, 'a rating without a slope is refused');
  app.fill('slope_0', '128');
  assert.equal(await app.save(), true);
  const c = await app.api.get('courses', 'u');
  assert.deepEqual(c.ratings, { white: { cr: 71.5, slope: 128 } });
  assert.equal(c.holes[4].si, 5, 'stroke index kept');
  await app.waitFor(() => app.E(`handicap().left.length`) === 0, { what: 'r8 now counts' });
  assert.match(app.text('#courseRatings'), /white: 71\.5 \/ slope 128/);
});

test('fewer than three scores: no number, and it says how many it has', async () => {
  const two = await startApp({ seed: { courses: [rated], sessions: [round('a', 20, scores(all(18, 6))), round('b', 10, scores(all(9, 6)))] } });
  try {
    two.go('overview');
    assert.equal(two.E('handicap().index'), null);
    assert.match(two.text('#hcp'), /An index needs 3 scores; you have 1, plus a 9-hole score waiting for another to pair with/);
  } finally { two.stop(); }
});

test('without a stroke index, a round counts only when no hole needs one', async () => {
  // Index 32.4 after three rounds of 6s/7s; course handicap 34 is two strokes
  // on 16 holes and one on 2, so a 7 is under every cap but an 8 depends on the hole.
  const noSi = { ...rated, holes: card(18).map(({ si, ...h }) => h) };
  const x = await startApp({ seed: { courses: [noSi], sessions: [
    round('a', 50, scores(all(18, 6))), round('b', 40, scores(all(18, 6))), round('c', 30, scores(all(18, 7))),
    round('d', 20, scores(all(18, 7))), round('e', 10, scores([8, ...all(17, 6)])),
  ] } });
  try {
    assert.deepEqual(x.J(`handicap().scores.map(s => s.rounds[0].id)`), ['a', 'b', 'c', 'd']);
    assert.deepEqual(x.J(`handicap().left.map(l => [l.r.id, l.why])`), [['e', 'the course has no stroke index, which this score needs']]);
  } finally { x.stop(); }
});

test('with 20 scores the soft cap holds a rising index to 3 over the year\'s low, plus half the rest', async () => {
  // 20 rounds of all 5s (90 → 18.1). The index is 16.1 after three (18.1 − 2.0),
  // 17.1 after four, then 18.1; so the year's low is 16.1. Then 13 rounds of
  // sixteen 7s and two 6s (124, under the par+3 cap → 48.8). After the 33rd the
  // lowest 8 of the last 20 are 7 × 18.1 and one 48.8: 21.9 uncapped, 5.8 over
  // the low. Soft cap: 16.1 + 3 + 2.8/2 = 20.5 (under the hard cap, 21.1).
  const s = [];
  for (let i = 0; i < 20; i++) s.push(round('g' + i, 200 - i * 5, scores(all(18, 5))));
  for (let i = 0; i < 13; i++) s.push(round('b' + i, 100 - i * 5, scores([...all(16, 7), 6, 6])));
  const x = await startApp({ seed: { courses: [rated], sessions: s } });
  try {
    const h = x.J(`(() => { const h = handicap(); return { index: h.index, last: h.scores.at(-1).diff, before: h.history.at(-2).hi }; })()`);
    assert.deepEqual(h, { index: 20.5, last: 48.8, before: 18.1 });
  } finally { x.stop(); }
});

test('the hard cap: never more than 5 over the year\'s low', async () => {
  // As above, but 16 poor rounds of all 7s (126, capped at par+3 → 50.6). The
  // lowest 8 of the last 20 become 4 × 18.1 and 4 × 50.6: 34.4, which the soft
  // cap would bring to 16.1 + 3 + 15.3/2 = 26.75; the hard cap stops it at 21.1.
  const s = [];
  for (let i = 0; i < 20; i++) s.push(round('g' + i, 200 - i * 5, scores(all(18, 5))));
  for (let i = 0; i < 16; i++) s.push(round('b' + i, 100 - i * 5, scores(all(18, 7))));
  const x = await startApp({ seed: { courses: [rated], sessions: s } });
  try { assert.equal(x.E('handicap().index'), 21.1); } finally { x.stop(); }
});

test('an index is never above 54.0', async () => {
  // Three rounds of 9s: par + 5 on every hole, 162 → 83.2; 83.2 − 2.0 = 81.2, held at 54.0.
  const x = await startApp({ seed: { courses: [rated], sessions: [round('a', 30, scores(all(18, 9))), round('b', 20, scores(all(18, 9))), round('c', 10, scores(all(18, 9)))] } });
  try {
    assert.deepEqual(x.J(`handicap().scores.map(s => s.diff)`), [83.2, 83.2, 83.2]);
    assert.equal(x.E('handicap().index'), 54);
  } finally { x.stop(); }
});

test('before there is an index, a hole with no score is net par for 54.0, and the round still counts', async () => {
  // Course handicap for 54.0: round(54 × 125/113 + (70 − 72)) = 58, i.e. three
  // strokes a hole and a fourth on SI 1–4. Hole 2 (SI 2) left blank: 4 + 4 = 8.
  // 17 × 6 + 8 = 110 → 0.904 × 40 = 36.2.
  const x = await startApp({ seed: { courses: [rated], sessions: [round('a', 10, scores(all(18, 6)).map(h => h.n === 2 ? { ...h, strokes: null } : h))] } });
  try {
    assert.deepEqual(x.J(`handicap().scores.map(s => [s.ags, s.diff, s.unscored])`), [[110, 36.2, [2]]]);
    x.go('overview');
    assert.match(x.text('#hcp'), /you have 1\./);
  } finally { x.stop(); }
});

test('with no index yet, the Overview still lists every round that can\'t count, and why', async () => {
  const noPar = { ...rated, id: 'p', name: 'Gappy GC', holes: card(18).map(h => h.n === 7 ? { ...h, par: null } : h) };
  const x = await startApp({ seed: { courses: [rated, noPar], sessions: [
    round('a', 30, scores(all(18, 6))),
    round('b', 20, scores(all(5, 6))),
    round('c', 10, scores(all(18, 6)), { courseId: 'p', courseName: 'Gappy GC' }),
  ] } });
  try {
    x.go('overview');
    const items = x.$$('#hcpLeft li').map(li => li.textContent);
    assert.deepEqual(items, [
      `Test GC, ${x.E(`dateLabel('${daysAgo(20)}')`)}: 5 holes scored — a score needs 14 or more of 18, or 7 or more of 9`,
      `Gappy GC, ${x.E(`dateLabel('${daysAgo(10)}')`)}: the scorecard has no par for hole 7`,
    ]);
  } finally { x.stop(); }
});

test('a tee typed with different capitals still finds its rating', async () => {
  const x = await startApp({ seed: { courses: [rated], sessions: [round('a', 10, scores(all(18, 6)), { tee: 'White' })] } });
  try { assert.deepEqual(x.J(`handicap().scores.map(s => s.diff)`), [34.4]); } finally { x.stop(); }
});

test('every tee he has played gets a rating row, even one the scorecard has no distances for; and another can be added', async () => {
  // The card only has white distances, so the round form's tee is free text:
  // rounds here were logged off "Blue" and "red".
  const c = { id: 'k', v: 2, name: 'Kensington', tee: 'white', holes: card(18) };
  const x = await startApp({ seed: { courses: [c], sessions: [
    round('a', 30, scores(all(18, 6)), { courseId: 'k', courseName: 'Kensington', tee: 'Blue' }),
    round('b', 20, scores(all(18, 6)), { courseId: 'k', courseName: 'Kensington', tee: 'Blue' }),
    round('c', 10, scores(all(18, 6)), { courseId: 'k', courseName: 'Kensington', tee: 'red' }),
  ] } });
  try {
    assert.deepEqual(x.J('handicap().needsRatings.map(n => n.tee)'), ['Blue', 'red']);
    x.go('courses', { courseId: 'k' });
    x.click('#view [data-act="editCourse"]');
    const rows = x.$$('#sheetInner .rating-row[data-tee]').map(r => r.textContent.replace(/\s+/g, ' ').trim().split(' Course rating')[0]);
    assert.deepEqual(rows, ['White tees', 'Blue tees · 2 rounds here', 'Red tees · 1 round here']);
    x.fill('cr_1', '69.8'); x.fill('slope_1', '124');
    x.fill('cr_new', '72'); x.fill('slope_new', '130');
    assert.equal(await x.save(), false, 'an extra rating needs a tee name');
    x.fill('rtee_new', 'Black');
    assert.equal(await x.save(), true);
    assert.deepEqual((await x.api.get('courses', 'k')).ratings, { blue: { cr: 69.8, slope: 124 }, black: { cr: 72, slope: 130 } });
    await x.waitFor(() => x.E('handicap().scores.length') === 2, { what: 'the two blue rounds count' });
    assert.deepEqual(x.J('handicap().needsRatings.map(n => n.tee)'), ['red']);
    x.click('#view [data-act="editCourse"]');
    assert.equal(x.field('cr_1').value, '69.8', 'the blue rating shows on its row');
    assert.equal(x.field('rtee_3').value, 'black', 'and the added tee has its own row now');
  } finally { x.stop(); }
});
