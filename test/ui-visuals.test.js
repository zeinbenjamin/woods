// Release 3 visuals (2.7.0), each against numbers worked by hand: where a
// club's shots land on the gapping ladder, the round as a scorecard, and a
// tap on a hole page's dot showing that shot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// 7i: nine shots, 100 to 140m in 5s, all the same roll. Sorted, the 10th
// percentile sits 0.8 of the way from 100 to 105 (104), the 25th on 110, the
// 75th on 130, the 90th 0.2 of the way from 135 to 140 (136).
// Plus one topped shot (12m), which is left out, as it is for stock carry.
const spread7 = Array.from({ length: 9 }, (_, i) => ({ carry: 100 + 5 * i, total: 110 + 5 * i })).concat({ carry: 12, total: 30 });
// A straight test map: tee (0,0), green 300m north.
const sq = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const MAP = { v: 1, id: 'test-visual', name: 'Straight', origin: [-33.9, 151.2], boundary: sq(-500, -500, 500, 500),
  features: [{ k: 'green', h: 1, r: sq(-10, 290, 10, 310) }, { k: 'tee', h: 1, r: sq(-3, -3, 3, 3) }], holes: [{ n: 1, line: [[0, 0], [0, 300]], green: 0, tees: [1] }] };
// The scorecard round: nine par 4s; hole 2 a 6 with a penalty on the hole's counter, hole 6 a 7 with a
// penalty tied to a shot (in the water), hole 3 a birdie, hole 9 not scored.
const scores = [4, 6, 3, 5, 4, 7, 4, 5, null], putts = [2, 2, 1, 2, 2, 3, 2, 2, null];
const rCard = { id: 'rCard', v: 2, type: 'round', date: daysAgo(3), courseId: 'cCard', courseName: 'Card GC', tee: 'white', detail: 'score_only',
  holes: card(9).map((h, i) => ({ n: h.n, par: 4, metres: 300, ...(scores[i] != null ? { strokes: scores[i], putts: putts[i] } : {}), ...(i === 1 ? { penalties: 1 } : {}), ...(i === 5 ? { shots: [{ t: 0.5, u: 0, club: '7i', lie: 'water', penalty: true }] } : {}) })) };
const rMap = { id: 'rMap', v: 2, type: 'round', date: daysAgo(2), courseId: 'cMap', courseName: 'Map GC', tee: 'white', detail: 'shot_level',
  holes: [{ n: 1, par: 4, metres: 300, putts: 2, strokes: 4, shots: [{ mx: 0, my: 150, club: 'D', lie: 'fairway' }, { mx: 0, my: 298, club: '7i', lie: 'green' }] }] };

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 3 }), club('D', 'driver', { order: 1 })],
    courses: [{ id: 'cCard', v: 2, name: 'Card GC', tee: 'white', holes: card(9) },
      { id: 'cMap', v: 2, name: 'Map GC', tee: 'white', map: { id: 'test-visual', linked: '2026-10-01' }, holes: [{ n: 1, par: 4, metres: 300, tees: { white: 300 }, si: 1 }] }],
    sessions: [{ id: 's7', v: 2, type: 'range', date: daysAgo(5), blocks: [{ id: 'b7', seq: 1, club: '7i', swing: 'full', shots: spread7 }] }, rCard, rMap],
  } });
  app.E(`HoleMap._put('test-visual', ${JSON.stringify(MAP)}); mapArrived(); true`);   // as the file arriving does
});
after(() => app && app.stop());

test('gapping draws where a club\'s shots land: the middle half, and 8 in 10', () => {
  app.go('overview');
  const rung = app.$$('#view .rung').find(r => /^7i/.test(r.textContent.trim()));
  assert.match(rung.querySelector('.conf').textContent, /· middle half 110–130m$/);
  const sp = rung.querySelector('.spread'), mid = sp.querySelector('i');
  // The ladder's scale runs to 200m: 104m is 52% along, and 104–136 is 16% wide.
  assert.deepEqual([sp.style.left, sp.style.width], ['52%', '16%']);
  // Inside it, the middle half 110–130 of the 104–136 span.
  assert.deepEqual([mid.style.left, mid.style.width], ['18.8%', '62.5%']);
  assert.equal(sp.getAttribute('title'), '7i: middle half 110–130m, most 104–136m (9 shots)');
  assert.match(app.text('#view .legend'), /where they land: middle half, and 8 in 10/);
  assert.equal(app.J(`carrySpread('D')`), null, 'no spread without 5 shots');
});

test('a round reads as a scorecard: par, score coloured against par, putts, penalties, the nine\'s total', () => {
  app.go('rounds', { sessionId: 'rCard' });
  const row = cls => app.$$(`#scorecard tr.${cls} > *`).map(c => c.textContent);
  assert.deepEqual(row('ch'), ['Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Tot'], 'one nine: a total, not Out');
  assert.deepEqual(row('cp'), ['Par', '4', '4', '4', '4', '4', '4', '4', '4', '4', '36']);
  assert.deepEqual(row('cs'), ['Score', '4', '6', '3', '5', '4', '7', '4', '5', '', '38']);
  assert.deepEqual(row('cu'), ['Putts', '2', '2', '1', '2', '2', '3', '2', '2', '', '16']);
  assert.deepEqual(row('cn'), ['Pen.', '', '1', '', '', '', '1', '', '', '', '2'], 'both kinds of penalty');
  assert.deepEqual(app.$$('#scorecard .cs .sc').map(x => x.className.replace('sc ', '')), ['par', 'b2', 'under', 'b1', 'par', 'b3', 'par', 'b1', 'unscored']);
  assert.match(app.text('#view'), /Totals count the holes with a score\./);
  assert.equal(app.$('#scorecard .ch th[data-go]').dataset.go, 'rounds:sessionId=rCard,hole=1', 'a hole opens from the card');
  assert.match(app.text('#view .card-key'), /under par.*par.*bogey.*double.*worse/, 'the colours say what they mean');
});

test('a tap on a dot on the course hole page shows that shot: when, which, the club, how far and where it finished', async () => {
  app.go('courses', { courseId: 'cMap', hole: '1' });
  await app.waitFor(() => app.$('#holeMap [data-shot]'), { what: 'tap targets' });
  assert.equal(app.$$('#holeMap .hit').length, 2, 'one target per dot');
  assert.equal(app.text('#shotInfo'), 'Tap a dot to see that shot.');
  app.$('#holeMap [data-shot="0"]').dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
  assert.match(app.text('#shotInfo'), new RegExp(`^${app.E(`dateLabel(${JSON.stringify(daysAgo(2))})`)} · shot 1 · D from 300m → 150m, fairway`));
  assert.ok(app.$('#holeMap [data-shot="0"]').classList.contains('on'), 'the tapped dot is marked');
  assert.equal(app.$('#shotInfo [data-go]').dataset.go, 'rounds:sessionId=rMap,hole=1');
  app.$('#holeMap [data-shot="1"]').dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
  assert.match(app.text('#shotInfo'), /shot 2 · 7i from 150m → 148m, green/);
  assert.equal(app.$$('#holeMap .hit.on').length, 1, 'only one marked at a time');
});

test('numbers worked out while a course map was still loading are worked out again when it arrives', () => {
  // Found building the dot details (2.7.0): the cache of derived numbers only
  // followed the data, so a map arriving after the first draw left that
  // course's map shots unmeasurable — out of the practice list, the breakdown
  // and approach distances — until the next save.
  const mapShots = () => app.E(`shotRecords().filter(x => x.r.id === 'rMap').length`);
  app.E(`window.__fh = HoleMap.forHole; HoleMap.forHole = () => undefined; true`);   // as while the file is loading
  app.E(`S.sessions = S.sessions.slice(); true`);                                       // a fresh data state, worked out now
  assert.equal(mapShots(), 0, 'nothing measurable yet');
  app.E(`HoleMap.forHole = __fh; mapArrived(); true`);                                  // the map file lands
  assert.equal(mapShots(), 2, 'its two shots count as soon as it arrives');
});
