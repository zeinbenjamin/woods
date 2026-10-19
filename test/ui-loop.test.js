// The practice loop (2.6.0): a finding on the course becomes a planned range
// block, the screenshots fill that plan, and the next round says how it went
// since — one named objective all the way, worked out from the data on every
// draw. Hand-worked scenario, outline-frame shots, dates relative to today.
//
//   range s0, 40 days ago: 5W 12 × 147m, 7i 12 × 110m, PW 12 × 80m (all measured)
//   round rA, 20 days ago, 9 holes of 300m par 4s: D off the tee to 150m out
//     (fairway), 7i from 150m finishing in the rough short (150 − 110 > 15:
//     clubbed short), PW onto the green, 2 putts. 9 approaches, 9 short.
//   With history (second app): range s1 10 days ago, 5W 12 × 152m, planned for
//     'approach'; round rB 5 days ago: 4 holes as rA, 5 holes with the 5W from
//     150m onto the green. Since s1: 4 of 9 short (44%); before: 9 of 9 (100%).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const same = (n, carry, total) => Array.from({ length: n }, () => ({ carry, total }));
const clubs = [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 3 }), club('PW', 'wedge', { order: 5 }), club('P', 'putter', { order: 9 })];
const course = { id: 'c', v: 2, name: 'Loop GC', tee: 'white', holes: card(9) };
const s0 = { id: 's0', v: 2, type: 'range', date: daysAgo(40), venue: 'Barton Park', blocks: [
  { id: 'b0a', seq: 1, club: '5W', swing: 'full', shots: same(12, 147, 165) }, { id: 'b0b', seq: 2, club: '7i', swing: 'full', shots: same(12, 110, 120) },
  { id: 'b0c', seq: 3, club: 'PW', swing: 'full', shots: same(12, 80, 86) }] };
const shortHole = n => ({ n, par: 4, metres: 300, putts: 2, strokes: 5, shots: [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.9, u: 0.6, club: '7i', lie: 'rough' }, { t: 0.98, u: 0, club: 'PW', lie: 'green' }] });
const goodHole = n => ({ n, par: 4, metres: 300, putts: 2, strokes: 4, shots: [{ t: 0.5, u: 0, club: 'D', lie: 'fairway' }, { t: 0.98, u: 0, club: '5W', lie: 'green' }] });
const round = (id, ago, holes) => ({ id, v: 2, type: 'round', date: daysAgo(ago), courseId: 'c', courseName: 'Loop GC', tee: 'white', detail: 'shot_level', holes });
const rA = round('rA', 20, Array.from({ length: 9 }, (_, i) => shortHole(i + 1)));

let app, reply = null;
before(async () => {
  app = await startApp({ seed: { clubs, courses: [course], sessions: [s0, rA] },
    intercept: async url => (url.endsWith('/api/analyse') && reply ? new Response(JSON.stringify({ text: '', json: reply, usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }) : null) });
});
after(() => app && app.stop());
const planned = async () => (await app.api.list('sessions')).filter(s => s.planned);

test('a round says what it showed: the finding by name, how often, the club, the holes, and what to do', () => {
  app.go('rounds', { sessionId: 'rA' });
  const f = app.$$('#roundFindings .finding');
  const approach = f.find(x => /Approaches clubbed short/.test(x.textContent));
  assert.ok(approach, app.text('#roundFindings'));
  assert.match(approach.querySelector('.spread').textContent, /^Approaches clubbed short9 times · 7i$/);
  assert.deepEqual([...approach.querySelectorAll('[data-go]')].filter(b => /Hole/.test(b.textContent)).map(b => b.dataset.go),
    Array.from({ length: 9 }, (_, i) => `rounds:sessionId=rA,hole=${i + 1}`));
  assert.ok(approach.querySelector('[data-act="practiseGoal"][data-key="approach"]'), 'Practise this');
  assert.equal(approach.querySelector('[data-go="range:goal=approach"]').textContent, 'Details →');
  assert.ok(!f.some(x => /off the tee/.test(x.textContent)), 'every tee shot found the fairway: nothing to say');
});

test('Practise this plans that one drill, named for the finding; asking again doesn\'t add it twice', async () => {
  app.click('#roundFindings [data-act="practiseGoal"][data-key="approach"]');
  await app.waitFor(async () => (await planned()).length === 1, { what: 'planned' });
  const [s] = await planned();
  assert.equal(s.focus, 'Practising: Approaches clubbed short');
  assert.deepEqual(s.blocks.map(b => ({ club: b.club, swing: b.swing, target: b.target, goals: b.goals, plan: b.plan })), [{ club: '5W', swing: 'full', target: 150, goals: ['approach'], plan: true }],
    'the measured club for the distance the approaches came up short from');
  await app.waitFor(() => app.$('#sessionGoals'), { what: 'session page' });
  assert.match(app.text('#sessionGoals'), /^0 of 1 planned block hit\. Working on: Approaches clubbed short\./);
  app.go('rounds', { sessionId: 'rA' });
  app.click('#roundFindings [data-act="practiseGoal"][data-key="approach"]');
  await app.waitFor(() => app.toast() === 'Already in your planned session', { what: 'not twice' });
  assert.equal((await planned())[0].blocks.length, 1);
});

test('screenshots for the planned club fill the plan, keeping what it\'s for; another club is added beside it', async () => {
  const [s] = await planned(), planId = s.blocks[0].id;
  reply = { units: 'm', blocks: [{ club: '5W', target: 150, shots: same(6, 145, 160) }, { club: 'PW', target: 80, shots: same(5, 79, 84) }] };
  app.go('range', { sessionId: s.id });
  app.click('#view [data-act="shotsFromImages"]');
  Object.defineProperty(app.field('imgs'), 'files', { value: [new app.win.File(['x'], 'a.png', { type: 'image/png' })] });
  app.$('#sheetInner [data-save]').click();
  await app.waitFor(() => app.$('#sheetInner .readblock'), { what: 'review sheet' });
  assert.equal(await app.save(), true);
  const after = await app.api.get('sessions', s.id);
  assert.equal(after.blocks.length, 2);
  const filled = after.blocks.find(b => b.id === planId);
  assert.ok(filled, 'the planned block itself, not a new one');
  assert.deepEqual([filled.club, filled.goals, filled.plan, filled.shots.length, !!filled.fromImages, filled.reason], ['5W', ['approach'], undefined, 6, true, 'Approaches clubbed short: 9 of 9']);
  assert.equal(after.blocks.find(b => b.id !== planId).club, 'PW');
  await app.waitFor(() => /^Plan done\./.test(app.text('#sessionGoals')), { what: 'plan done' });
  // The finding now knows it was practised, and hasn't been tested on the course since.
  app.go('range', { goal: 'approach' });
  assert.equal(app.text('#view h1'), 'Approaches clubbed short');
  assert.match(app.text('#goalTiles'), /since/);
  assert.match(app.text('#goalTiles'), /not tested yet/);
  assert.match(app.text('#goalRange'), /planned for this/);
  reply = null;
});

test('a block says what it was for, and links back to it', async () => {
  const [s] = await planned(), b = s.blocks.find(x => x.club === '5W');
  app.go('range', { blockId: b.id });
  assert.equal(app.$('#blockGoals [data-go]').dataset.go, 'range:goal=approach');
  assert.match(app.text('#blockGoals'), /Approaches clubbed short →/);
});

test('with a later round: before and since, everywhere the finding appears, without claiming the range did it', async () => {
  const s1 = { id: 's1', v: 2, type: 'range', date: daysAgo(10), venue: 'Barton Park', planned: true, blocks: [
    { id: 'b1', seq: 1, club: '5W', swing: 'full', target: 150, goals: ['approach'], reason: 'Approaches clubbed short: 9 of 9', shots: same(12, 152, 170) }] };
  // Two of rB's tee shots miss the fairway (holes 8 and 9): a tee finding with 2 misses in 18 tee shots.
  const rB = round('rB', 5, [1, 2, 3, 4].map(shortHole).concat([5, 6, 7, 8, 9].map(goodHole)).map(x => x.n >= 8 ? { ...x, shots: [{ ...x.shots[0], lie: 'rough' }, ...x.shots.slice(1)] } : x));
  // And a 5W block between s0 and s1, before the finding first appeared: the one s1 is compared with.
  const sMid = { id: 'sMid', v: 2, type: 'range', date: daysAgo(25), venue: 'Barton Park', blocks: [{ id: 'bm', seq: 1, club: '5W', swing: 'full', shots: same(6, 149, 167) }] };
  const h = await startApp({ seed: { clubs, courses: [course], sessions: [s0, sMid, rA, s1, rB] } });
  try {
    h.go('range', { goal: 'approach' });
    const t = h.$$('#goalTiles .ftile').map(x => [x.querySelector('b').textContent, x.querySelector('small').textContent, x.querySelector('em').textContent]);
    assert.deepEqual(t, [['100%', 'before', '9 of 9 came up short'], ['44%', `since ${h.E(`dateLabel(${JSON.stringify(daysAgo(10))})`)}`, '4 of 9 · emerging']]);
    assert.match(h.text('#view'), /not that the practice caused it/);
    const line = `Since the range on ${h.E(`dateLabel(${JSON.stringify(daysAgo(10))})`)}: 4 of 9 came up short (44%), against 9 of 9 (100%) before · emerging.`;
    h.go('range');
    assert.ok(h.$$('#view .pcard .progress').some(p => p.textContent === line), 'on the Range list');
    h.go('overview');
    assert.ok(h.$$('#view .progress').some(p => p.textContent === line), 'and on the Overview');
    // Where it showed up: both rounds, newest first, by hole and club.
    h.go('range', { goal: 'approach' });
    assert.match(h.text('#goalHoles'), new RegExp(`^${h.E(`dateLabel(${JSON.stringify(daysAgo(5))})`)} · Loop GC: Hole 1 · 7iHole 2 · 7iHole 3 · 7iHole 4 · 7i`));
    // The range block against the last time the 5W was hit.
    h.go('range', { blockId: 'b1' });
    assert.equal(h.text('#blockCompare'), `Against ${h.E(`dateLabel(${JSON.stringify(daysAgo(25))})`)} (6 shots): median carry 149 → 152m, low runners or tops 0% → 0%.`, 'the latest earlier session, not the oldest');
    // rB's findings count only what went wrong: 2 tee shots off the fairway, not all 9 tee shots.
    h.go('rounds', { sessionId: 'rB' });
    const tee = h.$$('#roundFindings .finding').find(x => /D off the tee/.test(x.textContent));
    assert.ok(tee, h.text('#roundFindings'));
    assert.match(tee.querySelector('.spread').textContent, /^D off the tee2 times · D$/);
  } finally { h.stop(); }
});

test('a finding that has gone away says so, rather than showing a blank page', () => {
  app.go('range', { goal: 'tee:D' });
  assert.equal(app.text('#view h1'), 'Not on the list');
});
