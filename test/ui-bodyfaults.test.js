// The body, measured, into the practice list (2.62.0, he asked). A measure outside its guide on most of a
// club's recent swings from one angle is a finding; beside a ball-data finding for the same club it is support,
// on its own it is listed with the rules-of-thumb caveat. Worked with hand-made down-the-line joints whose
// hips move toward the ball at impact (outside the guide), and ones that don't.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

const blank = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0.1]);
const joints = pts => { const j = blank(); for (const [i, x, y] of pts) j[i] = [x, y, 0.99]; return j; };
const ADDR = [[0, 0.62, 0.30], [11, 0.555, 0.355], [12, 0.555, 0.355], [15, 0.60, 0.62], [16, 0.60, 0.62], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const TOP = [[0, 0.61, 0.30], [11, 0.54, 0.36], [12, 0.54, 0.36], [15, 0.42, 0.22], [16, 0.42, 0.22], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const FIN = [[0, 0.52, 0.28], [11, 0.50, 0.33], [12, 0.50, 0.33], [15, 0.40, 0.18], [16, 0.40, 0.18], [23, 0.47, 0.58], [24, 0.47, 0.58]];
// Impact: hips 0.03 toward the ball (7% of the torso: outside the -15..5 guide), or where they started (inside).
const IMP_OUT = [[0, 0.61, 0.29], [11, 0.555, 0.34], [12, 0.555, 0.34], [15, 0.62, 0.64], [16, 0.62, 0.64], [23, 0.485, 0.60], [24, 0.485, 0.60]];
const IMP_IN = [[0, 0.62, 0.30], [11, 0.555, 0.355], [12, 0.555, 0.355], [15, 0.62, 0.64], [16, 0.62, 0.64], [23, 0.455, 0.60], [24, 0.455, 0.60]];
function frames16(imp) {
  const k = [[0, ADDR], [7, TOP], [11, imp], [15, FIN]], out = [];
  for (let f = 0; f < 16; f++) {
    let s = 0; while (s < 3 && f > k[s + 1][0]) s++;
    const [fa, A] = k[s], [fb, B] = k[Math.min(3, s + 1)], t = fb === fa ? 0 : (f - fa) / (fb - fa), ja = joints(A), jb = joints(B);
    out.push(ja.map((p, i) => [p[0] + (jb[i][0] - p[0]) * t, p[1] + (jb[i][1] - p[1]) * t, ja[i][2]]));
  }
  return out;
}
let seq = 0;
const swing = (clubCode, out, { hidden = false } = {}) => {
  const id = `sw${++seq}`, J = frames16(out ? IMP_OUT : IMP_IN);
  const frames = J.map((_, i) => ({ asset: `${id}f${i}`, t: +(0.05 + i * 0.1).toFixed(2) }));
  return { id, view: 'dtl', club: clubCode, frames, addedOn: '2026-10-01',
    pose: { by: 'test', on: '2026-10-01', aspect: 0.5625, frames: J.map((j, i) => ({ asset: `${id}f${i}`, t: frames[i].t, j: hidden && i % 2 ? null : j })) } };
};
const rangeDay = (date, swings) => ({ id: `s_${date}`, v: 2, type: 'range', date, venue: 'Test range', blocks: [], swings });

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 4 })],
    sessions: [
      // Driver: outside on all three of its swings (a finding), and in the bag with no range data (its "measure" item hosts it).
      rangeDay('2026-10-01', [swing('D', true), swing('7i', true), swing('3W', true), swing('5W', true)]),
      rangeDay('2026-10-08', [swing('D', true), swing('7i', false), swing('3W', true), swing('5W', false)]),
      rangeDay('2026-10-15', [swing('D', true), swing('7i', false), swing('3W', true), swing('3W', true, { hidden: true }), swing('5W', true)]),
      rangeDay('2026-10-22', [swing('5W', true)]),
    ] } });
  await app.waitFor(() => app.E('S.sessions.length') === 4, { what: 'seeded' });
});
after(() => app && app.stop());

test('outside the guide on most recent swings is a finding; one swing outside of three is not', () => {
  const items = app.J('bodyItems().map(x => ({ key: x.key, title: x.title, ev: x.ev.length, chances: x.chances.map(c => c.hit), n: x.n }))');
  const d = items.find(x => x.key === 'body:D:extImpact');
  assert.ok(d, 'the driver: hips toward the ball on 3 of 3');
  assert.equal(d.title, 'Hips toward the ball at impact · D: outside the guide on 3 of your last 3 down the line swings');
  assert.deepEqual([d.ev, d.chances, d.n], [3, [true, true, true], 3]);
  assert.ok(!items.some(x => x.key === 'body:7i:extImpact'), 'the 7i: outside on 1 of 3, not a finding');
  // The 3W's half-hidden swing is too few frames to rely on, so its three good swings are the ones counted.
  const w = items.find(x => x.key === 'body:3W:extImpact');
  assert.ok(w && w.n === 3 && w.ev === 3, 'an unreliable swing never counts');
  // The 5W: outside on 3 of 4 (at least 3, at least half), every swing a chance, the one inside too.
  const f = items.find(x => x.key === 'body:5W:extImpact');
  assert.deepEqual([f.title, f.chances, f.ev], ['Hips toward the ball at impact · 5W: outside the guide on 3 of your last 4 down the line swings', [true, false, true, true], 3]);
});

test('beside a ball-data finding for the same club it joins as support; with none it is listed on its own', () => {
  const r = app.J(`(() => { const r = rankedPractice(); return { now: r.now.map(x => ({ key: x.key, kind: x.kind, w: x.weight, sup: (x.support || []).map(y => y.key) })) }; })()`);
  const host = r.now.find(x => x.sup.includes('body:D:extImpact'));
  assert.ok(host && host.key === 'measure:D', 'the driver\'s measure item hosts it');
  assert.ok(!r.now.some(x => x.key === 'body:D:extImpact'), 'not listed twice');
  // half its weight added to the host
  const alone = app.E(`assessPractice(practiceItems().find(x => x.key === 'measure:D')).weight`);
  const body = app.E(`assessPractice(practiceItems().find(x => x.key === 'body:D:extImpact')).weight`);
  assert.ok(Math.abs(host.w - (alone + body / 2)) < 1e-9);
  // The 3W isn't in the bag: no ball finding to join, so it stands alone, below the measured items.
  const w = r.now.find(x => x.key === 'body:3W:extImpact');
  assert.ok(w && w.kind === 'body');
  // On the Range list: the host's card says so, the lone one carries the caveat.
  app.go('range');
  const open = app.$('#moreList'); if (open) open.open = true;
  const hostCard = [...app.$$('#view .pcard')].find(c => /Measure your D|D/.test(c.textContent) && c.querySelector('.bodysup'));
  assert.ok(hostCard, 'a card with the body line');
  assert.match(hostCard.querySelector('.bodysup').textContent, /^body, measured Hips toward the ball at impact outside the guide on 3 of your last 3 down the line D swings$/);
  const lone = [...app.$$('#view .pcard.k-body')].find(c => /3W/.test(c.textContent));
  assert.ok(lone, 'the lone finding has its own card');
  assert.match(lone.textContent, /Body, measured[\s\S]*body, measured[\s\S]*Hips toward the ball at impact · 3W[\s\S]*Bum on a wall[\s\S]*2D, from the frames; the guides are rules of thumb\./);
  assert.match(app.text('#rankRules'), /a swing whose body measure is outside its guide 0\.15, a finding once it is outside on 3 of the last 5 swings of a club from one angle/);
});

test('a finding\'s page lists the body support with each swing; nothing derived is stored', async () => {
  app.go('range', { goal: 'measure:D' });
  assert.match(app.text('#goalEvidence'), /body, measured Hips toward the ball at impact outside the guide on 3 of your last 3 down the line D swings[\s\S]*15 Oct 2026: 7% of torso length toward the ball \(early extension when toward\) \(outside\)[\s\S]*1 Oct 2026[\s\S]*2D, from the frames, against rules of thumb\./);
  const docs = JSON.stringify(app.J('S.sessions'));
  assert.ok(!/body:|outside the guide/.test(docs), 'nothing about the finding lands on the documents');
});
