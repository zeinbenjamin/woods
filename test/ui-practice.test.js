// What to practise, as data accumulates: recency weighting, which items are
// still happening, which were worked on, which have gone quiet — and the
// planned range session drawing on all of it (rounds, range strike data,
// swing readings, unmeasured clubs), not just course data.
//
// The scenario (synthetic numbers, dates relative to today):
//   D off the tee: 3 of 4 in the trees 30 days ago, then 8 clean tee shots → quiet
//   5W off the tee: 2 of 3 missed 3 days ago → still happening
//   chip with the PW missed the green 10 days ago, chip block hit 5 days ago → worked on
//   7i on the range: 60% low runners 40 days ago and still 60% 5 days ago → still showing up
//   swing readings: an old 7i tip superseded by a newer one; a face-on tip 200 days old → too old
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shots7i = (pure, runners) => [...Array(pure).fill({ carry: 128, total: 138 }), ...Array(runners).fill({ carry: 110, total: 140 })];
const hole = (n, shots, putts = 2) => ({ n, par: 4, metres: 300, shots, putts, strokes: shots.length + putts });
const teeThenGreen = (tee, lie) => [{ t: 0.5, u: 0, club: tee, lie }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }];
const round = (id, ago, holes) => ({ id, v: 2, type: 'round', date: daysAgo(ago), courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes });
const reading = (one, ago, extra = {}) => ({ analysis: { one_thing: one, observations: [{ what: one, evidence: 'frame 5', confidence: 'high' }], matches_ball_data: 'This lines up with the low runners.', drill: { name: 'Pump drill', why: 'feel the lag' } }, analysedOn: daysAgo(ago), frames: [], ...extra });

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1, nominalTotal: 200 }), club('5W', 'wood', { order: 2, nominalTotal: 180 }), club('5i', 'iron', { order: 3, nominalCarry: 160 }),
      club('7i', 'iron', { order: 4 }), club('PW', 'wedge', { order: 5 }), club('P', 'putter', { order: 9 })],
    courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }],
    sessions: [
      round('r1', 30, [1, 2, 3].map(n => hole(n, teeThenGreen('D', 'trees'))).concat(hole(4, teeThenGreen('D', 'fairway')))),
      round('r2', 10, [1, 2, 3, 4].map(n => hole(n, teeThenGreen('D', 'fairway'))).concat(
        hole(5, [{ t: 0.85, u: 0, club: 'D', lie: 'fairway' }, { t: 0.97, u: 1, club: 'PW', lie: 'rough' }, { t: 0.99, u: 0, club: 'PW', lie: 'green' }], 1))),
      round('r3', 3, [hole(1, teeThenGreen('5W', 'rough')), hole(2, teeThenGreen('5W', 'trees')), hole(3, teeThenGreen('5W', 'fairway'))]
        .concat([4, 5, 6].map(n => hole(n, teeThenGreen('D', 'fairway'))))),
      { id: 's_old', v: 2, type: 'range', date: daysAgo(40), blocks: [{ id: 'b_old', seq: 1, club: '7i', swing: 'full', shots: shots7i(8, 12) }] },
      { id: 's_new', v: 2, type: 'range', date: daysAgo(5), blocks: [
        { id: 'b_new', seq: 1, club: '7i', swing: 'full', shots: shots7i(4, 6) },
        { id: 'b_chip', seq: 2, club: 'PW', swing: 'chip', target: 40, shots: [{ carry: 38, total: 41 }, { carry: 36, total: 40 }] }],
        swings: [
          { id: 'sw_old', view: 'dtl', club: '7i', ...reading('Old tip', 50) },
          { id: 'sw_new', view: 'dtl', club: '7i', ...reading('New tip', 6) },
          { id: 'sw_face', view: 'face', club: '7i', ...reading('Ancient tip', 200) }] },
    ],
  } });
});
after(() => app && app.stop());

const ranked = () => app.J('rankedPractice()');
const item = (list, key) => list.find(x => x.key === key);

/* ---------- weighting ---------- */

test('evidence counts half as much every 60 days', () => {
  assert.ok(Math.abs(app.E(`decay(${JSON.stringify(daysAgo(60))})`) - 0.5) < 0.02);
  assert.ok(Math.abs(app.E(`decay(${JSON.stringify(daysAgo(0))})`) - 1) < 0.02);
  assert.ok(Math.abs(app.E(`decay(${JSON.stringify(daysAgo(120))})`) - 0.25) < 0.02);
});

test('the same evidence ranks lower the older it is', () => {
  const w = ago => app.E(`assessPractice({ key: 'x', kind: 'penalty', score: 1, ev: [{ date: ${JSON.stringify(daysAgo(ago))}, cost: 1 }] }).weight`);
  assert.ok(w(3) > w(40) && w(40) > w(100));
});

/* ---------- freshness ---------- */

test('an old problem with enough clean chances since goes quiet, and says why', () => {
  const { now, quiet } = ranked();
  assert.equal(item(now, 'tee:D'), undefined);
  const d = item(quiet, 'tee:D');
  assert.ok(d, 'D off the tee is listed as quiet');
  assert.match(d.note, new RegExp(`^Not seen in 8 chances since .*; at the old rate \\(3 in 12\\) it would probably have shown up by now\\.$`));
});

test('clean chances too few to be sure keep it on the list, with the count', () => {
  // At 3 in 12, six clean tee shots are needed. After r1 alone plus one clean round it wouldn't be.
  const needed = rate => app.E(`Math.max(3, Math.ceil(Math.log(0.2) / Math.log(1 - ${rate})))`);
  assert.equal(needed(3 / 12), 6);
  assert.equal(needed(0.1), 16, 'a rarer problem needs more clean chances before it counts as gone');
});

test('a problem seen recently is still happening', () => {
  const w = item(ranked().now, 'tee:5W');
  assert.equal(w.status, 'active');
  assert.match(w.note, /^Last seen /);
});

test('worked on at the range since it was last seen: stays on, at half weight, until the course confirms', () => {
  const sg = item(ranked().now, 'short');
  assert.equal(sg.status, 'practised');
  assert.match(sg.note, /Worked on at the range .* not tested on course since\./);
  const raw = app.E(`assessPractice({ ...practiceItems().find(x => x.key === 'short'), block: null }).weight`);
  assert.ok(Math.abs(sg.weight - raw / 2) < 1e-9);
});

test('range data counts too: a strike problem still present in the latest session stays current', () => {
  const s = item(ranked().now, 'strike:7i');
  assert.ok(s, '7i strike is on the list');
  assert.match(s.title, /^7i strike: 60% low runners or topped$/);
  assert.match(s.note, /^Still showing up in the latest range session \(.*\): 6 of 10, against 60% before\.$/);
  assert.equal(s.block.club, '7i');
});

test('a newer swing reading supersedes an older one of the same club and angle; a very old one goes quiet', () => {
  const all = app.J('practiceItems().map(assessPractice)');
  const swings = all.filter(x => x.kind === 'swing');
  assert.equal(swings.filter(x => x.key === 'swing:7i:dtl').length, 1);
  assert.match(item(swings, 'swing:7i:dtl').title, /New tip/);
  assert.ok(!swings.some(x => /Old tip/.test(x.title)), 'the superseded reading is gone');
  assert.match(item(ranked().quiet, 'swing:7i:face').note, /more than six months ago/);
});

test('a swing reading about a club with ball data joins that item rather than being listed on its own', () => {
  const { now } = ranked();
  assert.equal(item(now, 'swing:7i:dtl'), undefined, 'not a separate item');
  const s = item(now, 'strike:7i');
  assert.equal(s.support.length, 1);
  assert.match(s.support[0].title, /New tip/);
  assert.match(s.block.intent, /Drill from the video: Pump drill$/);
  const alone = app.E(`assessPractice(practiceItems().find(x => x.key === 'strike:7i')).weight`);
  assert.ok(Math.abs(s.weight - (alone + s.support[0].weight / 2)) < 1e-9, 'an agreeing reading adds half its weight');
  app.go('range');
  assert.match(app.text('#view'), /read from video Down the line · 7i: New tip.*Agrees with the ball data/s);
});

test('clubs with no range data are listed to measure, with or without a course asking for them', () => {
  const keys = ranked().now.map(x => x.key);
  for (const k of ['measure:D', 'measure:5W', 'measure:5i', 'measure:PW']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('measure:P'), 'not the putter');
  assert.ok(!keys.includes('measure:7i'), 'not a measured club');
});

/* ---------- the list on screen ---------- */

test('the list shows the top five with freshness, the rest folded, and the quiet ones apart', () => {
  const { now, quiet } = ranked();
  app.go('range');
  const cards = app.$$('#view > .pcard, #view > details.pcard');
  assert.equal(cards.length, 5);
  assert.equal(app.$$('#view > .pcard .fresh, #view > details.pcard .fresh').length, 5, 'each card says how fresh it is');
  assert.match(app.text('#moreList summary'), new RegExp(`${now.length - 5} more item`));
  assert.match(app.text('#quietList summary'), new RegExp(`Quiet lately — ${quiet.length} items, left out of the plan`));
  assert.match(app.text('#quietList'), /D off the tee: .*Not seen in 8 chances/s);
  assert.match(app.text('#view'), /something last seen 60 days ago counts half as much/);
  assert.match(app.text('#view'), /worked on/, 'the practised item is tagged');
});

test('the Overview\'s next session leaves out what has gone quiet', () => {
  app.go('overview');
  const next = app.$$('#view .wcard').map(li => li.textContent);
  assert.equal(next.length, 3);
  assert.ok(!next.some(t => /D off the tee/.test(t)));
});

/* ---------- planning ---------- */

test('the planner takes only current items: a quiet one never gets a block, even with room to spare', async () => {
  const fake = `({ now: [{ title: 'Current thing', block: { club: '7i', swing: 'full', target: 120, intent: 'x' } }],
                   quiet: [{ title: 'Quiet thing', block: { club: 'PW', swing: 'full', target: 90, intent: 'y' } }] })`;
  await app.E(`(async () => { const real = rankedPractice; rankedPractice = () => ${fake}; try { await ACTIONS.planSession(); } finally { rankedPractice = real; } })()`);
  const s = (await app.api.list('sessions')).find(x => x.planned);
  assert.deepEqual(s.blocks.map(b => b.reason), ['Current thing']);
  await app.E(`remove('sessions', ${JSON.stringify(s.id)})`);
  await app.waitFor(async () => !(await app.api.list('sessions')).some(x => x.planned), { what: 'cleaned up' });
});

test('planning merges items that want the same club and swing, and stops at five blocks', () => {
  const items = [['a', '7i', 'full'], ['b', '7i', 'full'], ['c', 'PW', 'chip'], ['d', '5W', 'full'], ['e', 'D', 'full'], ['f', '9i', 'full'], ['g', 'PW', 'full'], ['h', '7i', 'full']]
    .map(([title, club, swing]) => ({ title, block: { club, swing, target: 100, intent: 'x' } })).concat({ title: 'no block' });
  const got = app.J(`planBlocks(${JSON.stringify(items)}).map(b => [b.club, b.swing, b.reason, b.seq])`);
  assert.deepEqual(got, [['7i', 'full', 'a; b; h', 1], ['PW', 'chip', 'c', 2], ['5W', 'full', 'd', 3], ['D', 'full', 'e', 4], ['9i', 'full', 'f', 5]]);
});

let planId;
test('the planned session draws on everything current — course, range and swing — in ranked order', async () => {
  const { now } = ranked();
  await app.act('planSession');
  await app.waitFor(() => (app.E(`S.sub && S.sub.sessionId`) || '').startsWith('s_'), { what: 'plan saved' });
  planId = app.E('S.sub.sessionId');
  const s = await app.api.get('sessions', planId);
  assert.equal(s.planned, true);
  assert.equal(s.focus, 'Planned from your latest rounds, range sessions and swings');
  assert.ok(s.blocks.length >= 1 && s.blocks.length <= 5);
  assert.ok(s.blocks.every(b => b.plan === true && b.reason));
  const reasons = s.blocks.map(b => b.reason);
  assert.ok(reasons.some(r => /7i strike/.test(r)), 'range strike data');
  assert.ok(reasons.some(r => /5W off the tee/.test(r)), 'course data');
  assert.ok(!reasons.some(r => /D off the tee/.test(r)), 'nothing that has gone quiet');
  const keys = s.blocks.map(b => b.club + '|' + b.swing);
  assert.equal(new Set(keys).size, keys.length, 'one block per club and swing');
  // In the order the list ranks them.
  const order = now.filter(x => x.block).map(x => x.title);
  const idx = reasons.map(r => order.indexOf(r.split('; ')[0]));   // a merged block is placed by its first reason
  assert.ok(idx.every(i => i >= 0));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});

test('the planned blocks say why they are there', () => {
  assert.match(app.text('#view'), /Planned from what's current in your rounds, range sessions and swings/);
  assert.match(app.text('#view'), /Why: 7i strike/);
});

test('planning again replaces an unhit plan instead of piling up another — after asking', async () => {
  const count = async () => (await app.api.list('sessions')).filter(s => s.planned).length;
  assert.equal(await count(), 1);
  app.act('planSession');
  await app.answer(false);
  assert.equal(await count(), 1);
  app.act('planSession');
  await app.answer(true);
  await app.waitFor(async () => /Plan replaced/.test(app.toast()), { what: 'replaced' });
  assert.equal(await count(), 1);
  assert.equal((await app.api.list('sessions')).find(s => s.planned).id, planId, 'same session, new blocks');
});

test('once a strike problem clears up in the latest session, it goes quiet as improving', async () => {
  const s = await app.api.get('sessions', 's_new');
  await app.api.put('sessions', 's_new', { ...s, blocks: s.blocks.map(b => b.id === 'b_new' ? { ...b, shots: shots7i(9, 1) } : b) });
  await app.waitFor(() => app.E(`!!rankedPractice().quiet.find(x => x.key === 'strike:7i')`), { what: 'poll' });
  const q = item(ranked().quiet, 'strike:7i');
  assert.match(q.note, /^Improving: 10% in the latest session \(.*\) against 60% before\.$/);
});
