// The hands traced from the video (2.64.0, he asked for the hand line smooth like the tracers on golf videos).
// jsdom can't decode video, so a stand-in (window.carryVideoFrames) answers each seek with the frame a 30 fps
// clip would show, and the stand-in pose model (window.carryPose) places the hands on it by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

const blank = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0.1]);
const joints = pts => { const j = blank(); for (const [i, x, y] of pts) j[i] = [x, y, 0.99]; return j; };
const body = (nose, sh, wr, hip) => [[0, ...nose], [11, ...sh], [12, ...sh], [15, ...wr], [16, ...wr], [23, ...hip], [24, ...hip]];
const ADDR = body([0.62, 0.30], [0.555, 0.355], [0.60, 0.62], [0.455, 0.60]);
const TOP = body([0.61, 0.30], [0.54, 0.36], [0.42, 0.22], [0.455, 0.60]);
const DOWN = body([0.61, 0.30], [0.54, 0.36], [0.52, 0.43], [0.455, 0.60]);
const IMP = body([0.62, 0.30], [0.555, 0.355], [0.62, 0.64], [0.455, 0.60]);
const FIN = body([0.52, 0.28], [0.50, 0.33], [0.40, 0.18], [0.47, 0.58]);
const KEYS = [[0, ADDR], [7, TOP], [9, DOWN], [11, IMP], [15, FIN]];
const TS = Array.from({ length: 16 }, (_, i) => +(0.05 + i * 0.1).toFixed(2));
// The joints at any time in the clip: straight between the five key frames.
function jointsAt(t) {
  const f = Math.max(0, Math.min(15, (t - 0.05) / 0.1));
  let s = 0; while (s < KEYS.length - 2 && f > KEYS[s + 1][0]) s++;
  const [fa, A] = KEYS[s], [fb, B] = KEYS[s + 1], u = Math.max(0, Math.min(1, (f - fa) / (fb - fa))), ja = joints(A), jb = joints(B);
  return ja.map((p, i) => [p[0] + (jb[i][0] - p[0]) * u, p[1] + (jb[i][1] - p[1]) * u, ja[i][2]]);
}
const HIDDEN = t => t > 0.98 && t < 1.06;   // the model loses both wrists here, as blur at speed does
const ONE = t => t > 0.4 && t < 0.5;         // and the lead wrist alone here, hidden behind the other down the line
// A slow-motion clip, as his 3 Aug 7i is: 8 frames across 13 s, the swing eight times slower, from 0.4 s.
const SLOW = t => (t - 0.4) / 8 + 0.05, LONG_TS = Array.from({ length: 8 }, (_, i) => +(0.55 + i * 11.45 / 7).toFixed(2));
const swing = (id, { pose = true, video = `${id}_vid`, ts = TS, at = t => t, impact = 1.15 } = {}) => {
  const frames = ts.map((t, i) => ({ asset: `${id}f${i}`, t }));
  return { id, view: 'dtl', club: '7i', frames, addedOn: '2026-10-01', ...(impact != null ? { impact } : {}), ball: { x: 0.7, y: 0.78 }, ...(video ? { video } : {}),
    ...(pose ? { pose: { by: 'test', on: '2026-10-01', aspect: 1, frames: frames.map(f => ({ asset: f.asset, t: f.t, j: jointsAt(at(f.t)) })) } } : {}) };
};

let app;
const doc = id => app.api.get('sessions', id);
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 4 })],
    sessions: [{ id: 's1', v: 2, type: 'range', date: '2026-10-01', venue: 'Test range', blocks: [],
      swings: [swing('sw_a'), swing('sw_b', { pose: false }), swing('sw_bad', { video: 'bad_vid' }), swing('sw_novid', { video: null }), swing('sw_long', { ts: LONG_TS, at: SLOW, impact: null })] }] } });
  await app.waitFor(() => app.E('S.sessions.length') === 1, { what: 'seeded' });
  app.win.carryVideoFrames = async (src, times, onFrame) => {
    if (src.includes('bad')) throw new Error('unreadable');
    for (let i = 0; i < times.length; i++) { const t = Math.round(times[i] * 30) / 30; await onFrame(t, { t, src }, i); }   // a 30 fps clip: the frame shown
  };
  app.win.carryPose = {
    async detect(src) { const i = +src.match(/f(\d+)$/)[1]; return { w: 9, h: 16, joints: src.includes('long') ? jointsAt(SLOW(LONG_TS[i])) : jointsAt(TS[i]) }; },
    async detectCanvas(c) { if (c.src.includes('long')) { const j = jointsAt(SLOW(c.t)), e = 0.006 * Math.sin(c.t * 97); j[15] = [j[15][0], j[15][1] + e, j[15][2]]; j[16] = [j[16][0], j[16][1] + e, j[16][2]]; return { w: 9, h: 16, joints: j }; } /* the model's wobble: more than the slowed hands move a frame */ const j = jointsAt(c.t); if (HIDDEN(c.t)) { j[15] = [j[15][0], j[15][1], 0.1]; j[16] = [j[16][0], j[16][1], 0.1]; } if (ONE(c.t)) j[15] = [j[15][0] + 0.2, j[15][1], 0.1]; return { w: 9, h: 16, joints: j }; },
  };
});
after(() => app && app.stop());

test('the smoothing goes through every point and keeps a straight line straight', () => {
  const r = app.J(`crSegs([[0, 0], [1, 1], [2, 2], [3, 3]])`);
  assert.equal(r.length, 3);
  for (const [i, [a, b1, b2, b]] of r.entries()) {
    assert.deepEqual([a, b], [[i, i], [i + 1, i + 1]], 'through each point');
    for (const c of [b1, b2]) assert.ok(Math.abs(c[0] - c[1]) < 1e-12, 'controls on the line');
  }
  // A bend: the curve still meets each point; a repeated point doesn't make a NaN.
  const bend = app.J(`crSegs([[0, 0], [1, 0], [1, 0], [1, 1]])`);
  assert.deepEqual(bend.map(s => [s[0], s[3]]), [[[0, 0], [1, 0]], [[1, 0], [1, 0]], [[1, 0], [1, 1]]]);
  assert.ok(bend.flat(2).every(Number.isFinite));
  // Centripetal: three points bunched and one far don't make a loop past the far point's side.
  // (the plain kind sends the middle segment's handle back past its start: -0.145 here).
  const hook = app.J(`crSegs([[0, 0], [0.01, 0], [0.02, 0], [1, 0]])`);
  for (const [a, b1, b2, b] of hook) for (const c of [b1, b2]) assert.ok(c[0] >= a[0] - 1e-9 && c[0] <= b[0] + 1e-9, `control ${c[0]} inside ${a[0]}..${b[0]}`);
});

test('traced from the video: the frames a 30 fps clip shows, each once, the hands from the one sure wrist or both', async () => {
  app.go('range', { sessionId: 's1' });
  assert.match(app.text('#traceNote_sw_a'), /^Dotted: from the 16 frames only, so the line between them is drawn, not measured\. Trace the hands from the video for the real path\.$/);
  assert.ok(app.$('#plane_sw_a path.pl-back.sparse'));
  app.click('#view [data-act="swingMore"][data-wid="sw_a"]');
  app.click('#swingMoreList [data-act="traceSwing"]');
  await app.waitFor(async () => (await doc('s1')).swings.find(w => w.id === 'sw_a').track, { what: 'traced' });
  const tr = (await doc('s1')).swings.find(w => w.id === 'sw_a').track;
  // 90 seeks over 0.05..1.55 s land on 46 distinct 1/30 s frames: 2/30 to 47/30.
  assert.equal(tr.pts.length, 46);
  assert.deepEqual([tr.pts[0][0], tr.pts[45][0]], [+(2 / 30).toFixed(3), +(47 / 30).toFixed(3)]);
  assert.ok(tr.pts.every(p => p.length === 7));
  assert.deepEqual(Object.keys(tr).sort(), ['by', 'on', 'pts']);
  await app.waitFor(() => app.$('#traceNote_sw_a') && /video/.test(app.text('#traceNote_sw_a')) && !/Dotted/.test(app.text('#traceNote_sw_a')), { what: 'redrawn' });
  // Two frames lost at speed: 44 points, two runs, never bridged.
  assert.equal(app.text('#traceNote_sw_a'), 'The hands from 44 frames of the video; the line is smoothed between them, and broken where the hands weren\'t found surely.');
  const d = app.J(`(() => { const d = traceData(session('s1').swings.find(w => w.id === 'sw_a')); return { dense: d.dense, runs: d.runs.map(r => [r[0].t, r[r.length - 1].t, r.length]), cuts: d.cuts }; })()`);
  assert.equal(d.dense, true);
  assert.deepEqual(d.runs, [[+(2 / 30).toFixed(3), +(29 / 30).toFixed(3), 28], [+(32 / 30).toFixed(3), +(47 / 30).toFixed(3), 16]]);
  // Where the colours change, from the trace's own motion: the top the hands highest before the downswing (22/30 s,
  // not the frame at 0.75), impact where he marked it, or unmarked the lowest after it (34/30 s, the frames say 1.15).
  assert.deepEqual(d.cuts, [+(2 / 30).toFixed(3), +(22 / 30).toFixed(3), 1.15, +(47 / 30).toFixed(3)]);
  assert.deepEqual(app.J(`traceData({ ...session('s1').swings.find(w => w.id === 'sw_a'), impact: null }).cuts`), [+(2 / 30).toFixed(3), +(22 / 30).toFixed(3), +(34 / 30).toFixed(3), +(47 / 30).toFixed(3)]);
  assert.ok(!app.$('#plane_sw_a path.sparse'), 'solid now');
  app.click('#view [data-act="swingMore"][data-wid="sw_a"]');
  assert.ok(!app.$('#swingMoreList [data-act="traceSwing"]'), 'nothing more to trace');
  app.$('#sheetInner [data-close]').click();
  // The colours change at the top and impact: green to the top, white to impact, grey after.
  const segs = sel => app.$$(`#plane_sw_a path.${sel}`).reduce((n, p) => n + (p.getAttribute('d').match(/C/g) || []).length, 0);
  assert.equal(segs('pl-back') + segs('pl-down') + segs('pl-thru'), 27 + 15);
  assert.ok(segs('pl-back') > 0 && segs('pl-down') > 0 && segs('pl-thru') > 0);
  // Measures still come from the 16 frames: nothing about them moved.
  assert.equal(app.J(`poseMeasures(session('s1').swings.find(w => w.id === 'sw_a')).keys.top`), 7);
});

test('measuring a swing with a video traces it too; a clip that won\'t decode keeps the frames and says so', async () => {
  const res = await app.E(`measureAndSave('s1', 'sw_b')`);
  assert.ok(res.ok && res.track && !res.traceErr);
  const b = (await doc('s1')).swings.find(w => w.id === 'sw_b');
  assert.ok(b.pose && b.track && b.track.pts.length === 46);
  const bad = await app.E(`measureAndSave('s1', 'sw_bad')`);
  assert.ok(bad.ok && !bad.track && bad.traceErr === 'unreadable');
  assert.ok(!(await doc('s1')).swings.find(w => w.id === 'sw_bad').track);
  await app.waitFor(() => app.$('#plane_sw_bad .planePic'), { what: 'drawn' });
  app.click('#view [data-act="swingMore"][data-wid="sw_bad"]');
  app.click('#swingMoreList [data-act="traceSwing"]');
  await app.waitFor(() => /can't decode the video/.test(app.text('#tr_sw_bad')), { what: 'said' });
  // No video at all: dotted, and says there's nothing to trace.
  assert.match(app.text('#traceNote_sw_novid'), /No video is stored for this swing to trace\.$/);
  app.click('#view [data-act="swingMore"][data-wid="sw_novid"]');
  assert.ok(!app.$('#swingMoreList [data-act="traceSwing"]'));
  app.$('#sheetInner [data-close]').click();
});

test('on the playing clip: the line draws itself to the clip\'s time, whole when paused, and the switch takes it away', async () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: 's1' });
  app.click('[data-act="playSwing"][data-wid="sw_a"]');
  const box = app.$('#sheetInner .trBox');
  assert.ok(box && box.querySelector('video') && box.querySelector('svg.trOv'));
  assert.equal(box.style.getPropertyValue('--ar'), '1.000');
  // Paused: the whole line, the dots at the top and impact, the V.
  const ov = box.querySelector('svg.trOv');
  assert.ok(ov.querySelector('.pl-shaft') && ov.querySelector('.pl-top') && ov.querySelector('.pl-imp') && ov.querySelector('path.pl-thru'));
  // Playing at 0.6 s: only what has happened, the hands as a dot, nothing after impact yet.
  const part = app.E(`(() => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); traceDraw(svg, traceData(session('s1').swings.find(w => w.id === 'sw_a')), 0.6); return svg.innerHTML; })()`);
  assert.match(part, /pl-head/); assert.doesNotMatch(part, /pl-thru|pl-down|pl-top/);
  assert.equal((part.match(/class="pl-back"[^>]*d="[^"]*"/)[0].match(/C/g) || []).length, Math.round(0.6 * 30) - 2, 'the frames up to 0.6 s');
  // The wired overlay itself: playing at 0.6 s it shows the part so far; paused again, the whole.
  const v = box.querySelector('video');
  Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => 0.6, set() {} });
  v.dispatchEvent(new app.win.Event('seeked'));
  assert.ok(ov.querySelector('.pl-head') && !ov.querySelector('path.pl-thru'));
  Object.defineProperty(v, 'paused', { configurable: true, get: () => true });
  v.dispatchEvent(new app.win.Event('pause'));
  assert.ok(!ov.querySelector('.pl-head') && ov.querySelector('path.pl-thru'));
  app.$('#sheetInner [data-close]').click();
  // The feed carries it too.
  app.go('swings', { view: 'reels' });
  assert.ok(app.$('#reels .trBox video[data-reel]') && app.$('#reels .trBox svg.trOv path.pl-back'));
  // Off: no drawing on the clip, the card or the feed.
  app.go('range', { sessionId: 's1' });
  app.click('#planeSw_sw_a');
  app.click('[data-act="playSwing"][data-wid="sw_a"]');
  assert.ok(!app.$('#sheetInner .trBox') && app.$('#sheetInner video'));
  app.$('#sheetInner [data-close]').click();
  app.win.localStorage.removeItem('carry.overlays');
});

test('a slow-motion clip: the whole swing traced, the downswing filled in, and the parts found by motion, not by seconds', async () => {
  // 2.64.1: his 3 Aug 7i is slow motion, the swing filling 2 to 12 s of a 13 s clip; 90 looks across it gave the
  // downswing about ten, a line of corners on his phone.
  app.win.__steps = [];
  const tr = await app.E(`traceHands(session('s1').swings.find(w => w.id === 'sw_long'), (i, n, ph) => window.__steps.push(ph))`);
  const steps = app.J('window.__steps');
  assert.equal(steps.filter(p => p === 'trace').length, 240, 'the whole clip, at most 240 looks');
  assert.equal(steps.filter(p => p === 'fill').length, 120, 'then the downswing filled in');
  // The downswing runs from the top (real 0.75 s) to the hands' low (real 1.15 s), eight times slower: 6.0 to 9.2.
  // Every 30 fps frame between them is there.
  const ts = tr.pts.map(p => p[0]), want = [];
  for (let f = 180; f <= 276; f++) want.push(+(f / 30).toFixed(3));
  assert.deepEqual(want.filter(t => !ts.includes(t)), [], 'no frame of the downswing missing');
  assert.ok(ts.every((t, i) => !i || t > ts[i - 1]), 'in time order: ' + JSON.stringify(ts.filter((t, i) => i && t <= ts[i - 1]).slice(0, 5)));
  const long = { ...app.J(`session('s1').swings.find(w => w.id === 'sw_long')`), track: tr };
  const d = app.J(`(() => { const d = traceData(${JSON.stringify(long)}); return { cuts: d.cuts, runs: d.runs.length }; })()`);
  assert.equal(d.runs, 1, 'denser in the downswing than elsewhere is not a gap');
  assert.ok(Math.abs(d.cuts[1] - 6) < 0.1 && Math.abs(d.cuts[2] - 9.2) < 0.1, `top ${d.cuts[1]}, impact ${d.cuts[2]}`);
  // A normal 30 fps clip already has every frame from the first look: nothing to fill.
  app.win.__steps = [];
  await app.E(`traceHands(session('s1').swings.find(w => w.id === 'sw_a'), (i, n, ph) => window.__steps.push(ph))`);
  assert.equal(app.J('window.__steps').filter(p => p === 'fill').length, 0);
});

test('a swing measured by the earlier model says so, and the Swings page measures it again with the new one', async () => {
  // 2.65.0: lite put his wrists on his forearm going back down the line; heavy replaced it.
  const s0 = await doc('s1');
  await app.api.put('sessions', 's1', { ...s0, swings: s0.swings.map(w => w.id === 'sw_a' ? { ...w, pose: { ...w.pose, by: 'mediapipe-0.10.35-lite' }, track: { ...w.track, by: 'mediapipe-0.10.35-lite' } }
    : w.id === 'sw_b' ? { ...w, pose: { ...w.pose, by: 'mediapipe-0.10.35-heavy' }, track: { ...w.track, by: 'mediapipe-0.10.35-lite' } } : w) });
  await app.waitFor(() => app.E(`session('s1').swings.find(w => w.id === 'sw_a').pose.by.endsWith('lite')`), { what: 'poll' });
  app.go('range', { sessionId: 's1' });
  assert.match(app.text('#poseOld_sw_a'), /^Measured with the earlier body model, which misplaced the wrists from behind\. Measure again/);
  assert.ok(app.$('#poseOld_sw_b'), 'traced by the earlier model, measured by the new: still old');
  assert.ok(!app.$('#poseOld_sw_bad'), 'a swing the new model measured says nothing');
  app.go('swings');
  assert.equal(app.text('#measureAll'), 'Measure 2 swings with the new model');
  app.click('#measureAll');
  await app.waitFor(async () => (await doc('s1')).swings.filter(w => ['sw_a', 'sw_b'].includes(w.id)).every(w => w.pose.by === 'mediapipe-0.10.35-heavy' && w.track.by === 'mediapipe-0.10.35-heavy'), { what: 'measured again' });
  await app.waitFor(() => !app.$('#measureAll'), { what: 'nothing left' });
});
