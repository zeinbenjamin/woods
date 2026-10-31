// Face, path and strike (2.53.0): what the bay measured at impact, read as it
// reported it. Which one the miss follows (a correlation with where the shots
// finished), and smash factor against his own pure strikes. Derived on every
// draw, nothing stored. The 5W block is his five Trackman shots of 25 Oct.
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
const SEED = {
  clubs: [club('5W', 'wood', { name: '5 Wood', order: 2 }), club('7i', 'iron', { name: '7 Iron', order: 3 })],
  sessions: [
    { id: 's_oct', v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [
      { id: 'b_5w', seq: 1, club: '5W', swing: 'full', shots: OCT_5W },
      // His 7i screen of the same day, first three rows (the third had no club data).
      { id: 'b_7i', seq: 2, club: '7i', swing: 'full', shots: [
        { carry: 113.4, total: 120.7, speed: 73.6, ballSpeed: 96.5, clubPath: 0.7, faceAngle: -1.3, carrySide: -0.5 },
        { carry: 134.4, total: 137.6, speed: 77.8, ballSpeed: 107.5, clubPath: 0.2, faceAngle: 0.3, carrySide: 3.2 },
        { carry: 54.8, total: 85.3, ballSpeed: 70, carrySide: -4.2 }] }] },
    { id: 's_plain', v: 2, type: 'range', date: '2026-10-20', venue: 'Moore Park', blocks: [
      { id: 'b_plain', seq: 1, club: '7i', swing: 'full', shots: [{ carry: 110, total: 131 }, { carry: 112, total: 133 }] }] },
  ],
};

let app;
before(async () => { app = await startApp({ seed: SEED }); });
after(() => app && app.stop());

const del = shots => app.J(`delivery(${JSON.stringify(shots)})`);
const lines = d => app.J(`deliveryLines(${JSON.stringify(d)})`);
const near = (a, b, d = 1e-9, what = '') => assert.ok(Math.abs(a - b) < d, `${what} ${a} vs ${b}`);
const mean = a => a.reduce((x, y) => x + y) / a.length;
function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  const c = xs.reduce((t, x, i) => t + (x - mx) * (ys[i] - my), 0);
  return c / Math.sqrt(xs.reduce((t, x) => t + (x - mx) ** 2, 0) * ys.reduce((t, y) => t + (y - my) ** 2, 0));
}

test('his five 5W shots by hand: face, path, face to path, the ranges, and which one the finish followed', () => {
  const d = del(OCT_5W.map(s => ({ ...s, prof: 'pure' })));
  assert.equal(d.enough, true);
  near(d.face, -3.7, 1e-9, 'face'); near(d.path, -1.86, 1e-9, 'path'); near(d.f2p, -1.84, 1e-9, 'face to path');
  assert.deepEqual([d.faceRange, d.pathRange], [[-6.1, 0.8], [-2.4, -0.4]]);
  const rf = pearson(OCT_5W.map(s => s.faceAngle), OCT_5W.map(s => s.carrySide)), rp = pearson(OCT_5W.map(s => s.clubPath), OCT_5W.map(s => s.carrySide));
  near(d.follows.face, rf, 1e-9, 'r face'); near(d.follows.path, rp, 1e-9, 'r path');
  near(d.smash, mean(OCT_5W.map(s => s.ballSpeed / s.speed)), 1e-9, 'smash');
  const L = lines(d);
  assert.equal(L[0], 'Face 3.7° closed and path 1.9° out-to-in on average, so the face was 1.8° closed to the path (curving the ball left).');
  assert.equal(L[1], 'Shot to shot the face ranged 6.1° closed to 0.8° open, the path 2.4° out-to-in to 0.4° out-to-in: the face moved more.');
  assert.match(L[2], new RegExp(`^Where they finished followed the face closely \\(r ${rf.toFixed(2)}\\) and the path (hardly|partly) \\(r ${rp.toFixed(2).replace('-', '\\-')}\\), over 5 shots\\.$`));
  assert.equal(L[3], 'Smash 1.40 on average (ball speed ÷ club speed).');
});

test('smash against his own pure strikes: low runners losing ball speed, or not', () => {
  const sh = (bs, cs, prof) => ({ carry: 100, total: 110, ballSpeed: bs, speed: cs, prof });
  const lose = del([sh(140, 100, 'pure'), sh(142, 100, 'pure'), sh(130, 100, 'runner'), sh(132, 100, 'runner'), sh(136, 100, 'short')]);
  assert.deepEqual([lose.smashBy.pure, lose.smashBy.runner].map(v => +v.toFixed(3)), [1.41, 1.31]);
  assert.match(lines(lose).pop(), /1\.31 on low runners against 1\.41 on pure strikes \(2 and 2 shots\), so the runners lose ball speed: struck off the middle, not just launched low\./);
  const same = del([sh(140, 100, 'pure'), sh(141, 100, 'pure'), sh(140, 100, 'runner'), sh(140.5, 100, 'runner'), sh(136, 100, 'short')]);
  assert.match(lines(same).pop(), /about the same strike\.$/);
  // Without both kinds twice, just the average; without club speed, no smash at all.
  assert.equal(del([sh(140, 100, 'pure'), sh(140, 100, 'pure'), sh(140, 100, 'pure'), sh(140, 100, 'pure'), sh(130, 100, 'runner')]).smashBy, undefined);
  assert.equal(del([{ carry: 1, total: 2, ballSpeed: 100 }]).smash, undefined);
});

test('under five shots with face and path: what is there, and how many more', () => {
  const d = del(OCT_5W.slice(0, 3).map(s => ({ ...s, prof: 'pure' })));
  assert.equal(d.enough, false); assert.equal(d.face, undefined);
  app.go('range', { blockId: 'b_7i' });
  assert.match(app.text('#blockDeliveryLines'), /^2 of the 5 shots with face and path this needs\./);
  assert.equal(app.$$('#blockDelivery .dp-pt').length, 2);
  assert.equal(app.$$('#blockDelivery .ftile').length, 0);
});

test('the block page: path against face, dots coloured by where they finished, the tiles and the sentences', () => {
  app.go('range', { blockId: 'b_5w' });
  const sec = app.$('#blockDelivery');
  assert.ok(sec);
  assert.equal(app.$$('#blockDelivery .dp-pt').length, 5);
  assert.equal(app.$$('#blockDelivery .dp-pt.l').length, 4); assert.equal(app.$$('#blockDelivery .dp-pt.r').length, 1);
  assert.deepEqual(app.$$('#blockDelivery .ftile b').map(b => b.textContent), ['3.7°', '1.9°', '1.40']);
  assert.match(app.text('#blockDelivery .tiles'), /face closed.*path out-to-in/s);
  assert.match(app.text('#blockDelivery svg'), /path · out-to-in ← → in-to-out.*face · closed ← → open/s);
  assert.match(app.text('#blockDeliveryLines'), /face was 1\.8° closed to the path/);
  assert.match(app.text('#blockDelivery'), /A correlation shows what moved together, not what caused it/);
  const order = [...app.$('#view').querySelectorAll('#blockPattern, #blockDelivery, #shotTable')].map(e => e.id);
  assert.deepEqual(order, ['blockPattern', 'blockDelivery', 'shotTable']);
  app.go('range', { blockId: 'b_plain' });
  assert.equal(app.$('#blockDelivery'), null, 'nothing measured, nothing shown');
});

test('the Overview fold: a row per club measured, and which one each follows', () => {
  app.go('overview');
  const f = app.$('#ovDelivery');
  assert.ok(f && !f.open);
  assert.match(app.text('#ovDelivery summary'), /Face, path and strike.*5W follows the face/);
  assert.deepEqual(app.$$('#deliveryTable tbody tr').map(tr => [...tr.children].map(td => td.textContent)),
    [['5W', '3.7° closed', '1.9° out-to-in', 'left', 'face', '1.40']]);
  // 2.58.0: no per-club paragraphs on the Overview; clubs short of data in one line.
  assert.equal(app.text('#deliveryFew'), 'Not enough shots with face and path yet: 7i (2 of 5).');
  assert.doesNotMatch(app.text('#ovDelivery'), /Shot to shot|Where they finished followed/);
});

test('a swing reading is given the measured face and path for its club', () => {
  const ctx = app.E(`ballContextFor('5W')`);
  assert.match(ctx, /Measured at impact by the bay over 5 shots \(a right-hander; face to the target, path in-to-out or out-to-in\): Face 3\.7° closed and path 1\.9° out-to-in/);
  assert.doesNotMatch(app.E(`ballContextFor('7i')`), /Measured at impact/, 'not from two shots');
});

test('nothing derived is stored', async () => {
  app.go('overview'); app.go('range', { blockId: 'b_5w' });
  for (const s of SEED.sessions) assert.deepEqual(JSON.parse(JSON.stringify(await app.api.get('sessions', s.id))), JSON.parse(JSON.stringify(s)));
});
