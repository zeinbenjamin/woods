// The shot tracer, by hand (2.66.0, he asked after the swing plane: "let's add the shot tracer now"). Three taps
// (the ball, shared with the swing plane; where it peaked; where it came down) and the shape he saw, stored as
// `swing.tracer`; the flight drawn through them on every draw and labelled his drawing; beside it the real numbers
// from the shot the swing is tied to (the hole map's on the course, the bay's at the range); on the playing clip it
// flies out from impact. Its own switch, apart from the swing plane's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const R = 'r_tr', RG = 's_rg', NONE = 's_none';
const fr = pre => Array.from({ length: 4 }, (_, i) => ({ asset: `${pre}${i}`, t: +(0.05 + i * 0.4).toFixed(2) }));
// Hole 1: driver into the trees, 7i to the fairway, PW on, two putts. The rest scores only.
const HOLES = [
  { n: 1, par: 4, metres: 300, shots: [{ t: 0.5, u: 1.3, club: 'D', lie: 'trees' }, { t: 0.85, u: 0, club: '7i', lie: 'fairway' }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], putts: 2, strokes: 5 },
  ...card(9).slice(1).map(({ n, par, metres }) => ({ n, par, metres, strokes: 4 })),
];
const SEED = {
  clubs: [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 3 }), club('PW', 'wedge', { order: 4 })],
  courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }],
  sessions: [
    { id: R, v: 2, type: 'round', date: '2026-10-20', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes: HOLES, swings: [
      { id: 'sw_d', view: 'dtl', club: 'D', frames: fr('d'), addedOn: '2026-10-20', shot: { hole: 1, i: 0 } },
      { id: 'sw_7', view: 'face', club: '7i', frames: fr('s'), addedOn: '2026-10-20' }] },
    { id: RG, v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [
      { id: 'b_5w', seq: 1, club: '5W', swing: 'full', shots: [{ carry: 163.6, total: 175.1, carrySide: -6.2 }, { carry: 168, total: 176.2, carrySide: -4.6 }, { carry: 164.8, total: 178.2, carrySide: 12.1 }] },
      { id: 'b_7i', seq: 2, club: '7i', swing: 'full', shots: [{ carry: 120, total: 131 }, { carry: 122, total: 133 }] }],
    swings: [
      { id: 'sw_5', view: 'dtl', club: '5W', frames: fr('f'), addedOn: '2026-10-25', ball: { x: 0.5, y: 0.8 }, shot: { block: 'b_5w', i: 2, carry: 164.8, total: 178.2 },
        tracer: { peak: { x: 0.55, y: 0.1 }, land: { x: 0.62, y: 0.45 }, shape: 'draw', on: '2026-10-25' } },
      { id: 'sw_i', view: 'dtl', club: '7i', frames: fr('i'), addedOn: '2026-10-25', ball: { x: 0.5, y: 0.8 }, shot: { block: 'b_7i', i: 1, carry: 122, total: 133 },
        tracer: { peak: { x: 0.48, y: 0.2 }, land: { x: 0.45, y: 0.5 }, on: '2026-10-25' } },
      { id: 'sw_v', view: 'dtl', club: '7i', frames: fr('v'), addedOn: '2026-10-25', video: 'v_vid', impact: 1, ball: { x: 0.5, y: 0.8 },
        tracer: { peak: { x: 0.52, y: 0.1 }, land: { x: 0.6, y: 0.5 }, shape: 'fade', on: '2026-10-25' } }] },
    { id: NONE, v: 2, type: 'range', date: '2026-10-26', venue: 'Moore Park', blocks: [], swings: [
      { id: 'sw_x', view: 'face', club: '7i', frames: fr('x'), addedOn: '2026-10-26', ball: { x: 0.4, y: 0.7 }, tracer: { peak: { x: 0.45, y: 0.15 }, land: { x: 0.5, y: 0.5 }, on: '2026-10-26' } },
      { id: 'sw_nf', view: 'face', club: '7i', frames: [], addedOn: '2026-10-26' }] },
  ],
};

let app;
before(async () => { app = await startApp({ seed: SEED }); });
after(() => app && app.stop());
const stored = async (sid, wid) => (await app.api.get('sessions', sid)).swings.find(w => w.id === wid);
const tap = (x, y) => {
  const pick = app.$('#trPick');
  pick.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 400 });
  pick.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, clientX: 10 + 200 * x, clientY: 20 + 400 * y }));
};
const tiles = sel => app.$$(`${sel} .tsTile`).map(t => [...t.children].map(c => c.textContent.trim()).join(' '));

test('three taps and a shape: the ball first when the swing has none, then the peak and the landing on the last frame', async () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('rounds', { sessionId: R });
  // 2.68.0: one row of buttons at the card's foot.
  assert.equal(app.text('#view [data-act="traceShot"][data-wid="sw_d"]'), 'Trace the shot');
  app.click('#view [data-act="traceShot"][data-wid="sw_d"]');
  assert.match(app.text('#trSheet'), /^Tap the ball\. At address, where it sits\. The line starts here\. The swing plane uses this tap too\./);
  assert.equal(app.$('#trImg').getAttribute('src'), '/_blob/d0', 'the address frame');
  assert.ok(app.$('#trNext').disabled, 'no tap, no next');
  tap(0.5, 0.8);
  assert.ok(!app.$('#trNext').disabled);
  assert.deepEqual([app.$('#trPick .pl-pick').style.left, app.$('#trPick .pl-pick').style.top], ['50%', '80%']);
  app.click('#trNext');
  assert.match(app.text('#trSheet'), /^Tap where it peaked\./);
  assert.equal(app.$('#trImg').getAttribute('src'), '/_blob/d3', 'the last frame');
  tap(0.56, 0.1); app.click('#trNext');
  assert.match(app.text('#trSheet'), /^Tap where it came down\./);
  assert.ok(app.$('#trSave').disabled, 'not until it has landed');
  tap(0.65, 0.45);
  assert.ok(app.$('#trShot .ts-line, #trPick svg.trShot .ts-line'), 'the flight drawn through the taps');
  app.click('#trShapes [data-shape="fade"]');
  assert.equal(app.$('#trShapes [data-shape="fade"]').getAttribute('aria-pressed'), 'true');
  app.click('#trSave');
  await app.waitFor(async () => (await stored(R, 'sw_d')).tracer, { what: 'saved' });
  const sw = await stored(R, 'sw_d');
  assert.deepEqual(sw.ball, { x: 0.5, y: 0.8 });
  assert.deepEqual(sw.tracer, { peak: { x: 0.56, y: 0.1 }, land: { x: 0.65, y: 0.45 }, shape: 'fade', on: app.E('today()') });
  assert.deepEqual(Object.keys(sw).sort(), ['addedOn', 'ball', 'club', 'frames', 'id', 'shot', 'tracer', 'view'], 'nothing derived stored');
  await app.waitFor(() => app.$('#tracer_sw_d .tracerPic'), { what: 'drawn' });
  assert.ok(app.$('#tracer_sw_d .tracerPic img[src="/_blob/d3"]') && app.$('#tracer_sw_d svg.trShot .ts-line') && app.$('#tracer_sw_d svg.trShot .ts-land'));
  assert.equal(app.text('#tracer_sw_d .tracerTag'), 'Traced by you · Fade');
  assert.match(app.text('#drawn_sw_d #tracerNote_sw_d'), /^The ball's flight is a drawing from your taps, not a measurement, traced \d+ \w+ \d{4}\.$/);
});

test('beside it, the real numbers: the hole map\'s on the course, the bay\'s at the range, and nothing when it isn\'t tied', async () => {
  app.go('rounds', { sessionId: R });
  const x = app.J(`(() => { const x = swingShot(session('${R}').swings[0], session('${R}')); return { len: x.len, left: x.left }; })()`);
  assert.ok(x.len > 0 && x.left > 0);
  assert.deepEqual(tiles('#shotNums_sw_d'), [`${Math.round(x.len)} m went`, 'Trees finished', `${Math.round(x.left)} m left to the green`]);
  // 2.67.0: the numbers are the card's summary, beside the shape he traced and the shot's own line.
  assert.ok(app.$('#sumBall_sw_d #shotNums_sw_d'));
  assert.match(app.text('#sumBall_sw_d > b'), /^The ball · fade, traced$/);
  assert.match(app.text('#sumBall_sw_d #ws_sw_d'), /^This swing's shot: Hole 1, shot 1 \(tee shot\)\. Change$/);
  // Range: carry and total from the bay, and the side where the bay gave one.
  app.go('range', { sessionId: RG });
  assert.deepEqual(tiles('#shotNums_sw_5'), ['164.8 m carry, from the bay', '178.2 m total, from the bay', '12.1 m right side, from the bay']);
  assert.equal(app.text('#tracer_sw_5 .tracerTag'), 'Traced by you · Draw');
  assert.deepEqual(tiles('#shotNums_sw_i'), ['122 m carry, from the bay', '133 m total, from the bay', '– left or right: not measured here']);
  assert.equal(app.text('#tracer_sw_i .tracerTag'), 'Traced by you', 'no shape picked, none said');
  // Not tied: no numbers; where the session has shots, it says how to get them; with none, it doesn't.
  assert.equal(app.$('#shotNums_sw_v'), null);
  assert.match(app.text('#tracerNote_sw_v'), /Tie the swing to its shot \(above\) for the real distances\./);
  app.go('range', { sessionId: NONE });
  assert.ok(app.$('#tracer_sw_x .tracerPic'));
  assert.doesNotMatch(app.text('#tracerNote_sw_x'), /Tie the swing/);
  assert.equal(app.$('#tracer_sw_nf'), null, 'no frames, nothing to trace on');
});

test('redrawing starts from what was drawn, skips the ball the swing has, and a shape tapped again is taken back', async () => {
  app.go('range', { sessionId: RG });
  assert.equal(app.text('#view [data-act="traceShot"][data-wid="sw_5"]'), 'Redraw the shot');
  app.click('#view [data-act="traceShot"][data-wid="sw_5"]');
  assert.match(app.text('#trSheet'), /^Tap where it peaked\./, 'the ball is already there');
  assert.ok(!app.$('#trNext').disabled, 'the old peak stands');
  app.click('#trBack');
  assert.match(app.text('#trSheet'), /^Tap the ball\./, 'and can still be moved');
  assert.match(app.text('#trSheet'), /The swing plane uses this tap too\./, 'down the line, the plane shares the ball');
  app.click('#trNext'); app.click('#trNext');
  assert.equal(app.$('#trShapes [data-shape="draw"]').getAttribute('aria-pressed'), 'true');
  app.click('#trShapes [data-shape="draw"]');
  tap(0.7, 0.5);
  app.click('#trSave');
  await app.waitFor(async () => (await stored(RG, 'sw_5')).tracer.land.x === 0.7, { what: 'saved' });
  const t = (await stored(RG, 'sw_5')).tracer;
  assert.deepEqual(t, { peak: { x: 0.55, y: 0.1 }, land: { x: 0.7, y: 0.5 }, on: app.E('today()') }, 'no shape now; the peak kept');
});

test('the flight: out of the ball near straight up, level at the peak, through all three taps, falling at the end', () => {
  const r = app.J(`(() => { const P = [[0.5, 0.8], [0.6, 0.1], [0.7, 0.5]], S = tracerSegs(P), pts = tracerSamples(P);
    return { S, first: pts[0], last: pts[pts.length - 1], n: pts.length, peak: pts.some(p => Math.hypot(p[0] - 0.6, p[1] - 0.1) < 1e-9),
      top: Math.min(...pts.map(p => p[1])) }; })()`);
  const [[a, a1, a2, p], [p2, b1, b2, d]] = r.S;
  assert.deepEqual([a, p, p2, d], [[0.5, 0.8], [0.6, 0.1], [0.6, 0.1], [0.7, 0.5]]);
  assert.ok(Math.abs(a1[0] - a[0]) < 0.2 * Math.abs(a1[1] - a[1]), 'leaves the ball near vertical');
  assert.equal(a2[1], 0.1); assert.equal(b1[1], 0.1);
  assert.ok(a2[0] < 0.6 && b1[0] > 0.6, 'level at the peak, heading the way it finished');
  assert.ok(Math.abs(b2[0] - d[0]) < Math.abs(b2[1] - d[1]), 'steeper than level coming down');
  assert.deepEqual([r.first, r.last, r.peak, r.top], [[0.5, 0.8], [0.7, 0.5], true, 0.1], 'no higher than the peak tapped');
  // A ball that finished left: the peak heads left.
  const L = app.J(`tracerSegs([[0.5, 0.8], [0.45, 0.1], [0.3, 0.5]])`);
  assert.ok(L[0][2][0] > 0.45 && L[1][1][0] < 0.45);
  // 2.69.0, his hook: up and to the right, over the peak, coming down to its LEFT but still right of the ball. Level at
  // the peak heading where the ball goes after it (left), not right toward the landing seen from the ball, which made a
  // fade with a flat cut back at the top.
  const H = app.J(`tracerSegs([[0.53, 0.79], [0.635, 0.17], [0.6, 0.18]])`);
  assert.ok(H[0][2][0] > 0.635 && H[1][1][0] < 0.635, 'level at the peak, heading left');
  const pts = app.J(`tracerSamples([[0.53, 0.79], [0.635, 0.17], [0.6, 0.18]])`), after = pts.slice(pts.findIndex(q => Math.abs(q[0] - 0.635) < 1e-9 && Math.abs(q[1] - 0.17) < 1e-9));
  assert.ok(after.every((q, i) => !i || q[0] <= after[i - 1][0] + 1e-9), 'from the peak on, it only moves left: no cut back');
});

test('its own switch, apart from the swing plane\'s; the Swings card shows it without the buttons', () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: RG });
  assert.equal(app.$('#tracerSw_sw_5').getAttribute('aria-checked'), 'true');
  app.click('#tracerSw_sw_5');
  assert.equal(app.win.localStorage.getItem('carry.overlays'), '{"tracer":false}');
  assert.ok(!app.$('#tracer_sw_5 .tracerPic') && !app.$('#tracer_sw_i .tracerPic'), 'off for every swing');
  assert.ok(app.$('#shotNums_sw_5'), 'the shot\'s numbers are the ball\'s, not the drawing\'s: they stay');
  assert.equal(app.$('#tracerSw_sw_5').getAttribute('aria-checked'), 'false');
  assert.ok(app.$('#view [data-act="traceShot"][data-wid="sw_5"]'), 'it can still be redrawn');
  assert.equal(app.E(`overlayOn('plane')`), true, 'the plane untouched');
  app.click('#tracerSw_sw_5');
  assert.ok(app.$('#tracer_sw_5 .tracerPic'));
  const ro = app.E(`tracerSection(session('${RG}').swings[0], session('${RG}'), true)`);
  assert.match(ro, /trShot/); assert.doesNotMatch(ro, /traceShot/);
  assert.equal(app.E(`tracerSection(session('${R}').swings[1], session('${R}'), true)`), '', 'untraced: nothing on the Swings card');
  app.act('reelCard', { sid: RG, wid: 'sw_5' });
  assert.ok(app.$('#sheetInner #rc_tracer_sw_5 svg.trShot') && app.$('#sheetInner #rc_shotNums_sw_5'));
  app.$('#sheetInner [data-close]').click();
});

test('on the playing clip: nothing before impact, the ball flying out after it, whole when paused; off with its switch', () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: RG });
  assert.equal(app.E(`tracerStart(session('${RG}').swings[2])`), 1, 'from his impact mark');
  app.click('[data-act="playSwing"][data-wid="sw_v"]');
  const box = app.$('#sheetInner .trBox');
  assert.ok(box && box.querySelector('video') && box.querySelector('svg.trShot') && !box.querySelector('svg.trOv'), 'no pose: the tracer alone');
  const svg = box.querySelector('svg.trShot');
  assert.ok(svg.querySelector('.ts-land') && !svg.querySelector('.ts-ball'), 'paused: whole');
  const v = box.querySelector('video');
  let now = 0.5;
  Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => now, set() {} });
  v.dispatchEvent(new app.win.Event('seeked'));
  assert.equal(svg.innerHTML, '', 'before impact');
  now = 1.6; v.dispatchEvent(new app.win.Event('seeked'));
  const d = svg.querySelector('.ts-line').getAttribute('d'), all = app.E(`tracerSamples(tracerPts(session('${RG}').swings[2])).length`);
  assert.ok(svg.querySelector('.ts-ball') && !svg.querySelector('.ts-land'));
  assert.equal(d.split(/[ML]/).filter(Boolean).length, Math.round(0.5 * (all - 1)) + 1, 'half the flight at 0.6 of 1.2 s');
  Object.defineProperty(v, 'paused', { configurable: true, get: () => true });
  v.dispatchEvent(new app.win.Event('pause'));
  assert.ok(svg.querySelector('.ts-land'));
  app.$('#sheetInner [data-close]').click();
  // The feed carries it.
  app.go('swings', { view: 'reels' });
  assert.ok(app.$('#reels .trBox svg.trShot'));
  // Off: no box at all when the plane has nothing to draw either.
  app.go('range', { sessionId: RG });
  app.click('#tracerSw_sw_v');
  app.click('[data-act="playSwing"][data-wid="sw_v"]');
  assert.ok(!app.$('#sheetInner .trBox') && app.$('#sheetInner video'));
  app.$('#sheetInner [data-close]').click();
  app.win.localStorage.removeItem('carry.overlays');
});

test('the overlays draw in the frame\'s own units, never trusting vector-effect (2.69.1, his iPad: the picture all sand)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
  const ours = rules.filter(([sel]) => /\.(planeSv|trShot|poseSk|pl-[a-z]+|ts-[a-z]+)\b/.test(sel) && !/\.pl-pick/.test(sel));
  assert.ok(ours.length > 10);
  for (const [sel, body] of ours) {
    assert.doesNotMatch(body, /vector-effect/, `${sel}: a browser can drop it`);
    const w = /stroke-width:\s*([\d.]+)/.exec(body);
    if (w) assert.ok(+w[1] < 0.05, `${sel}: stroke-width ${w[1]} in a frame 1 tall would cover the picture`);
  }
  // The tracer draws in the frame's aspect, so a round dot is round.
  assert.match(app.E(`trShotSvg(tracerInner([[0.5, 0.5], [0.6, 0.4]], 1, 0.5625), 0.5625)`), /viewBox="0 0 0\.563 1"[\s\S]*d="M0\.2813,0\.5000L0\.3375,0\.4000"/);
});
