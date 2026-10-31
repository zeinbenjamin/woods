// The swing plane (2.63.0, he asked with the shot tracer mockup). Down the line, from the measured hands and
// shoulders and one tap on the ball: the shaft line (ball → hands at address), the shoulder line (ball → the
// shoulders' middle), the V between them, and each frame's hands as degrees up from the ball. Worked with
// hand-made joints (aspect 1, so x and y are the same units) whose angles are worked out here by hand.
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
const rangeDay = (date, swings) => ({ id: `s_${date}`, v: 2, type: 'range', date, venue: 'Test range', blocks: [], swings });
// Degrees up from the ball, on the golfer's side of it (the shoulders are left of the ball here).
const up = ([x, y]) => Math.atan2(BALL.y - y, BALL.x - x) * 180 / Math.PI;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} against ${b}`);

let app;
const doc = id => app.api.get('sessions', id);
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 4 })],
    sessions: [
      rangeDay('2026-10-01', [swing('sw_in', '7i'), swing('sw_steep', 'D', { down: STEEP, imp: IMP_HIGH }), swing('sw_off', '5W', { addr: ADDR_OFF }), swing('sw_noball', '9i', { ball: null, mark: false }), swing('sw_lead', '8i', { hide: 15 })]),
      rangeDay('2026-10-08', [swing('sw_steep2', 'D', { down: STEEP, imp: IMP_HIGH })]),
      rangeDay('2026-10-15', [swing('sw_steep3', 'D', { down: STEEP, imp: IMP_HIGH })]),
    ] } });
  await app.waitFor(() => app.E('S.sessions.length') === 3, { what: 'seeded' });
});
after(() => app && app.stop());

test('the V and the hands against it, by hand', () => {
  const m = app.J(`(() => { const m = poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_in')); return { keys: m.keys, inLine: m.inLine, shGap: m.shGap, plane: m.plane, plane9: m.series.plane[9] }; })()`);
  assert.deepEqual(m.keys, { address: 0, top: 7, impact: 11, finish: 15, down: 9 });
  assert.equal(m.inLine, true); assert.equal(m.shGap, 0);
  near(m.plane.shaft, up([0.60, 0.62]), 'shaft line'); near(m.plane.shoulder, up([0.555, 0.355]), 'shoulder line');
  const v = Object.fromEntries(app.J(`poseValues(poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_in'))).map(x => [x.k, [x.v, x.off, x.say(x.v)]])`));
  near(v.planeTop[0], up([0.42, 0.22]), 'top'); assert.equal(v.planeTop[1], false);
  near(v.planeDown[0], up([0.52, 0.43]), 'coming down'); assert.equal(v.planeDown[1], false);
  assert.equal(v.planeDown[2], `inside the V, ${(up([0.52, 0.43]) - up([0.60, 0.62])).toFixed(0)}° above the shaft line (${up([0.52, 0.43]).toFixed(0)}°; the V is ${up([0.60, 0.62]).toFixed(0)}–${up([0.555, 0.355]).toFixed(0)}°)`);
  const torso = Math.hypot(0.555 - 0.455, 0.355 - 0.60);
  near(v.handsImpact[0], 100 * (0.62 - 0.64) / torso, 'hands height'); assert.equal(v.handsImpact[1], false);
  // Down the line one wrist often hides behind the other: the one the model is sure of stands in for both.
  const lead = app.J(`poseValues(poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_lead'))).map(x => [x.k, x.v])`);
  assert.deepEqual(lead, Object.entries(v).map(([k, x]) => [k, x[0]]));
  // Steep: over the shoulder line coming down, the hands high at impact; both outside.
  const st = Object.fromEntries(app.J(`poseValues(poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_steep'))).map(x => [x.k, [x.v, x.off, x.say(x.v)]])`));
  near(st.planeDown[0], up([0.62, 0.40]), 'steep'); assert.equal(st.planeDown[1], true);
  assert.match(st.planeDown[2], new RegExp(`^${(up([0.62, 0.40]) - up([0.555, 0.355])).toFixed(0)}° over the shoulder line, steeper than the V`));
  near(st.handsImpact[0], 100 * 0.12 / torso, 'hands high'); assert.equal(st.handsImpact[1], true);
  // Off the line: shoulders 45% of the torso apart, no plane, no plane measures; without a ball, likewise.
  const off = app.J(`(() => { const m = poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_off')); return { inLine: m.inLine, plane: m.plane || null, ks: poseValues(m).map(x => x.k) }; })()`);
  assert.deepEqual([off.inLine, off.plane], [false, null]);
  assert.deepEqual(off.ks, ['extImpact', 'bendLoss', 'headUp', 'handsImpact']);
  assert.deepEqual(app.J(`poseValues(poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_noball'))).map(x => x.k)`), ['extImpact', 'bendLoss', 'headUp', 'handsImpact']);
  // Unmarked, with frames 0.1 s apart: impact from the hands may be the follow-through, so hands height isn't taken.
  assert.deepEqual(app.J(`(() => { const m = poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_noball')), h = poseValues(m).find(x => x.k === 'handsImpact'); return [m.impFrom, m.impactSure, h.v, h.off, h.why]; })()`),
    ['hands', false, null, null, 'mark impact on the trim to measure this: these frames are too far apart to catch it']);
  assert.equal(app.J(`poseBand(poseMeasures(session('s_2026-10-01').swings.find(s => s.id === 'sw_noball')), 'handsUp', 'impact')`), null, 'no guide box either');
  // Close frames either side of impact catch it without a mark (his marked clips are 0.045 s apart there).
  assert.equal(app.E(`(() => { const sw = session('s_2026-10-01').swings.find(s => s.id === 'sw_noball'); const t = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.10, 1.15, 1.20, 1.35, 1.45, 1.55]; const f = (x, i) => ({ ...x, t: t[i] }); return poseMeasures({ ...sw, frames: sw.frames.map(f), pose: { ...sw.pose, frames: sw.pose.frames.map(f) } }).impactSure; })()`), true);
});

test('drawn on the swing card, the switch hides the drawing on this phone, and off the line says why', async () => {
  app.win.localStorage.removeItem('carry.overlays');
  app.go('range', { sessionId: 's_2026-10-01' });
  const pl = app.$('#plane_sw_in');
  assert.ok(pl.querySelector('.planePic img') && pl.querySelector('svg.planeSv .pl-shaft') && pl.querySelector('svg.planeSv .pl-sh') && pl.querySelector('.pl-vee'));
  // Smooth (2.64.0): one curve a frame gap, address to the top 7, the top to impact 4, after impact 4; dotted, from frames only.
  const segs = sel => (pl.querySelector(sel).getAttribute('d').match(/C/g) || []).length;
  assert.deepEqual([segs('path.pl-back'), segs('path.pl-down'), segs('path.pl-thru')], [7, 4, 4]);
  assert.ok(pl.querySelector('path.pl-back').classList.contains('sparse'));
  assert.ok(!pl.querySelector('.pl-imp.off'));
  assert.ok(app.$('#plane_sw_steep .pl-imp.off'), 'the steep swing\'s impact is red: hands high');
  assert.match(app.text('#plane_sw_in .planeKey'), /Shaft line\s*Shoulder line\s*Hands going back\s*Coming down/);
  assert.match(app.text('#bodyAll_sw_in .dlines'), /Hands at the top, against the plane: inside the V[\s\S]*Hands coming down, against the plane: inside the V[\s\S]*Hands height at impact: 8% of torso length lower than at address/);
  assert.match(app.text('#bodyAll_sw_steep .dlines'), /Hands coming down, against the plane: \d+° over the shoulder line, steeper than the V[^·]*· outside the guide/);
  assert.match(app.text('#poseGuide_sw_in'), /and for the plane coming down too; its band is the V, from the shaft line to the shoulder line/);
  assert.ok(app.$('#ptr_sw_in .ptrace[data-k="plane"]') && app.$('#ptr_sw_in .ptrace[data-k="handsUp"]'), 'across the swing');
  assert.equal(app.$$('#ptr_sw_in .ptrace[data-k="plane"] .tr-band').length, 2, 'the V at the top and coming down');
  // The switch: off hides the drawing, remembered on this phone; the measures stay.
  const sw = app.$('#planeSw_sw_in'); assert.equal(sw.getAttribute('aria-checked'), 'true');
  app.click(sw);
  assert.equal(app.$('#planeSw_sw_in').getAttribute('aria-checked'), 'false');
  assert.ok(!app.$('#plane_sw_in .planePic') && !app.$('#plane_sw_steep .planePic'));
  assert.equal(app.win.localStorage.getItem('carry.overlays'), '{"plane":false}');
  assert.match(app.text('#bodyAll_sw_in .dlines'), /Hands at the top, against the plane/);
  app.click('#planeSw_sw_in'); assert.ok(app.$('#plane_sw_in .planePic'));
  // Off the line: the camera says why, nothing drawn.
  assert.match(app.text('#planeOff_sw_off'), /^At address your shoulders are 45% of your torso apart, so the camera wasn't behind your hands along the line\. Off the line the plane's lines tilt, so they aren't drawn/);
  assert.ok(!app.$('#plane_sw_off svg'));
  // The Swings tab's card: drawn, no button to move the ball.
  assert.match(app.E(`poseSection(session('s_2026-10-01').swings.find(s => s.id === 'sw_in'), session('s_2026-10-01'), { readOnly: true })`), /planeSv/);
  assert.doesNotMatch(app.E(`poseSection(session('s_2026-10-01').swings.find(s => s.id === 'sw_in'), session('s_2026-10-01'), { readOnly: true })`), /planeBall/);
});

test('tap the ball: the sheet checks the camera, the tap is the one thing stored', async () => {
  app.go('range', { sessionId: 's_2026-10-01' });
  // 2.68.0: no ball, no plane section; tapping it is in the card's More… sheet.
  assert.equal(app.$('#plane_sw_noball'), null);
  app.click('#view [data-act="swingMore"][data-wid="sw_noball"]');
  assert.match(app.text('#swingMoreList [data-act="planeBall"]'), /^Tap the ball/);
  app.click('#swingMoreList [data-act="planeBall"]');
  assert.match(app.text('#planeCam'), /^Camera in line\. At address your shoulders overlap \(0% of your torso apart\)/);
  assert.equal(await app.save(), false, 'no tap, nothing saved');
  assert.match(app.toast(), /Tap the ball first/);
  const pick = app.$('#ballPick');
  pick.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 200 });
  pick.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, clientX: 150, clientY: 176 }));
  assert.deepEqual([app.$('#ballDot .pl-pick').style.left, app.$('#ballDot .pl-pick').style.top], ['70%', '78%']);
  assert.equal(await app.save(), true);
  await app.waitFor(async () => (await doc('s_2026-10-01')).swings.find(s => s.id === 'sw_noball').ball, { what: 'saved' });
  const sw = (await doc('s_2026-10-01')).swings.find(s => s.id === 'sw_noball');
  assert.deepEqual(sw.ball, { x: 0.7, y: 0.78 });
  assert.deepEqual(Object.keys(sw).sort(), ['addedOn', 'ball', 'club', 'frames', 'id', 'pose', 'view'], 'no angle, no V, nothing derived');
  await app.waitFor(() => app.$('#plane_sw_noball .planePic'), { what: 'drawn' });
  app.click('#view [data-act="swingMore"][data-wid="sw_noball"]');
  assert.match(app.text('#swingMoreList [data-act="planeBall"]'), /^Move the ball/);
  // An off-the-line clip warns in the sheet before a tap.
  app.click('#view [data-act="swingMore"][data-wid="sw_off"]');
  app.click('#swingMoreList [data-act="planeBall"]');
  assert.match(app.text('#planeCam'), /^Camera off the line\./);
  app.$('#sheetInner [data-close]').click();
});

test('plane faults feed the practice list and the reading\'s prompt', () => {
  const items = app.J('bodyItems().map(x => ({ key: x.key, title: x.title, practice: x.practice }))');
  const dn = items.find(x => x.key === 'body:D:planeDown');
  assert.ok(dn, 'coming down steep on 3 of 3 driver swings');
  assert.equal(dn.title, 'Hands coming down, against the plane · D: outside the guide on 3 of your last 3 down the line swings');
  assert.match(dn.practice, /hip height, inside the V/);
  assert.ok(items.some(x => x.key === 'body:D:handsImpact'));
  assert.ok(!items.some(x => x.key === 'body:D:planeTop'), 'the top was inside the V');
  assert.match(app.E(`poseContext(session('s_2026-10-01').swings.find(s => s.id === 'sw_steep'))`), /Hands coming down, against the plane: \d+° over the shoulder line, steeper than the V \(\d+°; the V is \d+–\d+°\) \(outside a coaching guide/);
});

test('the hands down the line: a wrist hidden behind the other still counts from 0.3 sure, and two that disagree give the surer', () => {
  // 2.65.1: heavy scored his 3 Aug 7i's wrists at address 0.02 and 0.41, both under the 0.5 every other joint needs,
  // so the plane had no hands to start from.
  assert.deepEqual(app.J(`handFrom([0.46, 0.48, 0.02], [0.47, 0.49, 0.41])`), [0.47, 0.49], 'the trail wrist alone at 0.41');
  assert.equal(app.J(`handFrom([0.46, 0.48, 0.29], [0.47, 0.49, 0.2])`), null, 'under 0.3 neither');
  assert.deepEqual(app.J(`handFrom([0.40, 0.40, 0.9], [0.42, 0.42, 0.6])`).map(v => +v.toFixed(3)), [0.41, 0.41], 'together on the grip: the middle');
  assert.deepEqual(app.J(`handFrom([0.30, 0.40, 0.6], [0.42, 0.40, 0.9])`), [0.42, 0.40], '0.12 apart: one is wrong, the surer is taken');
  assert.deepEqual(app.J(`handFrom([0.5, 0.5, 0.9], null, 0.5)`), [0.25, 0.5], "x in the frame's aspect");
  // In the measures: the address hands at 0.41 sure give the plane its shaft line.
  const sw = app.J(`session('s_2026-10-01').swings.find(s => s.id === 'sw_in')`);
  sw.pose.frames[0].j[15][2] = 0.02; sw.pose.frames[0].j[16][2] = 0.41;
  const m = app.J(`poseMeasures(${JSON.stringify(sw)})`);
  assert.ok(m.plane, 'still measurable');
  near(m.plane.shaft, up([0.60, 0.62]), 'the same shaft line from the one wrist');
});
