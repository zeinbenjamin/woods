// This swing, in one place (2.67.0, he found the card's parts each talking about their own thing): the card opens with
// the ball, the body, the plane and the fix in four rows, the traced shot drawn on the swing plane's picture, the rest
// folded. Hand-made down-the-line joints, as in ui-plane.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

const blank = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0.1]);
const joints = pts => { const j = blank(); for (const [i, x, y] of pts) j[i] = [x, y, 0.99]; return j; };
const body = (nose, sh, wr, hip, shR = sh) => [[0, ...nose], [11, ...sh], [12, ...shR], [15, ...wr], [16, ...wr], [23, ...hip], [24, ...hip]];
const ADDR = body([0.62, 0.30], [0.555, 0.355], [0.60, 0.62], [0.455, 0.60]);
const ADDR_OFF = body([0.62, 0.30], [0.50, 0.355], [0.60, 0.62], [0.455, 0.60], [0.62, 0.355]);   // shoulders 0.12 apart: off the line
const TOP = body([0.61, 0.30], [0.54, 0.36], [0.42, 0.22], [0.455, 0.60]);
const DOWN = body([0.61, 0.30], [0.54, 0.36], [0.52, 0.43], [0.455, 0.60]);       // on the way: inside the V
const STEEP = body([0.61, 0.30], [0.54, 0.36], [0.62, 0.40], [0.455, 0.60]);      // over the shoulder line
const IMP = body([0.62, 0.30], [0.555, 0.355], [0.62, 0.64], [0.455, 0.60]);       // hands 0.02 under address
const IMP_HIGH = body([0.62, 0.30], [0.555, 0.355], [0.64, 0.50], [0.455, 0.60]);  // hands 0.12 over address
const FIN = body([0.52, 0.28], [0.50, 0.33], [0.40, 0.18], [0.47, 0.58]);
function frames16(keys) {
  const out = [];
  for (let f = 0; f < 16; f++) {
    let s = 0; while (s < keys.length - 1 && f > keys[s + 1][0]) s++;
    const [fa, A] = keys[s], [fb, B] = keys[Math.min(keys.length - 1, s + 1)], t = fb === fa ? 0 : (f - fa) / (fb - fa), ja = joints(A), jb = joints(B);
    out.push(ja.map((p, i) => [p[0] + (jb[i][0] - p[0]) * t, p[1] + (jb[i][1] - p[1]) * t, ja[i][2]]));
  }
  return out;
}
const BALL = { x: 0.70, y: 0.78 };
const swing = (id, clubCode, { addr = ADDR, down = DOWN, imp = IMP, ball = BALL, hide = null, mark = true } = {}) => {
  const J = frames16([[0, addr], [7, TOP], [9, down], [11, imp], [15, FIN]]);
  if (hide != null) for (const j of J) j[hide] = [j[hide][0] + 0.2, j[hide][1], 0.1];   // a wrist the model isn't sure of: somewhere else, unseen
  const frames = J.map((_, i) => ({ asset: `${id}f${i}`, t: +(0.05 + i * 0.1).toFixed(2) }));
  return { id, view: 'dtl', club: clubCode, frames, addedOn: '2026-10-01', ...(ball ? { ball } : {}), ...(mark ? { impact: 1.15 } : {}),
    pose: { by: 'test', on: '2026-10-01', aspect: 1, frames: J.map((j, i) => ({ asset: frames[i].asset, t: frames[i].t, j })) } };
};
const S1 = 's_sum';
const COACHED = { one_thing: 'Keep your chest down through impact', why: 'Frame 11 stands up.', feel: 'Chest to the ball', drill: { name: 'Wall drill', how: 'Bum on a wall.' },
  check: 'Ball starts on line', ball_data: 'agrees', ties: 'Hips toward the ball and the hands rising at impact are one move; the low runner fits it.' };
const TRACER = { peak: { x: 0.72, y: 0.1 }, land: { x: 0.8, y: 0.4 }, shape: 'draw', on: '2026-10-01' };
let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 4 })],
    sessions: [{ id: S1, v: 2, type: 'range', date: '2026-10-01', venue: 'Test range', blocks: [
      { id: 'b7', seq: 1, club: '7i', swing: 'full', shots: [{ carry: 120, total: 131, carrySide: -3 }, { carry: 122, total: 133 }] }],
    swings: [
      { ...swing('sw_all', '7i', { imp: IMP_HIGH }), analysis: COACHED, tracer: TRACER, shot: { block: 'b7', i: 0, carry: 120, total: 131 } },
      { ...swing('sw_old', 'D', { down: STEEP }), analysis: { one_thing: 'Swing to the right' } },
      { id: 'sw_bare', view: 'face', club: '7i', frames: [{ asset: 'b0', t: 0.05 }], addedOn: '2026-10-01' }] }] } });
  await app.waitFor(() => app.E('S.sessions.length') === 1, { what: 'seeded' });
});
after(() => app && app.stop());

test('the summary: the ball, the body, the plane and the fix in four rows, the reading joining them', () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: S1 });
  const rows = app.$$('#sum_sw_all > .sumrow').map(r => r.id);
  assert.deepEqual(rows, ['sumBall_sw_all', 'sumBody_sw_all', 'sumPlane_sw_all', 'sumFix_sw_all'], 'in that order');
  assert.equal(app.text('#sumBall_sw_all > b'), 'The ball · draw, traced');
  assert.ok(app.$('#sumBall_sw_all #shotNums_sw_all') && app.$('#sumBall_sw_all #ws_sw_all'));
  // Hands 12% of the frame over address at impact, against a 0.245 torso: outside; the hips, bend and head inside.
  assert.equal(app.text('#sumBody_sw_all > div'), '1 of 4 outside the guide: hands height at impact.');
  assert.equal(app.text('#sumPlane_sw_all > div'), 'Inside the V at the top and coming down.');
  assert.equal(app.text('#sumFix_sw_all .one'), COACHED.one_thing);
  assert.equal(app.text('#ties_sw_all'), 'How it fits together: ' + COACHED.ties);
  const how = app.$('#how_sw_all'); assert.ok(how && !how.open && /Wall drill/.test(how.textContent), 'why, feel and drill one tap down');
  assert.equal(app.$('#tiesHint_sw_all'), null);
  // An older reading: no join, and it says how to get one. A steep swing: the plane said part by part, the miss marked.
  assert.match(app.text('#tiesHint_sw_old'), /Analyse again and Claude says how the ball, the body and the fix fit together/);
  assert.match(app.text('#sumPlane_sw_old > div'), /^At the top: inside the V · Coming down: \d+° over the shoulder line, steeper than the V\.$/);
  assert.ok(app.$('#sumPlane_sw_old .offg'));
  assert.equal(app.text('#sumBall_sw_old > b'), 'The ball', 'nothing traced');
  assert.match(app.text('#sumBall_sw_old'), /Which shot was this\?/, 'not tied: it asks');
  // Nothing measured, read or tied: the only row is the question of which shot it was.
  assert.deepEqual(app.$$('#sum_sw_bare > .sumrow').map(r => r.id), ['sumBall_sw_bare']);
  assert.match(app.text('#sumBall_sw_bare'), /Which shot was this\?/);
  // The rest is folded: every measure, across the swing, the frames.
  assert.ok(app.$('#bodyAll_sw_all') && !app.$('#bodyAll_sw_all').open && app.$('#bodyAll_sw_all .dlines'));
});

test('one picture: the traced shot on the swing plane\'s, both switches on its row; either off, each draws its own', () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: S1 });
  const pic = app.$('#plane_sw_all .planePic');
  assert.ok(pic.querySelector('svg.planeSv .pl-shaft') && pic.querySelector('svg.trShot .ts-line'), 'both on one picture');
  assert.match(app.text('#plane_sw_all .tracerTag'), /^Shot traced by you · Draw$/);
  assert.equal(app.$('#tracer_sw_all'), null, 'no second picture');
  assert.ok(app.$('#plane_sw_all #planeSw_sw_all') && app.$('#plane_sw_all #tracerSw_sw_all'));
  assert.ok(app.$('#plane_sw_all [data-act="traceShot"]'), 'redraw is still there');
  // The crop reaches the peak: the tracer's 0.1 is above the hands' highest point.
  const crop = app.$('#plane_sw_all .planeCrop').getAttribute('style'), top = -parseFloat(/top:(-?[\d.]+)%/.exec(crop)[1]), h = parseFloat(/height:([\d.]+)%/.exec(crop)[1]);
  assert.ok(Math.abs(top / h - 0.02) < 0.002, `cropped from 0.02, the plane's margin over the peak (${top / h})`);
  app.click('#tracerSw_sw_all');
  assert.ok(!app.$('#plane_sw_all svg.trShot') && app.$('#tracer_sw_all #tracerSw_sw_all'), 'tracer off: off the picture, its switch on its own row');
  app.click('#tracerSw_sw_all'); app.click('#planeSw_sw_all');
  assert.ok(app.$('#tracer_sw_all .tracerPic svg.trShot') && !app.$('#plane_sw_all .planePic'), 'plane off: the tracer draws its own picture');
  app.win.localStorage.removeItem('carry.overlays');
});

test('the reading is asked how it fits together only when there is something to fit; the Swings card carries the summary', () => {
  assert.match(app.E(`swingPrompt(session('${S1}').swings[0], session('${S1}'))`), /"ties": "how it fits together \(30 words or fewer\): which of the MEASURED positions above and this swing's own shot/);
  assert.doesNotMatch(app.E(`swingPrompt(session('${S1}').swings[2], session('${S1}'))`), /"ties"/);
  app.act('reelCard', { sid: S1, wid: 'sw_all' });
  assert.ok(app.$('#sheetInner #rc_sum_sw_all #rc_shotNums_sw_all') && app.$('#sheetInner #rc_ties_sw_all'));
  assert.equal(app.$('#sheetInner #rc_sum_sw_all [data-act]'), null, 'read-only');
  app.$('#sheetInner [data-close]').click();
});
