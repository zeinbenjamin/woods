// Shot-by-shot logging and the faster-logging flow, driven by real taps on
// the hole map: the armed club (his habit, never the app's advice), lie and
// club correction, one-tap putts, penalties, quick scores, undo/clear, and
// first-putt distance estimated from a tap on the green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card, rangeSession, block } from './harness.js';

const ART = 'd'.repeat(32);
const art = { asset: ART, w: 540, h: 900, tee: [270, 810], green: [270, 108], gr: 30 };
const SEVEN = [[130, 140], [128, 138], [125, 135], [124, 150], [100, 108], [15, 40], [118, 127]];
const holes9 = card(9, { par: [4, 3, 4, 4, 4, 4, 4, 4, 4], metres: [300, 150, 300, 300, 300, 300, 300, 300, 300] });

let app;
const R = 'r_log';
const round = async () => app.api.get('sessions', R);
const hole = async n => (await round()).holes.find(h => h.n === n);
// SVG coordinates of (t, u) on the hole map as the logger draws it.
const pt = (n, t, u) => app.J(`(() => { const all = holesOf(session('${R}')); const h = all.find(x => x.n === ${n});
  const maxM = Math.max(...all.map(x => x.metres || 0), 1); return holePt(holeGeom(h, (h.metres || maxM) / maxM), ${t}, ${u}); })()`);
const tapTU = async (n, t, u) => { const p = pt(n, t, u); await app.tap('#logMap', p.x, p.y); };
const waitHole = (n, cond, what) => app.waitFor(async () => cond(await hole(n)), { what });

before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1, nominalTotal: 200 }), club('5W', 'wood', { order: 2, nominalTotal: 180 }),
      club('7i', 'iron', { order: 3 }), club('9i', 'iron', { order: 4 }), club('PW', 'wedge', { order: 5 }), club('P', 'putter', { order: 9 })],
    courses: [
      { id: 'c_log', v: 2, name: 'Log GC', tee: 'white', holes: holes9.map(h => h.n === 3 ? { ...h, art } : h) },
      { id: 'c_hist', v: 2, name: 'History GC', tee: 'white', holes: card(9) },
    ],
    sessions: [
      rangeSession('s_range', '2026-09-01', [block('b1', '7i', SEVEN)]),
      // Two earlier approaches from ~150m, both with the 5W: his habit.
      { id: 'r_hist', v: 2, type: 'round', date: '2026-08-01', courseId: 'c_hist', courseName: 'History GC', tee: 'white', detail: 'shot_level',
        holes: [1, 2].map(n => ({ n, par: 4, metres: 300, shots: [{ t: 0.5, u: 0, club: 'D' }, { t: 0.95, u: 0, club: '5W' }], putts: 2, strokes: 4 })) },
      { id: R, v: 2, type: 'round', date: '2026-09-20', courseId: 'c_log', courseName: 'Log GC', tee: 'white', detail: 'score_only',
        holes: holes9.map(({ n, par, metres }) => ({ n, par, metres, ...(n === 2 ? { strokes: 4 } : {}) })) },
    ],
  } });
});
after(() => app && app.stop());

test('the tee shot on a par 4 is armed with the driver, and a tap logs it where it landed', async () => {
  app.go('rounds', { sessionId: R, hole: '1' });
  assert.match(app.text('#view .armrow'), /Next shot: D/);
  await tapTU(1, 0.5, 0);
  await waitHole(1, h => (h.shots || []).length === 1, 'shot saved');
  const h = await hole(1);
  assert.equal(h.shots[0].club, 'D');
  assert.ok(Math.abs(h.shots[0].t - 0.5) < 0.01, `t=${h.shots[0].t}`);
  assert.ok(Math.abs(h.shots[0].u) < 0.05, `u=${h.shots[0].u}`);
  assert.equal(h.strokes, 1);
  assert.equal((await round()).detail, 'shot_level');
  assert.match(app.text('#view .map-hint'), /150m to the green/);
});

test('with no driver, the tee shot arms the longest club in the bag', () => {
  const got = app.E(`(() => { const saved = S.clubs; S.clubs = S.clubs.map(c => c.code === 'D' ? { ...c, retired: true } : c);
    try { return armedClubFor({ n: 9, par: 4, shots: [] }, 300); } finally { S.clubs = saved; } })()`);
  assert.equal(got, '5W');
});

test('the next club is what he usually hits from there, not what the app recommends', () => {
  // 150m left. The app's advice picks the range-measured 7i; his own logs say 5W.
  const view = app.text('#view');
  assert.match(view, /Longer than any measured club. 7i carries 125m/, 'advice is shown, as advice, and it names the 7i');
  assert.match(app.text('#view .armrow'), /Next shot: 5W — what you usually hit from about 150m \(2×\)/);
  assert.equal(app.E(`armedClubFor(holesOf(session('${R}'))[0], 150)`), '5W');
  assert.notEqual(app.E(`clubFit(150).best.c.code`), '5W');
});

test('habit needs at least two shots; otherwise the last club carries over, still not the advice', () => {
  assert.equal(app.E(`usualClubFor(60, 'c_log')`), null);
  assert.equal(app.E(`armedClubFor({ n: 1, par: 4, shots: [{ t: 0.9, u: 0, club: 'D' }] }, 60)`), 'D');
});

test('tapping an arming chip arms that club without touching the shot already logged', async () => {
  app.click('#view [data-act="armClub"][data-club="9i"]');
  assert.match(app.text('#view .armrow'), /Next shot: 9i/);
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await hole(1)).shots[0].club, 'D', 'arming is not correcting');
  await tapTU(1, 0.95, 0.1);
  await waitHole(1, h => h.shots.length === 2, 'second shot');
  assert.equal((await hole(1)).shots[1].club, '9i');
});

test('club and lie chips correct the last shot', async () => {
  app.click('#view #clubChips [data-club="PW"]');
  await waitHole(1, h => h.shots[1].club === 'PW', 'club corrected');
  app.click('#view [data-lie="bunker"]');
  await waitHole(1, h => h.shots[1].lie === 'bunker', 'lie corrected');
  assert.equal((await hole(1)).shots[0].club, 'D', 'earlier shots untouched');
});

test('putts are one tap, and the score is shots + putts', async () => {
  app.click('#view [data-act="setPutts"][data-p="2"]');
  await waitHole(1, h => h.putts === 2, 'putts saved');
  assert.equal((await hole(1)).strokes, 4);
});

test('hole score = shots + putts + unattributed penalties + penalties attached to shots', async () => {
  app.click('#view [data-step="penalties"][data-d="1"]');
  await waitHole(1, h => h.penalties === 1, 'penalty');
  assert.equal((await hole(1)).strokes, 5);
  app.act('editShot', { sid: R, n: '1', i: '0' });
  app.fill('penalty', true);
  assert.equal(await app.save(), true);
  const h = await hole(1);
  assert.equal(h.shots[0].penalty, true);
  assert.equal(h.strokes, 6);
  assert.equal(app.E(`holeStrokes({ shots: [{}, { penalty: true }], putts: 2, penalties: 1 })`), 6);
  app.click('#view [data-step="penalties"][data-d="-1"]');
  app.click('#view [data-step="penalties"][data-d="-1"]');
  await waitHole(1, h => h.penalties === 0, 'never below zero');
});

test('moving a shot re-places it without adding one', async () => {
  app.act('editShot', { sid: R, n: '1', i: '0' });
  app.click('#sheetInner [data-act="moveShot"]');
  assert.match(app.text('#view .notice'), /Moving shot 1/);
  await tapTU(1, 0.6, -0.3);
  await waitHole(1, h => Math.abs(h.shots[0].t - 0.6) < 0.01, 'moved');
  const h = await hole(1);
  assert.equal(h.shots.length, 2);
  assert.equal(h.shots[0].club, 'D', 'club kept');
  assert.equal(app.E('S.moving'), null);
});

test('undo removes the last shot; deleting a shot asks in-page first', async () => {
  app.click('#view [data-act="undoShot"]');
  await waitHole(1, h => h.shots.length === 1, 'undone');
  app.act('removeShot', { sid: R, n: '1', i: '0' });
  await app.answer(false);
  assert.equal((await hole(1)).shots.length, 1);
});

test('tracing a scored hole keeps the typed score; clearing the hole brings it back', async () => {
  app.go('rounds', { sessionId: R, hole: '2' });
  assert.match(app.text('#view .armrow'), /Next shot:/);
  await tapTU(2, 0.97, 0);
  await waitHole(2, h => (h.shots || []).length === 1, 'shot on hole 2');
  let h = await hole(2);
  assert.equal(h.manualStrokes, 4, 'the scorecard 4 is kept aside');
  assert.equal(h.strokes, 1, 'score now comes from the shots');
  app.click('#view [data-act="clearHole"]');
  await app.answer(true);
  await waitHole(2, h => !h.shots, 'cleared');
  h = await hole(2);
  assert.equal(h.strokes, 4);
  assert.equal(h.manualStrokes, undefined);
});

test('quick score is one tap on untraced holes and refuses traced ones', async () => {
  app.go('rounds', { sessionId: R });
  const chips = app.$$('#view .quick .qrow').map(r => r.querySelector('.qn').firstChild.textContent.trim());
  assert.ok(!chips.includes('1'), 'the traced hole is not offered');
  app.click('#view [data-act="quickScore"][data-n="5"][data-s="6"]');
  await waitHole(5, h => h.strokes === 6, 'quick score');
  assert.equal((await hole(5)).manualStrokes, undefined, 'untraced: the score is just strokes');
  await app.act('quickScore', { sid: R, n: '1', s: '3' });
  assert.match(app.toast(), /shots traced/);
  assert.equal((await hole(1)).strokes, 4, 'unchanged: 1 shot, its attached penalty, 2 putts');
});

/* ---------- artwork: lie from colour, first putt from the tap ---------- */

// Stand in for the decoded artwork, as if the image had loaded.
const paint = (fill, w = 540, h = 900) => app.E(`artPixels.set('/_blob/${ART}', Promise.resolve({ width: ${w}, height: ${h},
  data: Uint8ClampedArray.from({ length: ${w * h * 4} }, (_, i) => ${JSON.stringify(fill)}[i % 4]) }))`);

test('the lie is read from the artwork\'s colour under the tap', () => {
  // `fill` is page-side source: pixel index → [r, g, b, a], on a 60×60 image.
  const at = (fill, x, y, a) => app.E(`(() => { const f = ${fill}, d = new Uint8ClampedArray(60 * 60 * 4);
    for (let i = 0; i < d.length; i += 4) d.set(f(i / 4), i);
    return classifyAt({ width: 60, height: 60, data: d }, ${JSON.stringify(a)}, ${x}, ${y}); })()`);
  const small = { ...art, green: [30, 30], gr: 10 };
  assert.equal(at('() => [200, 180, 120, 255]', 30, 30, small), 'bunker');
  assert.equal(at('() => [60, 90, 200, 255]', 30, 30, small), 'water');
  assert.equal(at('() => [20, 50, 20, 255]', 30, 30, small), 'trees');
  assert.equal(at('() => [0, 0, 0, 0]', 30, 30, small), 'trees', 'off the artwork');
  assert.equal(at('() => [60, 160, 60, 255]', 30, 30, small), 'green', 'light turf inside the green circle');
  assert.equal(at('() => [60, 160, 60, 255]', 5, 5, small), 'fairway', 'light turf outside it');
  assert.equal(at('() => [70, 112, 60, 255]', 30, 30, small), 'rough', 'smooth mid-green');
  assert.equal(at('p => (p % 2 ? [40, 60, 40, 255] : [40, 150, 40, 255])', 30, 30, small), 'trees', 'mid-dark and noisy is canopy');
});

test('a tap on the green estimates the first putt, flagged as an estimate', async () => {
  paint([60, 160, 60, 255]);
  app.go('rounds', { sessionId: R, hole: '3' });
  assert.ok(app.$('#logMap.art'), 'the art map is used');
  await app.tap('#logMap', 270, 450);
  await waitHole(3, h => (h.shots || []).length === 1, 'tee shot on art');
  let h = await hole(3);
  assert.deepEqual([h.shots[0].x, h.shots[0].y, h.shots[0].lie], [270, 450, 'fairway']);
  assert.equal(h.firstPutt, undefined);
  await app.tap('#logMap', 270, 115);
  await waitHole(3, h => h.shots.length === 2, 'approach on art');
  h = await hole(3);
  assert.equal(h.shots[1].lie, 'green');
  // 7px from the green centre; the 702px tee→green line is the card's 300m.
  assert.equal(h.firstPutt, +(7 * 300 / 702).toFixed(1));
  assert.equal(h.firstPuttEstimated, true);
  assert.match(app.text('#view [data-act="setPutt"]'), /≈3m — estimated from your tap, adjust/);
});

test('typing the first putt replaces the estimate and clears the flag', async () => {
  app.click('#view [data-act="setPutt"]');
  app.fill('m', 4.5);
  assert.equal(await app.save(), true);
  const h = await hole(3);
  assert.equal(h.firstPutt, 4.5);
  assert.equal(h.firstPuttEstimated, undefined);
});

test('putting stats count holes with a first putt and say how many were estimated', async () => {
  const r = await round();
  await app.api.put('sessions', R, { ...r, holes: r.holes.map(h => h.n === 3 ? { ...h, putts: 1 } : h.n === 4 ? { ...h, putts: 3, firstPutt: 12, firstPuttEstimated: true, strokes: 6 } : h) });
  // 5 holes with putts: two from the history round, holes 1, 3 and 4 here.
  await app.waitFor(() => app.E(`puttingStats().holes === 5`), { what: 'poll' });
  const p = app.J('puttingStats()');
  assert.deepEqual([p.holes, p.measured, p.estimated, p.threes], [5, 2, 1, 1]);
  assert.equal(p.medianFirst, (4.5 + 12) / 2);
  assert.equal(p.onePuttRate, 50);
  app.go('overview');
  assert.match(app.text('#puttCover'), /^First-putt distance on 2 of 5 holes, 1 of them estimated from where you tapped\.$/);
});
