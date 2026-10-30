// Shot patterns on the range (2.52.0): each club's shots seen from above, side
// against carry (or total), and the oval that holds about 8 in 10 of them, from
// 5 shots (his rule: he warms up with 5 a club). Worked out on every draw,
// nothing stored. The 25 Oct 5W block is his five Trackman shots of that day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

const OCT_5W = [
  { carry: 163.6, total: 175.1, speed: 86.3, carrySide: -6.2, totalSide: -6, ballSpeed: 122.7, clubPath: -2.1, faceAngle: -4.8 },
  { carry: 168, total: 176.2, speed: 86, carrySide: -4.6, totalSide: -4.7, ballSpeed: 123.9, clubPath: -0.4, faceAngle: -2.9 },
  { carry: 164.8, total: 178.2, speed: 84.7, carrySide: 12.1, totalSide: 14.3, ballSpeed: 119.2, clubPath: -2.3, faceAngle: 0.8 },
  { carry: 151, total: 175.6, speed: 83.9, carrySide: -1, totalSide: 1.4, ballSpeed: 114.5, clubPath: -2.4, faceAngle: -5.5 },
  { carry: 163.1, total: 176.9, speed: 87.5, carrySide: -8.3, totalSide: -8.2, ballSpeed: 120.8, clubPath: -2.1, faceAngle: -6.1 },
];
// Hand-made, labelled so: an earlier, wider 5W session to compare against.
const SEP_5W = [[150, 20, 'L'], [155, 15, 'R'], [160, 10, 'L'], [165, 25, 'R'], [158, 0, 'R']]
  .map(([carry, side, lr]) => ({ carry, total: carry + 14, carrySide: lr === 'L' ? -side : side, totalSide: lr === 'L' ? -side : side }));
const SEED = {
  clubs: [club('5W', 'wood', { name: '5 Wood', order: 2 }), club('7i', 'iron', { name: '7 Iron', order: 3 })],
  sessions: [
    { id: 's_oct', v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [
      { id: 'b_5w', seq: 1, club: '5W', swing: 'full', shots: OCT_5W },
      { id: 'b_7i', seq: 2, club: '7i', swing: 'full', shots: [
        { carry: 113.4, total: 120.7, carrySide: -0.5, totalSide: -0.6 }, { carry: 134.4, total: 137.6, carrySide: 3.2, totalSide: 3.5 },
        { carry: 123.8, total: 158.7, carrySide: 1.3, totalSide: 1.0 }] }] },
    { id: 's_plain', v: 2, type: 'range', date: '2026-10-20', venue: 'Moore Park', blocks: [
      { id: 'b_7i_old', seq: 1, club: '7i', swing: 'full', shots: [{ carry: 110, total: 131 }, { carry: 112, total: 133 }, { carry: 105, total: 128 }, { carry: 118, total: 134 }] }] },
    { id: 's_sep', v: 2, type: 'range', date: '2026-09-28', venue: 'Moore Park', blocks: [{ id: 'b_5w_sep', seq: 1, club: '5W', swing: 'full', shots: SEP_5W }] },
  ],
};

let app;
before(async () => { app = await startApp({ seed: SEED }); });
after(() => app && app.stop());

const K = Math.sqrt(-2 * Math.log(0.2));
const near = (a, b, d = 1e-9, what = '') => assert.ok(Math.abs(a - b) < d, `${what} ${a} vs ${b}`);
const pat = (pts, view = 'carry') => app.J(`shotPattern(${JSON.stringify(pts)}, ${JSON.stringify(view)})`);
const sq = (x, y, extra = {}) => ({ carry: y, total: y + 10, carrySide: x, totalSide: x, w: 1, prof: 'pure', ...extra });

test('the oval holds 8 in 10 of a round spread: centre, lean, wide and deep by hand', () => {
  // A square of four and its middle: mean (0, 100), variance 4 each way (sample), no tilt.
  const p = pat([sq(-2, 98), sq(2, 98), sq(-2, 102), sq(2, 102), sq(0, 100)]);
  assert.equal(p.enough, true, 'five shots make a pattern (his rule)');
  near(p.centre, 100); near(p.lean, 0); near(p.sp.sxx, 4); near(p.sp.syy, 4); near(p.sp.sxy, 0);
  near(p.wide, 2 * K * 2, 1e-9, 'wide'); near(p.deep, 2 * K * 2, 1e-9, 'deep');
  // Every point of the drawn oval sits K standard deviations out.
  for (const [x, y] of app.J(`patternOval(${JSON.stringify(p.sp)}, 12)`)) near(Math.hypot(x, y - 100), K * 2, 1e-6, 'radius');
  // Four is not enough: the dots, and how many more it needs.
  const four = pat([sq(-2, 98), sq(2, 98), sq(-2, 102), sq(2, 102)]);
  assert.equal(four.enough, false); assert.equal(four.sp, undefined);
  assert.match(app.J(`patternNote(${JSON.stringify(four)})`), /^4 of the 5 shots a pattern needs/);
});

test('tops are left out and counted; shots without a side are counted; total uses total side', () => {
  const pts = [sq(-2, 98), sq(2, 98), sq(-2, 102), sq(2, 102), sq(0, 100), sq(1, 15, { prof: 'top' }), { carry: 101, total: 111, w: 1, prof: 'pure' }];
  const p = pat(pts);
  assert.deepEqual([p.n, p.tops, p.noSide, p.all], [5, 1, 1, 7]);
  assert.match(app.J(`patternNote(${JSON.stringify(p)})`), /1 top left out · 1 shot without a carry side\./);
  const t = pat([sq(-2, 98, { totalSide: 3 }), sq(2, 98, { totalSide: 3 }), sq(-2, 102, { totalSide: 3 }), sq(2, 102, { totalSide: 3 }), sq(0, 100, { totalSide: 3 })], 'total');
  near(t.lean, 3); near(t.centre, 110);
});

test('a wild miss is drawn apart once there are enough shots to tell; with few, nothing is called wild', () => {
  const tight = [];
  for (let i = 0; i < 12; i++) tight.push(sq((i % 4) - 1.5, 100 + (i % 3) - 1));
  const p = pat([...tight, sq(40, 70)]);
  assert.equal(p.wild.length, 1); assert.equal(p.n, 12);
  assert.equal(p.wild[0].x, 40);
  assert.ok(p.wide < 10, 'the shank does not stretch the oval');
  assert.match(app.J(`patternNote(${JSON.stringify(p)})`), /1 wild miss in red, not in the oval/);
  const few = pat([sq(-1, 100), sq(1, 101), sq(0, 99), sq(1, 100), sq(0, 100), sq(40, 70)]);
  assert.equal(few.wild.length, 0, 'six shots cannot single one out');
});

test('weights: equal ones give the sample covariance; recent shots count more', () => {
  const sp = app.J(`spreadOf(${JSON.stringify([1, 2, 3, 4, 5].map(x => ({ x, y: 0, w: 1 })))})`);
  near(sp.mx, 3); near(sp.sxx, 2.5);
  const w = app.J(`spreadOf(${JSON.stringify([{ x: 0, y: 0, w: 1 }, { x: 10, y: 0, w: 0.25 }])})`);
  near(w.mx, 2, 1e-9, 'weighted mean');
});

test('a block with side numbers shows its pattern: the oval, his five shots, centre, lean, wide and deep', () => {
  app.go('range', { blockId: 'b_5w' });
  const sec = app.$('#blockPattern');
  assert.ok(sec, 'the pattern section');
  assert.equal(app.$$('#blockPattern .pt-oval').length, 1);
  assert.equal(app.$$('#blockPattern .pt-shot').length, 5);
  const tiles = app.$$('#blockPattern .ftile').map(t => t.textContent);
  assert.match(tiles[0], /^162centre, carry m1\.6 L$/, 'mean carry 162.1, mean side 1.6 left');
  const carries = OCT_5W.map(s => s.carry), sides = OCT_5W.map(s => s.carrySide);
  const m = a => a.reduce((x, y) => x + y) / a.length, v = a => a.reduce((x, y) => x + (y - m(a)) ** 2, 0) / (a.length - 1);
  assert.match(tiles[1], new RegExp(`^${Math.round(2 * K * Math.sqrt(v(sides)))}wide m`));
  assert.match(tiles[2], new RegExp(`^${Math.round(2 * K * Math.sqrt(v(carries)))}deep m`));
  assert.match(app.text('#patternNote'), /about 8 in 10 shots like these; from 5 shots it is a rough shape/);
  // Below the stats, above the shot table.
  const order = [...app.$('#view').querySelectorAll('.stat, #blockPattern, #shotTable')].map(e => e.id || 'stat');
  assert.deepEqual(order.filter((x, i) => x !== order[i - 1]), ['stat', 'blockPattern', 'shotTable']);
});

test('Carry / Total switches the view, and the phone remembers it', () => {
  app.click('#blockPattern [data-act="setPatternView"][data-v="total"]');
  assert.equal(app.$('#blockPattern [data-v="total"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.win.localStorage.getItem('carry.pattern'), 'total');
  assert.match(app.$$('#blockPattern .ftile')[0].textContent, /^176centre, total m0\.6 L$/, 'mean total 176.4, mean total side 0.64 left');
  app.click('#blockPattern [data-act="setPatternView"][data-v="carry"]');
  assert.match(app.$$('#blockPattern .ftile')[0].textContent, /^162centre, carry/);
});

test('against the last session with a pattern for that club', () => {
  app.go('range', { blockId: 'b_5w' });
  assert.match(app.text('#patternCompare'), /^Against .*2026 \(5 shots\): \d+ m narrower, .*centre \d+(\.\d)? m further left\.$/);
});

test('fewer than five shots with sides: the dots and what is missing; no sides at all: no section', () => {
  app.go('range', { blockId: 'b_7i' });
  assert.equal(app.$$('#blockPattern .pt-oval').length, 0);
  assert.equal(app.$$('#blockPattern .pt-shot.few').length, 3);
  assert.equal(app.$$('#blockPattern .ftile').length, 0);
  assert.match(app.text('#patternNote'), /^3 of the 5 shots a pattern needs\./);
  app.go('range', { blockId: 'b_7i_old' });
  assert.equal(app.$('#blockPattern'), null, 'shots from before side numbers keep the page as it was');
});

test('the Overview\'s Patterns by club: every club from one tee, the counted sessions, recent shots counting more', async () => {
  app.go('overview');
  const f = app.$('#ovPatterns');
  assert.ok(f && !f.open, 'a fold under Gapping, closed');
  assert.match(app.text('#ovPatterns summary'), /Patterns by club.*5W \d+ m wide/);
  assert.equal(app.$$('#ovPatterns .pt-oval').length, 1, '5W has ten shots; 7i three');
  assert.equal(app.$$('#ovPatterns .pt-tee').length, 1);
  assert.equal(app.$$('#ovPatterns .pt-shot').length, 0, 'with no club picked, only the ovals (2.54.0)');
  const cells = app.$$('#patternTable tbody tr').map(tr => [...tr.children].map(td => td.textContent));
  assert.deepEqual([cells[0][0], cells[0][5]], ['5W', '10']);
  assert.deepEqual(cells[1], ['7i', '–', '–', '–', '–', '3 of 5'], 'a club short of five is listed too, so it can be picked');
  assert.match(app.text('#patternFew'), /Not enough shots with carry side yet: 7i 3 of 5\./);
  // Recency: each shot weighs 0.5^(days/60); the lean is the weighted mean side.
  const wOct = Math.pow(0.5, app.E(`daysAgo('2026-10-25')`) / 60), wSep = Math.pow(0.5, app.E(`daysAgo('2026-09-28')`) / 60);
  const sOct = OCT_5W.map(s => s.carrySide), sSep = SEP_5W.map(s => s.carrySide), sum = a => a.reduce((x, y) => x + y, 0);
  const want = (wOct * sum(sOct) + wSep * sum(sSep)) / (5 * wOct + 5 * wSep);
  near(app.E(`clubPattern('5W', 'carry').lean`), want, 1e-9, 'weighted lean');
  await app.api.put('settings', 'app', { id: 'app', weighting: 'equal' });
  await app.waitFor(() => app.E(`weighting()`) === 'equal', { what: 'setting' });
  near(app.E(`clubPattern('5W', 'carry').lean`), (sum(sOct) + sum(sSep)) / 10, 1e-9, 'plain mean');
  // A session left out of the numbers is left out of the pattern.
  const sep = await app.api.get('sessions', 's_sep');
  await app.api.put('sessions', 's_sep', { ...sep, excluded: true });
  await app.waitFor(() => app.E(`clubPattern('5W', 'carry').n`) === 5, { what: 'excluded' });
  await app.api.put('sessions', 's_sep', sep);
  await app.api.put('settings', 'app', { id: 'app' });
  await app.waitFor(() => app.E(`clubPattern('5W', 'carry').n`) === 10 && app.E(`weighting()`) === 'recent', { what: 'restored' });
});

test('nothing derived is stored', async () => {
  app.go('overview'); app.go('range', { blockId: 'b_5w' });
  for (const s of SEED.sessions) assert.deepEqual(JSON.parse(JSON.stringify(await app.api.get('sessions', s.id))), JSON.parse(JSON.stringify(s)));
});

test('tapping a club\'s row shows its shots, the other ovals faint; tapping it again shows every club', () => {
  app.win.localStorage.removeItem('carry.patternClub');
  app.go('overview'); app.$('#ovPatterns').open = true;
  assert.match(app.text('#patternHint'), /Tap a club to see its shots/);
  app.click('#patternTable tr[data-v="5W"]');
  assert.equal(app.win.localStorage.getItem('carry.patternClub'), '5W');
  assert.equal(app.$('#patternTable tr[data-v="5W"]').getAttribute('aria-pressed'), 'true');
  assert.ok(app.$('#patternTable tr[data-v="5W"]').classList.contains('sel'));
  assert.equal(app.$$('#ovPatterns .pt-shot.picked').length, 10, 'his five and the five from September');
  assert.equal(app.$$('#ovPatterns .pt-oval.picked').length, 1);
  assert.match(app.text('#patternHint'), /^5W's shots, the other clubs faint/);
  // A club short of five: its dots alone, the 5W oval faint behind, no labels but its own.
  app.click('#patternTable tr[data-v="7i"]');
  assert.equal(app.$$('#ovPatterns .pt-shot.picked.few').length, 3);
  assert.equal(app.$$('#ovPatterns .pt-oval.ghost').length, 1);
  assert.deepEqual(app.$$('#ovPatterns .pt-lab').map(t => t.textContent), ['7i']);
  // Enter on a focused row works like a tap; the same club again clears it.
  app.$('#patternTable tr[data-v="7i"]').dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(app.win.localStorage.getItem('carry.patternClub'), null);
  assert.equal(app.$$('#ovPatterns .pt-shot').length, 0);
  // A remembered club that has no pattern data any more is simply ignored.
  app.win.localStorage.setItem('carry.patternClub', 'D'); app.go('overview');
  assert.equal(app.$$('#ovPatterns .pt-oval').length, 1); assert.equal(app.$$('#ovPatterns .pt-shot').length, 0);
  app.win.localStorage.removeItem('carry.patternClub');
});
