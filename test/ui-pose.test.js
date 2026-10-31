// The body, measured (2.55.0). The pose model is MediaPipe's, run in the
// browser; jsdom can't run it, so a stand-in detector (window.carryPose) answers
// with hand-made joints whose measures can be worked out by hand. Everything
// else is the real app: the button, the save, the swing card, the trends, the
// reading's prompt. The real model was checked separately in Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

// 33 joints, all at the middle and unseen, then the ones a measure uses placed by hand.
const blank = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0.1]);
function joints(pts) { const j = blank(); for (const [i, x, y] of pts) j[i] = [x, y, 0.99]; return j; }
const lerp = (a, b, t) => a.map((p, i) => [p[0], p[1] + (b[i][1] - p[1]) * t, p[2] + (b[i][2] - p[2]) * t]);
// Face-on, a right-hander, the target on the right of the picture (the lead, left, shoulder is there).
//            index  x      y
const F_ADDR = [[0, 0.500, 0.25], [11, 0.56, 0.35], [12, 0.44, 0.35], [13, 0.53, 0.50], [14, 0.47, 0.50], [15, 0.505, 0.62], [16, 0.495, 0.62],
  [23, 0.55, 0.60], [24, 0.45, 0.60], [25, 0.55, 0.75], [26, 0.45, 0.75], [27, 0.55, 0.9], [28, 0.45, 0.9]];
const F_TOP = [[0, 0.497, 0.25], [11, 0.52, 0.36], [12, 0.43, 0.34], [13, 0.46, 0.30], [14, 0.40, 0.33], [15, 0.40, 0.20], [16, 0.39, 0.21],
  [23, 0.538, 0.60], [24, 0.438, 0.60], [25, 0.55, 0.75], [26, 0.45, 0.75], [27, 0.55, 0.9], [28, 0.45, 0.9]];   // hips 0.012 back: 12% of hip width
const F_IMP = [[0, 0.494, 0.25], [11, 0.58, 0.36], [12, 0.46, 0.37], [13, 0.56, 0.52], [14, 0.50, 0.52], [15, 0.525, 0.64], [16, 0.515, 0.64],
  [23, 0.57, 0.60], [24, 0.47, 0.60], [25, 0.56, 0.75], [26, 0.46, 0.75], [27, 0.55, 0.9], [28, 0.45, 0.9]];      // hips 0.02 forward: 20%; head 0.006 back: 5% of 0.12
const F_FIN = [[0, 0.55, 0.24], [11, 0.58, 0.34], [12, 0.52, 0.35], [13, 0.62, 0.30], [14, 0.58, 0.28], [15, 0.60, 0.20], [16, 0.59, 0.19],
  [23, 0.58, 0.60], [24, 0.50, 0.60], [25, 0.57, 0.75], [26, 0.50, 0.77], [27, 0.55, 0.9], [28, 0.47, 0.88]];
// 16 frames: address 0, top 7, impact 11, finish 15, straight steps between (only y matters for finding them).
function frames16(addr, top, imp, fin) {
  const k = [[0, addr], [7, top], [11, imp], [15, fin]], out = [];
  for (let f = 0; f < 16; f++) {
    let s = 0; while (s < 3 && f > k[s + 1][0]) s++;
    const [fa, A] = k[s], [fb, B] = k[Math.min(3, s + 1)], t = fb === fa ? 0 : (f - fa) / (fb - fa);
    const ja = joints(A), jb = joints(B);
    out.push(ja.map((p, i) => [p[0] + (jb[i][0] - p[0]) * t, p[1] + (jb[i][1] - p[1]) * t, ja[i][2]]));
  }
  return out;
}
const FACE = frames16(F_ADDR, F_TOP, F_IMP, F_FIN);
const MIRROR = FACE.map(j => j.map(([x, y, v]) => [1 - x, y, v]));
// Down the line: the golfer faces right, the ball beyond; bent forward at address, hips 0.03 toward the ball and more upright at impact.
const D_ADDR = [[0, 0.62, 0.30], [11, 0.555, 0.355], [12, 0.555, 0.355], [15, 0.60, 0.62], [16, 0.60, 0.62], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const D_TOP = [[0, 0.61, 0.30], [11, 0.54, 0.36], [12, 0.54, 0.36], [15, 0.42, 0.22], [16, 0.42, 0.22], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const D_IMP = [[0, 0.61, 0.29], [11, 0.555, 0.34], [12, 0.555, 0.34], [15, 0.62, 0.64], [16, 0.62, 0.64], [23, 0.485, 0.60], [24, 0.485, 0.60]];
const D_FIN = [[0, 0.52, 0.28], [11, 0.50, 0.33], [12, 0.50, 0.33], [15, 0.40, 0.18], [16, 0.40, 0.18], [23, 0.47, 0.58], [24, 0.47, 0.58]];
const DTL = frames16(D_ADDR, D_TOP, D_IMP, D_FIN);
// Hips hidden on 6 of 16 frames: found on 10, under three quarters.
const HIDDEN = FACE.map((j, i) => i % 3 === 1 ? j.map((p, k) => k === 23 || k === 24 ? [p[0], p[1], 0.2] : p) : j);

const fr = (pre, n = 16) => Array.from({ length: n }, (_, i) => ({ asset: `${pre}${i}`, t: +(0.05 + i * 0.1).toFixed(2) }));
const SEED = {
  clubs: [club('7i', 'iron', { name: '7 Iron', order: 3 })],
  sessions: [
    { id: 's_sep', v: 2, type: 'range', date: '2026-09-28', venue: 'Moore Park', blocks: [], swings: [
      { id: 'sw_sep', view: 'face', club: '7i', frames: fr('sep'), addedOn: '2026-09-28' }] },
    { id: 's_oct', v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [], swings: [
      { id: 'sw_face', view: 'face', club: '7i', frames: fr('fa'), addedOn: '2026-10-25' },
      { id: 'sw_dtl', view: 'dtl', club: '7i', frames: fr('dt'), addedOn: '2026-10-25' },
      { id: 'sw_mir', view: 'face', club: '7i', frames: fr('mi'), addedOn: '2026-10-25' },
      { id: 'sw_hid', view: 'face', club: '7i', frames: fr('hi'), addedOn: '2026-10-25' }] },
  ],
};
const ANSWERS = { fa: FACE, sep: FACE, dt: DTL, mi: MIRROR, hi: HIDDEN };
let app, asked = [], fail = false;
before(async () => {
  app = await startApp({ seed: SEED });
  app.win.carryPose = { async detect(src) {
    asked.push(src);
    if (fail) throw new Error('no SIMD');
    const m = String(src).match(/\/_blob\/([a-z]+)(\d+)$/);
    return { w: 1080, h: 1080, joints: ANSWERS[m[1]][Number(m[2])] };
  } };
});
after(() => app && app.stop());

const near = (a, b, d = 1e-6, what = '') => assert.ok(Math.abs(a - b) < d, `${what} ${a} vs ${b}`);
const doc = id => app.api.get('sessions', id);
const angle = (a, b, c) => { const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]]; return Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI; };
const r3 = v => Math.round(v * 1000) / 1000;

test('measuring a swing asks the model about each stored frame and keeps the joints on the swing, nothing worked out', async () => {
  app.go('range', { sessionId: 's_oct' });
  // 2.68.0: Analyse measures the body first; measuring is also an action of its own (More…).
  assert.match(app.$('[data-act="analyseSwing"][data-wid="sw_face"]').closest('.swing').textContent, /Analyse measures the body on this phone/);
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_face' });
  await app.waitFor(async () => (await doc('s_oct')).swings.find(s => s.id === 'sw_face').pose, { what: 'saved' });
  assert.deepEqual(asked, fr('fa').map(f => '/_blob/' + f.asset));
  const pose = (await doc('s_oct')).swings.find(s => s.id === 'sw_face').pose;
  assert.deepEqual(Object.keys(pose).sort(), ['aspect', 'by', 'frames', 'on'], 'the joints and where they came from, no measures');
  assert.equal(pose.by, 'mediapipe-0.10.35-heavy'); assert.equal(pose.aspect, 1);
  assert.equal(pose.frames.length, 16);
  assert.deepEqual(pose.frames[0].j[11], [0.56, 0.35, 0.99]);
  assert.equal(pose.frames[3].asset, 'fa3');
});

test('face-on by hand: the positions from the hands, sway at the top, hips and head at impact, the lead arm', async () => {
  await app.waitFor(() => app.$('#pose_sw_face'), { what: 'card' });
  const m = app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face'))`);
  assert.deepEqual(m.keys, { address: 0, top: 7, impact: 11, finish: 15, down: 9 });
  assert.equal(m.found, 16); assert.equal(m.reliable, true); assert.equal(m.impFrom, 'hands');
  const v = Object.fromEntries(app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face'))).map(x => [x.k, x.v])`));
  near(v.swayTop, -12, 1e-6, 'sway'); near(v.hipImpact, 20, 1e-6, 'hips'); near(v.headImpact, -5, 1e-6, 'head');
  const T = Object.fromEntries(F_TOP.map(([i, x, y]) => [i, [r3(x), r3(y)]]));
  near(v.armTop, angle(T[11], T[13], T[15]), 1e-6, 'lead arm');
  const lines = app.$$('#bodyAll_sw_face .dlines li').map(li => li.textContent);
  assert.deepEqual(lines.slice(0, 3), ['Hip sway at the top: 12% of hip width away from the target', 'Hips at impact: 20% of hip width toward the target from where they started · outside the guide', 'Head drift, address to impact: 5% of shoulder width back']);
  assert.deepEqual(app.$$('#pose_sw_face figcaption').map(f => f.textContent), ['Address', 'Top', 'Impact', 'Finish']);
  assert.ok(app.$$('#pose_sw_face .poseSk line').length >= 10, 'the skeleton over each');
  assert.match(app.text('#pose_sw_face'), /16 of 16 frames/);
  assert.match(app.text('#pose_sw_face .small'), /^The body, measured 16 of 16 frames · 2D · impact from the hands$/);
  assert.doesNotMatch(app.text('#pose_sw_face'), /Measured from the frames by a pose model/, 'the long caption is gone (2.57.0)');
  assert.ok(app.$('#ptr_sw_face') && app.$$('#ptr_sw_face .ptrace:not(.traxis)').length === 4, 'a chart per measure across the swing');
});

test('a mirrored clip reads the same: the target side comes from the address frame', async () => {
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_mir' });
  await app.waitFor(() => app.$('#pose_sw_mir'), { what: 'mirrored measured' });
  const a = app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face'))).map(x => +x.v.toFixed(6))`);
  const b = app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_mir'))).map(x => +x.v.toFixed(6))`);
  assert.deepEqual(b, a);
});

test('down the line by hand: hips toward the ball, forward bend lost, head height', async () => {
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_dtl' });
  await app.waitFor(() => app.$('#pose_sw_dtl'), { what: 'dtl measured' });
  const v = Object.fromEntries(app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_dtl'))).map(x => [x.k, x.v])`));
  const torso = Math.hypot(0.555 - 0.455, 0.355 - 0.60), deg = r => r * 180 / Math.PI;
  near(v.extImpact, 100 * 0.03 / torso, 1e-6, 'early extension');
  near(v.bendLoss, deg(Math.atan2(0.10, 0.245)) - deg(Math.atan2(0.07, 0.26)), 1e-6, 'bend lost');
  near(v.headUp, 100 * 0.01 / torso, 1e-6, 'head up');
  assert.match(app.text('#bodyAll_sw_dtl'), /Hips toward the ball at impact: \d+% of torso length toward the ball \(early extension when toward\)/);
  assert.match(app.text('#bodyAll_sw_dtl'), /Forward bend lost by impact: \d+° more upright than at address/);
});

test('joints the model is unsure of are left out; too few frames found is said, and not used for trends or readings', async () => {
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_hid' });
  await app.waitFor(() => app.$('#pose_sw_hid'), { what: 'hidden measured' });
  const m = app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_hid'))`);
  assert.deepEqual([m.found, m.of, m.reliable], [11, 16, false]);
  assert.equal(m.series.hip[1], null, 'no hips on that frame: no number, never a guess');
  assert.match(app.text('#pose_sw_hid'), /11 of 16 frames · 2D · impact from the hands · too few to rely on/);
  assert.equal(app.E(`poseContext(session('s_oct').swings.find(s => s.id === 'sw_hid'))`), '');
});

test('no movement reads as none, not as 0% toward the target', () => {
  const sw = app.J(`session('s_oct').swings.find(s => s.id === 'sw_face')`);
  const still = { ...sw, id: 'still', pose: { ...sw.pose, frames: sw.pose.frames.map(f => ({ ...f, j: sw.pose.frames[0].j })) } };
  const html = app.E(`poseSection(${JSON.stringify(still)}, session('s_oct'))`);
  assert.match(html, /Hip sway at the top:<\/b> no measurable movement/);
});

test('impact as he marked it wins over the hands', () => {
  const sw = app.J(`session('s_oct').swings.find(s => s.id === 'sw_face')`);
  const m = app.J(`poseMeasures(${JSON.stringify({ ...sw, impact: 0.95 })})`);
  assert.equal(m.keys.impact, 9); assert.equal(m.impFrom, 'marked');
  assert.ok(m.keys.top < 9);
});

test('removing a frame afterwards keeps every other frame\'s joints with its own frame', async () => {
  app.act('dropFrame', { sid: 's_oct', wid: 'sw_face', fi: 2 });
  await app.waitFor(async () => (await doc('s_oct')).swings.find(s => s.id === 'sw_face').frames.length === 15, { what: 'dropped' }).catch(async () => { await app.answer(true); });
  await app.waitFor(() => app.J(`poseFrames(session('s_oct').swings.find(s => s.id === 'sw_face')).length`) === 15, { what: 'aligned' });
  assert.deepEqual(app.J(`poseFrames(session('s_oct').swings.find(s => s.id === 'sw_face')).map(f => f.asset)`).slice(0, 4), ['fa0', 'fa1', 'fa3', 'fa4']);
});

test('the reading gets the measures as measurements', () => {
  const p = app.E(`swingPrompt(session('s_oct').swings.find(s => s.id === 'sw_dtl'), session('s_oct'))`);
  assert.match(p, /MEASURED FROM THESE FRAMES \(a pose model's joints, 2D, top and impact from the hands\): Hips toward the ball at impact: /);
  assert.match(p, /say if what you see disagrees/);
});

test('Swing history: measure the rest in one go, then each measure swing by swing per club and view', async () => {
  app.go('swings');
  assert.match(app.text('#measureAll'), /Measure the body on 1 swing/);
  app.click('#measureAll');
  await app.waitFor(async () => (await doc('s_sep')).swings[0].pose, { what: 'measured all' });
  // The page redraws once the save lands, a moment after the server has it (the trend table was already there from the
  // other swings, so waiting for it alone raced the redraw under load).
  await app.waitFor(() => !app.$('#measureAll') && app.$('#ptrend_7i'), { what: 'redrawn: nothing left to measure' });
  // 2.58.0: one row a measure, the latest swing's value, the change since the first, how many swings.
  const sway = app.$('#ptrend_7i tr[data-k="swayTop"]');
  assert.deepEqual([...sway.children].map(td => td.textContent), ['Hip sway at the topFace on', '-12%25 Oct 2026', '0%since Sept 2026', '3']);
  // Hips at impact are measurable on the unreliable swing too (its frame 11 has hips), yet only the three reliable ones count.
  assert.equal(app.text('#ptrend_7i tr[data-k="hipImpact"] td.n'), '3', 'the unreliable one left out');
  assert.match(app.text('#ptrend_7i tr[data-k="extImpact"]'), /Hips toward the ball at impact.*Down the line/);
  assert.equal(app.$$('#ptrend_7i tbody tr').length, 7, 'a row a measure (hands height at impact needs a marked impact: none here), nothing date by date');
});

test('a model that can\'t run says what it needs and stores nothing', async () => {
  const s = await doc('s_oct');
  await app.api.put('sessions', 's_oct', { ...s, swings: s.swings.concat({ id: 'sw_new', view: 'face', club: '7i', frames: fr('fa', 4), addedOn: '2026-10-25' }) });
  await app.waitFor(() => app.E(`!!session('s_oct').swings.find(s => s.id === 'sw_new')`), { what: 'poll' });
  app.go('range', { sessionId: 's_oct' });
  fail = true;
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_new' });
  await app.waitFor(() => /couldn't run in this browser \(no SIMD\)\. It needs WebAssembly with SIMD/.test(app.text('#pm_sw_new')), { what: 'said' });
  fail = false;
  assert.equal((await doc('s_oct')).swings.find(s => s.id === 'sw_new').pose, undefined);
});

test('an import re-links the joints to the copied frames', async () => {
  const s = await doc('s_sep');
  const data = { format: 'carry-export', version: 1, clubs: [], courses: [], settings: {}, sessions: [{ ...s, id: 's_copy' }],
    assets: Object.fromEntries(s.swings[0].frames.map(f => [f.asset, `data:image/png;base64,${Buffer.from(f.asset).toString('base64')}`])) };
  await app.win.eval(`applyImport(${JSON.stringify(data)})`);
  const c = (await doc('s_copy')).swings[0];
  assert.notEqual(c.frames[0].asset, 'sep0');
  assert.deepEqual(c.pose.frames.map(f => f.asset), c.frames.map(f => f.asset));
});

test('no body on any frame says so (not that the view is wrong), and a measured swing can be measured again', async () => {
  // 2.56.1: a face-on clip where the model found no one read "measures need a face-on or
  // down-the-line view: this one is Face on", and a measured swing had no way to measure again.
  ANSWERS.no = Array.from({ length: 16 }, () => null);
  const s = await doc('s_oct');
  await app.api.put('sessions', 's_oct', { ...s, swings: s.swings.concat({ id: 'sw_none', view: 'face', club: '7i', frames: fr('no', 4), addedOn: '2026-10-25' }) });
  await app.waitFor(() => app.E(`!!session('s_oct').swings.find(s => s.id === 'sw_none')`), { what: 'poll' });
  app.go('range', { sessionId: 's_oct' });
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_none' });
  await app.waitFor(() => app.$('#pose_sw_none'), { what: 'measured' });
  const t = app.text('#pose_sw_none');
  assert.match(t, /0 of 4 frames · 2D · too few to rely on/);
  assert.match(app.text('#poseNone_sw_none'), /^No body was found on these frames\. Film with the whole body in the picture, then measure again\.$/);
  assert.doesNotMatch(t, /measures need a face-on or down-the-line view/);
  assert.doesNotMatch(t, /from the hands/, 'no hands were found');
  // The same frames answered with a body now: Measure again replaces the joints.
  ANSWERS.no = FACE;
  asked = [];
  // 2.68.0: Measure again is in the card's More… sheet.
  app.click('#view [data-act="swingMore"][data-wid="sw_none"]');
  const again = app.$('#swingMoreList [data-act="measureSwing"]');
  assert.match(again.textContent, /^Measure the body again/);
  again.click();
  assert.equal(app.sheetOpen(), false, 'the sheet closes; the progress shows on the card');
  await app.waitFor(async () => ((await doc('s_oct')).swings.find(s => s.id === 'sw_none').pose.frames || []).every(f => f.j), { what: 'measured again' });
  assert.deepEqual(asked, fr('no', 4).map(f => '/_blob/' + f.asset));
  await app.waitFor(() => /4 of 4 frames/.test(app.text('#pose_sw_none')), { what: 'redrawn' });
  assert.equal(app.$('#poseNone_sw_none'), null);
  app.click('#view [data-act="swingMore"][data-wid="sw_face"]');
  assert.ok(app.$('#swingMoreList [data-act="measureSwing"]'), 'every measured swing offers it');
  app.$('#sheetInner [data-close]').click();
  // 2.58.0 (he asked): once measured, the frame strip folds away; the four positions show the swing.
  const strip = app.$('#frames_sw_face');
  assert.ok(strip && strip.tagName === 'DETAILS' && !strip.open && strip.querySelector('.filmstrip'));
  assert.equal(app.text('#frames_sw_face summary'), `Frames · ${app.J("session('s_oct').swings.find(s => s.id === 'sw_face').frames.length")}`);
});

test('a face-on clip filmed from the side gives no face-on measures, and says why', async () => {
  // 2.56.1: on his phone a course swing read -256% hip sway and -394% hips at impact: hips almost in
  // line at address (camera not square on), so a shift was divided by a width near nothing.
  ANSWERS.sd = FACE.map(j => j.map(([x, y, v]) => [0.5 + (x - 0.5) * 0.25, y, v]));   // hips 0.025 apart over a 0.25 torso
  const s = await doc('s_oct');
  await app.api.put('sessions', 's_oct', { ...s, swings: s.swings.concat({ id: 'sw_side', view: 'face', club: '7i', frames: fr('sd'), addedOn: '2026-10-26' }) });
  await app.waitFor(() => app.E(`!!session('s_oct').swings.find(s => s.id === 'sw_side')`), { what: 'poll' });
  app.go('range', { sessionId: 's_oct' });
  app.act('measureSwing', { sid: 's_oct', wid: 'sw_side' });
  await app.waitFor(() => app.$('#pose_sw_side'), { what: 'measured' });
  const m = app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_side'))`);
  assert.equal(m.square, false);
  assert.ok(app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_side')))`).every(x => x.v == null), 'nothing measured');
  assert.match(app.text('#poseSquare_sw_side'), /^Not measured: at address the hips and shoulders are almost in line/);
  assert.equal(app.$$('#bodyAll_sw_side .dlines li').length, 0);
  assert.doesNotMatch(app.E(`swingPrompt(session('s_oct').swings.find(s => s.id === 'sw_side'), session('s_oct'))`), /MEASURED FROM THESE FRAMES/);
  assert.equal(app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face')).square`), true, 'a square-on clip still measures');
  // Kept out of the club's trend, which still lists the square-on swings.
  app.go('swings');
  app.$('#swc_7i').open = true;
  const sway = app.$('#ptrend_7i tr[data-k="swayTop"]');
  assert.ok(sway && !/26 Oct/.test(sway.textContent), 'the side-on swing is not the latest point');
});

test('the swing trend list keeps its own height (it once took the scoring chart\'s 80 px and drew over the page)', () => {
  // 2.56.1: `ul.trend` shared `.trend` with the Overview's bar chart: height 80px, so each club's
  // list overflowed onto the timeline below on his phone.
  app.go('swings');
  const ul = app.$('#ptrend_7i');
  assert.ok(ul, 'the list is there');
  assert.ok(!ul.classList.contains('trend'), 'not the bar chart\'s class');
  assert.notEqual(app.win.getComputedStyle(ul).height, '80px');
  app.go('overview');
  for (const el of app.$$('.trend')) assert.equal(el.tagName, 'DIV', 'only the bar chart is .trend');
});

test('the guide: dotted bands at the top and impact, red where the swing is outside, said in the list', () => {
  // 2.57.0: hips face-on from Sportsbox's tour data (under ~2 in away at the top, ~5 in toward the
  // target at impact) over an assumed 11 in between the hip points; the rest rules of thumb.
  const m = app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face'))`);
  const band = (s, at) => app.J(`poseBand(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face')), '${s}', '${at}')`);
  near(band('hip', 'top')[0], -200 / 11); near(band('hip', 'top')[1], 200 / 11);
  near(band('hip', 'impact')[0], 350 / 11); near(band('hip', 'impact')[1], 650 / 11);
  assert.deepEqual(band('head', 'impact'), [-15, 5]); assert.deepEqual(band('arm', 'top'), [150, 180]);
  assert.equal(band('tilt', 'impact'), null, 'no guide for spine tilt: nothing to stand on');
  // Hips 20% toward the target at impact: short of the ~32% the guide starts at. Sway -12% at the top: inside.
  const off = Object.fromEntries(app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_face'))).map(x => [x.k, x.off])`));
  assert.deepEqual(off, { swayTop: false, hipImpact: true, headImpact: false, armTop: false });
  app.go('range', { sessionId: 's_oct' });
  const hip = app.$('#ptr_sw_face .ptrace[data-k="hip"]'), head = app.$('#ptr_sw_face .ptrace[data-k="head"]'), tilt = app.$('#ptr_sw_face .ptrace[data-k="tilt"]');
  assert.equal(hip.querySelectorAll('.tr-band').length, 2, 'a band at the top and at impact');
  assert.ok(hip.querySelector('.tr-guide'), 'a dotted guide path');
  assert.equal(hip.querySelectorAll('.tr-off').length, 1, 'impact marked red');
  assert.ok(hip.classList.contains('off'));
  assert.equal(head.querySelectorAll('.tr-off').length, 0); assert.ok(!head.classList.contains('off'));
  assert.equal(tilt.querySelectorAll('.tr-band').length, 0, 'no band without a guide');
  // 2.57.1, his iPad: the chart scaled with its column, so the words, boxes and dots grew about 4x. The
  // lines stretch (preserveAspectRatio none); the words, boxes and dots are page elements at a fixed size.
  const svg = hip.querySelector('svg');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'none');
  assert.equal(svg.querySelectorAll('text, rect, circle').length, 0, 'nothing in the stretched drawing that would grow with it');
  // 2.60.1: all four positions marked on each chart and named once under them, placed by time in the clip.
  assert.equal(hip.querySelectorAll('svg line.tr-mark').length, 4);
  const labs = [...app.$$('#ptr_sw_face .traxis .tr-alab')];
  assert.deepEqual(labs.map(x => x.textContent), ['Address', 'Top', 'Impact', 'Finish']);
  assert.equal(app.$$('#ptr_sw_face .traxis').length, 1, 'named once, not under every chart');
  // keys 0, 7, 11, 15 at t 0.05 + 0.1i: 5 + (t - 0.05) / 1.5 * 230 of 240
  const pct = t => (100 * (5 + (t - 0.05) / 1.5 * 230) / 240).toFixed(2) + '%';
  assert.deepEqual(labs.map(x => x.style.left), [pct(0.05), pct(0.75), pct(1.15), pct(1.55)]);
  assert.deepEqual(labs.map(x => x.className), ['tr-alab l', 'tr-alab', 'tr-alab', 'tr-alab r']);
  // Frames packed around a marked impact: across is the clip's time, not one column per frame.
  const packed = app.J(`(() => { const m = { frames: [0.05, 0.5, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.55].map(t => ({ t })), keys: { address: 0, top: 2, impact: 5, finish: 8 } }; const X = poseX(m, 240, 5); return [X(2), X(5), X(8)].map(x => +x.toFixed(2)); })()`);
  assert.deepEqual(packed, [+(5 + 0.85 / 1.5 * 230).toFixed(2), +(5 + 1.05 / 1.5 * 230).toFixed(2), 235]);
  // A time missing or out of order: one frame a step, never a line running off the chart.
  assert.deepEqual(app.J(`(() => { const X = poseX({ frames: [1.45, 1.55, 1.35, 1.5].map(t => ({ t })) }, 240, 5); return [0, 1, 2, 3].map(i => +X(i).toFixed(2)); })()`), [5, +(5 + 230 / 3).toFixed(2), +(5 + 460 / 3).toFixed(2), 235]);
  // Two names closer than a sixth of the width: the second drops a line rather than run into the first.
  const close = app.E(`poseAxis({ frames: [0, 0.5, 1, 1.1, 2].map(t => ({ t })), keys: { address: 0, top: 2, impact: 3, finish: 4 } }, 240, 5)`);
  assert.match(close, /data-k="impact" style="[^"]*"/); assert.match(close, /tr-alab lo" data-k="impact"/); assert.match(close, /tr-row two/);
  assert.ok(hip.querySelector('.trbox > span.tr-off') && hip.querySelector('.trbox > span.tr-band'));
  assert.match(app.text('#poseGuide_sw_face'), /^Dotted: a guide at the top and impact\. Red: outside it\. Hips from tour data \(Sportsbox\), the rest rules of thumb\. Not a measurement of you\.$/);
  // Down the line: forward bend held within 6° of its own address.
  const d = app.J(`poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_dtl'))`);
  const bb = app.J(`poseBand(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_dtl')), 'bend', 'impact')`);
  near(bb[0], d.series.bend[d.keys.address] - 6); near(bb[1], d.series.bend[d.keys.address] + 6);
  assert.match(app.E(`poseContext(session('s_oct').swings.find(s => s.id === 'sw_face'))`), /Hips at impact: 20% of hip width toward the target from where they started \(outside a coaching guide for this position\)/);
  // Nothing about the guide is stored.
  assert.ok(!JSON.stringify(app.J(`session('s_oct').swings`)).includes('guide'));
});

test('a swing\'s camera angle can be changed: the measures follow, and a reading made under the old one says so', async () => {
  // 2.57.0: he asked, after a down-the-line clip marked face-on read -394% hip sway.
  app.go('range', { sessionId: 's_oct' });
  const s0 = await doc('s_oct');
  await app.api.put('sessions', 's_oct', { ...s0, swings: s0.swings.map(w => w.id === 'sw_dtl' ? { ...w, view: 'face', analysis: { one_thing: 'Stay in your posture' }, analysedOn: '2026-10-25' } : w) });
  await app.waitFor(() => app.E(`session('s_oct').swings.find(s => s.id === 'sw_dtl').view === 'face'`), { what: 'poll' });
  app.go('range', { sessionId: 's_oct' });
  app.click('#view [data-act="swingMore"][data-wid="sw_dtl"]');
  app.click('#swingMoreList [data-act="swingAngle"]');
  assert.deepEqual(app.$$('#angleChoices .choice b').map(b => b.textContent), ['Down the line', 'Face on current', 'Other angle']);
  assert.ok(app.$('#angleChoices [data-v="face"]').hasAttribute('autofocus'), 'the sheet opens on the current angle, not the first');
  assert.equal(app.$('#angleChoices [data-v="face"]').getAttribute('aria-pressed'), 'true');
  app.click('#angleChoices [data-v="dtl"]');
  await app.waitFor(async () => (await doc('s_oct')).swings.find(s => s.id === 'sw_dtl').view === 'dtl', { what: 'saved' });
  const sw = (await doc('s_oct')).swings.find(s => s.id === 'sw_dtl');
  assert.equal(sw.analysedView, 'face', 'the angle the reading was made under');
  assert.deepEqual(sw.analysis, { one_thing: 'Stay in your posture' }, 'the reading kept');
  await app.waitFor(() => app.$('#angleNote_sw_dtl'), { what: 'redrawn' });
  assert.match(app.text('#angleNote_sw_dtl'), /^This reading was made when the clip was marked Face on\. Analyse again to read it as Down the line\.$/);
  assert.deepEqual(app.J(`poseValues(poseMeasures(session('s_oct').swings.find(s => s.id === 'sw_dtl'))).map(x => x.k)`), ['extImpact', 'bendLoss', 'headUp', 'handsImpact'], 'measured as down the line');
  // Back to the angle it was read under: no note.
  app.act('swingAngle', { sid: 's_oct', wid: 'sw_dtl' });
  app.click('#angleChoices [data-v="face"]');
  await app.waitFor(async () => (await doc('s_oct')).swings.find(s => s.id === 'sw_dtl').view === 'face', { what: 'saved again' });
  await app.waitFor(() => !app.$('#angleNote_sw_dtl'), { what: 'note gone' });
  // (An analysis records the angle it was made under: ui-swing, against a stubbed reading.)
});
