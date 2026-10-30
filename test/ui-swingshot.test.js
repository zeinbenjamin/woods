// This swing's own shot (2.56.0): a swing tied to the ball it hit, on the course
// or at the range. Stored as a reference (`swing.shot`); what the shot did is read
// from the shot on every draw, given to the reading, marked "filmed" on the shot,
// and shown on the finding the shot is evidence for. Tags follow their shot when
// an earlier one is deleted, and say so when theirs has gone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const R = 'r_ss', RG = 's_rg';
const fr = pre => Array.from({ length: 4 }, (_, i) => ({ asset: `${pre}${i}`, t: +(0.05 + i * 0.4).toFixed(2) }));
// Hole 1: driver into the trees, 7i to the fairway, PW on, two putts. Hole 2: driver
// down the middle to 150 m out, 7i on, two putts. The rest scores only.
const HOLES = [
  { n: 1, par: 4, metres: 300, shots: [{ t: 0.5, u: 1.3, club: 'D', lie: 'trees' }, { t: 0.85, u: 0, club: '7i', lie: 'fairway' }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], putts: 2, strokes: 5 },
  { n: 2, par: 4, metres: 300, shots: [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.99, u: 0, club: '7i', lie: 'green' }], putts: 2, strokes: 4 },
  { n: 3, par: 3, metres: 140, shots: [{ t: 0.99, u: 0, club: '7i', lie: 'green' }], putts: 2, strokes: 3 },
  ...card(9).slice(3).map(({ n, par, metres }) => ({ n, par, metres, strokes: 4 })),
];
// His five 5W shots of 25 Oct, and a 7i block so the 7i has a range total.
const OCT_5W = [
  { carry: 163.6, total: 175.1, speed: 86.3, carrySide: -6.2, ballSpeed: 122.7, clubPath: -2.1, faceAngle: -4.8 },
  { carry: 168, total: 176.2, speed: 86, carrySide: -4.6, ballSpeed: 123.9, clubPath: -0.4, faceAngle: -2.9 },
  { carry: 164.8, total: 178.2, speed: 84.7, carrySide: 12.1, ballSpeed: 119.2, clubPath: -2.3, faceAngle: 0.8 },
  { carry: 151, total: 175.6, speed: 83.9, carrySide: -1, ballSpeed: 114.5, clubPath: -2.4, faceAngle: -5.5 },
  { carry: 163.1, total: 176.9, speed: 87.5, carrySide: -8.3, ballSpeed: 120.8, clubPath: -2.1, faceAngle: -6.1 },
];
const SEED = {
  clubs: [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 3 }), club('PW', 'wedge', { order: 4 })],
  courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9, { extra: { 3: { par: 3, metres: 140, tees: { white: 140 } } } }) }],
  sessions: [
    { id: R, v: 2, type: 'round', date: '2026-10-20', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes: HOLES, swings: [
      { id: 'sw_d', view: 'face', club: 'D', frames: fr('d'), addedOn: '2026-10-20', analysis: { one_thing: 'Turn through to the target', ball_data: 'agrees' } },
      { id: 'sw_7', view: 'dtl', club: '7i', frames: fr('s'), addedOn: '2026-10-20' }] },
    { id: RG, v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [
      { id: 'b_5w', seq: 1, club: '5W', swing: 'full', shots: OCT_5W },
      { id: 'b_7i', seq: 2, club: '7i', swing: 'full', shots: [[120, 131], [122, 133], [118, 128], [125, 136], [121, 132], [119, 130]].map(([carry, total]) => ({ carry, total })) }],
    swings: [{ id: 'sw_5', view: 'face', club: '5W', frames: fr('f'), addedOn: '2026-10-25' }] },
    { id: 's_none', v: 2, type: 'range', date: '2026-10-26', venue: 'Moore Park', blocks: [], swings: [{ id: 'sw_x', view: 'face', club: '7i', frames: fr('x'), addedOn: '2026-10-26' }] },
  ],
};

let app;
before(async () => { app = await startApp({ seed: SEED }); });
after(() => app && app.stop());

const swing = (sid, wid) => app.J(`session('${sid}').swings.find(w => w.id === '${wid}')`);
const stored = async (sid, wid) => (await app.api.get('sessions', sid)).swings.find(w => w.id === wid);
const pick = async sel => { app.click(sel); await app.waitFor(() => !app.sheetOpen(), { what: 'the tag to save' }); };

test('an untied swing offers the question; a session with no shots does not', () => {
  app.go('rounds', { sessionId: R });
  assert.match(app.text('#ws_sw_d'), /Which shot was this\?/);
  app.go('range', { sessionId: 's_none' });
  assert.ok(app.$('.swing'), 'the swing card is there');
  assert.equal(app.$('#ws_sw_x'), null, 'nothing to tie it to');
});

test('tying a course swing: its club first, the rest folded, the reference stored and the shot described', async () => {
  app.go('rounds', { sessionId: R });
  app.act('tagSwingShot', { sid: R, wid: 'sw_d' });
  const mine = app.$$('#tagShots .choice').map(b => b.textContent);
  assert.equal(mine.length, 2, 'the two driver shots');
  assert.match(mine[0], /^Hole 1, shot 1 \(tee shot\): D from 300 m/);
  assert.match(app.text('#tagOther summary'), /Other clubs · 4/);
  await pick('#tagShots .choice[data-hole="1"][data-i="0"]');
  assert.deepEqual((await stored(R, 'sw_d')).shot, { hole: 1, i: 0 }, 'a reference, nothing derived');
  const len = app.E(`fmt(shotLen(holesOf(session('${R}'))[0], 0))`), left = app.E(`fmt(toGreen(holesOf(session('${R}'))[0], session('${R}').holes[0].shots[0]))`);
  assert.equal(app.text('#ws_sw_d').replace(/\s+/g, ' ').trim(), `This swing's shot: Hole 1, shot 1 (tee shot): D from 300 m, went ${len} m, finished in the trees, ${left} m left. Change`);
  app.go('rounds', { sessionId: R, hole: 1 });
  assert.deepEqual(app.$$('.shotrow').map(b => /filmed/.test(b.textContent)), [true, false, false]);
});

test('the reading is given its own shot first, with the range total beside a course shot', async () => {
  const untied = app.E(`swingPrompt(session('${R}').swings.find(w => w.id === 'sw_7'), session('${R}'))`);
  assert.doesNotMatch(untied, /THIS SWING'S OWN SHOT/);
  assert.match(untied, /would produce the strike mix above\./);
  app.act('tagSwingShot', { sid: R, wid: 'sw_7' });
  assert.match(app.text('#tagShots .choice[data-hole="3"]'), /^Hole 3, shot 1 \(approach\): 7i from 140 m/, 'a par 3 is played with an approach');
  await pick('#tagShots .choice[data-hole="2"][data-i="1"]');
  const p = app.E(`swingPrompt(session('${R}').swings.find(w => w.id === 'sw_7'), session('${R}'))`);
  const tot = app.E(`fmt(totalRef('7i').v)`);
  assert.match(p, new RegExp(`THIS SWING'S OWN SHOT \\(measured: the ball these frames hit\\): Hole 2, shot 2 \\(approach\\): 7i from 150 m, went \\d+ m, finished on the green\\. His range stock total for the 7i is ${tot} m\\.`));
  assert.match(p, /would produce this swing's own shot first, and the strike mix above second\./);
});

test('a tag follows its shot when an earlier one goes, and goes with its own shot', async () => {
  // Tie the 7i swing to hole 1's second shot, then delete hole 1's first shot.
  app.act('tagSwingShot', { sid: R, wid: 'sw_7' });
  await pick('#tagShots .choice[data-hole="1"][data-i="1"]');
  app.go('rounds', { sessionId: R, hole: 1 });
  app.act('removeShot', { sid: R, n: 1, i: 0 });
  await app.answer(true);
  await app.waitFor(() => app.J(`session('${R}').holes[0].shots.length`) === 2, { what: 'the shot deleted' });
  assert.deepEqual((await stored(R, 'sw_7')).shot, { hole: 1, i: 0 }, 'moved down with its shot');
  assert.equal((await stored(R, 'sw_d')).shot, undefined, 'its shot was deleted, so the tag went');
  app.go('rounds', { sessionId: R });
  assert.match(app.text('#ws_sw_d'), /Which shot was this\?/);
  // Changing a shot's club in place keeps the tag, and says the two disagree.
  await app.E(`updateHole(session('${R}'), 1, h => { h.shots = h.shots.map((x, j) => j === 0 ? { ...x, club: '5W' } : x); })`);
  assert.deepEqual((await stored(R, 'sw_7')).shot, { hole: 1, i: 0 });
  app.go('rounds', { sessionId: R });
  assert.match(app.text('#ws_sw_7'), /The shot is logged as 5W, the swing as 7i\./);
  // Undo removes the last shot of the hole: a tag on it goes.
  await app.E(`updateHole(session('${R}'), 1, h => { h.shots = h.shots.slice(0, 1); })`);
  assert.deepEqual((await stored(R, 'sw_7')).shot, { hole: 1, i: 0 }, 'not the last shot');
  await app.E(`updateHole(session('${R}'), 1, h => { h.shots = []; })`);
  assert.equal((await stored(R, 'sw_7')).shot, undefined, 'hole cleared');
});

test('a range swing: the bay\'s numbers for that ball, the shot table marked, found again by carry and total', async () => {
  app.go('range', { sessionId: RG });
  app.act('tagSwingShot', { sid: RG, wid: 'sw_5' });
  assert.equal(app.$$('#tagShots .choice').length, 5, 'the 5W shots first');
  assert.match(app.text('#tagOther summary'), /Other clubs · 6/);
  await pick('#tagShots .choice[data-block="b_5w"][data-i="2"]');
  assert.deepEqual((await stored(RG, 'sw_5')).shot, { block: 'b_5w', i: 2, carry: 164.8, total: 178.2 });
  const prof = app.E(`swingShot(session('${RG}').swings[0], session('${RG}')).prof`);
  assert.ok(['pure', 'runner', 'short'].includes(prof));
  const word = { pure: 'a pure strike', runner: 'a low runner', short: 'short of a pure strike' }[prof];
  assert.equal(app.text('#ws_sw_5').replace(/\s+/g, ' ').trim(), `This swing's shot: Shot 3 of 5 in the 5W block: carry 164.8 m, total 178.2 m, 12.1 m right; face 0.8° right, path 2.3° left; smash ${(119.2 / 84.7).toFixed(2)}; ${word}. Change`);
  app.go('range', { blockId: 'b_5w' });
  assert.deepEqual(app.$$('#shotTable tbody tr').map(tr => /filmed/.test(tr.textContent)), [false, false, true, false, false]);
  // The block re-pasted in another order: the same ball is found by carry and total; nothing rewritten.
  const s = app.J(`session('${RG}')`);
  const shots = [OCT_5W[2], OCT_5W[0], OCT_5W[1], OCT_5W[3], OCT_5W[4]];
  await app.E(`save('sessions', '${RG}', ${JSON.stringify({ ...s, blocks: s.blocks.map(b => b.id === 'b_5w' ? { ...b, shots } : b) })})`);
  assert.equal(app.J(`swingShot(session('${RG}').swings[0], session('${RG}')).i`), 0);
  assert.deepEqual((await stored(RG, 'sw_5')).shot, { block: 'b_5w', i: 2, carry: 164.8, total: 178.2 }, 'the stored tag is untouched');
  // That ball removed from the block: said, never guessed.
  const s2 = app.J(`session('${RG}')`);
  await app.E(`save('sessions', '${RG}', ${JSON.stringify({ ...s2, blocks: s2.blocks.map(b => b.id === 'b_5w' ? { ...b, shots: shots.slice(1) } : b) })})`);
  app.go('range', { sessionId: RG });
  assert.match(app.text('#ws_sw_5'), /The shot this swing was tied to is no longer in this session\. Tie it again/);
  // And untied on request.
  app.act('tagSwingShot', { sid: RG, wid: 'sw_5' });
  await pick('#sheetInner [data-clear="1"]');
  assert.equal((await stored(RG, 'sw_5')).shot, undefined);
});

test('the finding a filmed shot is evidence for shows it; the timeline and the card say which shot', async () => {
  // Hole 2's tee shot was a driver down the fairway: a miss is needed for the D tee finding.
  await app.E(`updateHole(session('${R}'), 2, h => { h.shots = h.shots.map((x, j) => j === 0 ? { ...x, lie: 'rough' } : x); })`);
  app.act('tagSwingShot', { sid: R, wid: 'sw_d' });
  await pick('#tagShots .choice[data-hole="2"][data-i="0"]');
  app.go('range', { goal: 'tee:D' });
  assert.equal(app.$$('#goalFilmed .item').length, 1);
  assert.match(app.text('#goalFilmed'), /Hole 2, shot 1 \(tee shot\): D from 300 m.*finished in the rough.*Turn through to the target/);
  // A fairway tee shot isn't evidence for the tee finding.
  await app.E(`updateHole(session('${R}'), 2, h => { h.shots = h.shots.map((x, j) => j === 0 ? { ...x, lie: 'fairway' } : x); })`);
  await app.E(`updateHole(session('${R}'), 1, h => { h.shots = [{ t: 0.5, u: 1.3, club: 'D', lie: 'trees' }]; })`);
  app.go('range', { goal: 'tee:D' });
  assert.equal(app.$('#goalFilmed'), null);
  app.go('swings');
  const row = app.$$('.swrow').find(b => b.dataset.wid === 'sw_d');
  assert.match(row.textContent, /Test GC · hole 2, tee shot/);
  app.act('reelCard', { sid: R, wid: 'sw_d' });
  assert.match(app.text('#reelShot'), /This swing's shot: Hole 2, shot 1 \(tee shot\)/);
});
