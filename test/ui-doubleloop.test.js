// The loop around the practice loop (2.19.0): the app checking its own list.
// "Is this list right?" says, for each finding, whether it went quiet after
// range work on its club or without any, or is still showing after being
// worked on; the swing readings' "can't tell" lines are counted by camera
// view; the Overview's Gapping says how far his assumed carries sit from the
// measured ones; and the ranking's costs and thresholds are shown as rules.
// Same scenario as ui-practice (dates relative to today).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shots7i = (pure, runners) => [...Array(pure).fill({ carry: 128, total: 138 }), ...Array(runners).fill({ carry: 110, total: 140 })];
const hole = (n, shots, putts = 2) => ({ n, par: 4, metres: 300, shots, putts, strokes: shots.length + putts });
const teeThenGreen = (tee, lie) => [{ t: 0.5, u: 0, club: tee, lie }, { t: 0.95, u: 0, club: 'PW', lie: 'green' }];
const round = (id, ago, holes) => ({ id, v: 2, type: 'round', date: daysAgo(ago), courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'shot_level', holes });
const reading = (one, ago, extra = {}) => ({ analysis: { one_thing: one, observations: [{ what: one, evidence: 'frame 5', confidence: 'high' }], matches_ball_data: 'This lines up with the low runners.', drill: { name: 'Pump drill', why: 'feel the lag' }, ...(extra.cannot_tell ? { cannot_tell: extra.cannot_tell } : {}) }, analysedOn: daysAgo(ago), frames: [] });

let app;
const RANGE_NEW = { id: 's_new', v: 2, type: 'range', date: daysAgo(5), blocks: [
  { id: 'b_new', seq: 1, club: '7i', swing: 'full', shots: shots7i(4, 6) },
  { id: 'b_chip', seq: 2, club: 'PW', swing: 'chip', target: 40, shots: [{ carry: 38, total: 41 }, { carry: 36, total: 40 }] }],
  swings: [
    { id: 'sw_old', view: 'dtl', club: '7i', ...reading('Old tip', 50, { cannot_tell: ['Wrist angle at the top: frame spacing skips it', 'Face angle at impact'] }) },
    { id: 'sw_new', view: 'dtl', club: '7i', ...reading('New tip', 6, { cannot_tell: ['wrist angle at the top — frame spacing skips it'] }) },
    { id: 'sw_face', view: 'face', club: '7i', ...reading('Ancient tip', 200) }] };
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
      RANGE_NEW,
    ],
  } });
});
after(() => app && app.stop());

test('each finding says how it resolved: quiet after range work, quiet without, still showing, or waiting', () => {
  const v = app.J('listReview()');
  const by = Object.fromEntries(v.rows.map(r => [r.key, r]));
  assert.deepEqual(Object.keys(by).sort(), ['short', 'strike:7i', 'tee:5W', 'tee:D'], 'measure items and video readings are not findings to resolve');
  assert.equal(by['tee:D'].outcome, 'quiet without range work', 'the driver went quiet with 8 clean drives and no range block for it');
  assert.equal(by['tee:D'].practised, null);
  assert.equal(by['tee:D'].days, 0, 'all its evidence is from one day');
  assert.equal(by['tee:5W'].outcome, 'current, not worked on');
  assert.equal(by['tee:5W'].days, 3);
  assert.equal(by.short.outcome, 'worked on, waiting on the course', 'the chip block came after the miss; the course has had no PW chance since');
  assert.equal(by.short.practised, daysAgo(5));
  assert.equal(by.short.days, 10);
  assert.equal(by['strike:7i'].outcome, 'still showing at the range', 'a strike finding is range evidence itself, so "range work" means nothing for it');
  assert.deepEqual([v.quietAfter, v.quietWithout, v.faded, v.still, v.waiting], [0, 1, 0, 0, 1]);
  assert.equal(by['tee:D'].title, 'D off the tee', 'named without its counts, like the objective');
});

test('the fold on the Range list shows the outcome per finding and withholds a verdict until enough have resolved', () => {
  app.go('range');
  const f = app.$('#listReview');
  assert.ok(f && f.tagName === 'DETAILS' && !f.open, 'a fold with an id, closed');
  assert.match(app.text('#listReview summary'), /Is this list right\? 1 quiet without$/);
  assert.match(app.text('#listReview'), /Too few findings have resolved either way/);
  assert.match(app.text('#listReviewRows'), /D off the tee Off the tee\s*quiet without range work · seen on one day/);
  assert.match(app.text('#listReviewRows'), new RegExp(`Short game Short game\\s*worked on, waiting on the course · on the list 10 days · range work ${app.E(`dateLabel(${JSON.stringify(daysAgo(5))})`)}`));
  assert.match(app.text('#listReview'), /not that the practice caused it/);
  assert.ok(app.$('#quietList').compareDocumentPosition(f) & 4, 'after the quiet list');
});

test('the verdict turns when findings go quiet as often without range work as with it', async () => {
  // Four findings resolved: build them by hand through the review's own counting.
  const verdict = rows => app.E(`(() => { const saved = listReview; window.listReview = () => ({ rows: ${JSON.stringify(rows)}, quietAfter: ${rows.filter(r => r.outcome === 'quiet after range work').length}, quietWithout: ${rows.filter(r => r.outcome === 'quiet without range work').length}, faded: 0, still: 0, waiting: 0 });
    try { return listReviewSection(); } finally { window.listReview = saved; } })()`);
  const row = (key, outcome) => ({ key, title: key, kind: 'tee', days: 5, practised: null, outcome });
  assert.match(verdict([row('a', 'quiet without range work'), row('b', 'quiet without range work'), row('c', 'quiet after range work'), row('d', 'quiet after range work')]), /as often without range work as with it[\s\S]*costs below are the thing to doubt/);
  assert.match(verdict([row('a', 'quiet without range work'), row('b', 'quiet after range work'), row('c', 'quiet after range work'), row('d', 'quiet after range work')]), /more often after range work than without it[\s\S]*not proof the practice did it/);
  assert.match(verdict([row('a', 'quiet without range work'), row('b', 'quiet after range work'), row('c', 'quiet after range work')]), /Too few findings/);
});

test('what the readings couldn\'t see is counted by camera view, repeats merged, newest wording kept', () => {
  const v = app.J('readingBlindSpots()');
  assert.deepEqual(v.map(x => [x.view, x.n, x.blind]), [['dtl', 2, 2], ['face', 1, 0]]);
  assert.deepEqual(v[0].said, ['wrist angle at the top — frame spacing skips it', 'Face angle at impact'], 'the same line from two readings once, in the newer reading\'s words; newest first');
  app.go('range');
  assert.match(app.text('#blindSpots summary'), /What the readings couldn't see 2 of 3 readings$/);
  assert.match(app.text('#blindSpotRows'), /Down the line: 2 of 2 readings said what the angle or frames couldn't answer\.\s*wrist angle at the top — frame spacing skips it\s*Face angle at impact\s*Face on: 0 of 1 reading/);
  assert.match(app.text('#blindSpots'), /a question for the camera angle or the frames/);
});

test('the ranking\'s costs and thresholds are shown as rules, from the same constants it uses', () => {
  app.go('range');
  const rules = app.text('#rankRules');
  assert.match(rules, /water costs 1, trees 0\.8, a bunker 0\.5, rough 0\.3; an approach clubbed short or a chip that misses the green 0\.5; a three-putt 1; a penalty stroke 0\.6; a low runner or top on the range 0\.05 each/);
  assert.match(rules, /4 times in 5 \(3 at least\), or once unseen for 180 days/);
  assert.match(rules, /flagged for strike at 35% low runners or tops over 10 or more full swings/);
  assert.match(rules, /judgements, not measurements/);
  // The costs the items carry are the costs the rules name.
  const items = app.J('practiceItems()');
  assert.equal(items.find(x => x.key === 'tee:D').ev[0].cost, 0.8, 'trees');
  assert.equal(items.find(x => x.key === 'short').ev[0].cost, 0.5);
  assert.equal(items.find(x => x.key === 'strike:7i').ev[0].cost, 0.05);
});

test('Gapping says how far the assumed carries sit from the measured ones, only for clubs with both', async () => {
  app.go('overview');
  assert.equal(app.$('#beliefGap'), null, 'the 5i has an assumed carry but no range data; the 7i the reverse: nothing to compare');
  assert.equal(app.E('beliefGap()'), null);
  const stock = app.E(`clubStats('7i').stockCarry`);
  await app.api.put('clubs', '7i', { ...club('7i', 'iron', { order: 4 }), nominalCarry: stock + 10 });
  await app.waitFor(() => app.E(`(activeClubs().find(c => c.code === '7i') || {}).nominalCarry`) === stock + 10, { what: 'club' });
  const g = app.J('beliefGap()');
  assert.deepEqual(g.rows, [{ code: '7i', assumed: stock + 10, measured: stock, delta: 10 }]);
  assert.equal(g.mean, 10);
  app.go('overview');
  assert.equal(app.text('#beliefGap'), `Assumed against measured: what you've put in the bag runs 10m long of what the range measures (1 club; biggest 7i, assumed ${stock + 10}m against ${stock}m measured). The measured number is what the app plans with.`);
  await app.api.put('clubs', '7i', { ...club('7i', 'iron', { order: 4 }), nominalCarry: stock - 1 });
  await app.waitFor(() => app.E(`(activeClubs().find(c => c.code === '7i') || {}).nominalCarry`) === stock - 1, { what: 'club' });
  app.go('overview');
  assert.match(app.text('#beliefGap'), /runs about right of what the range measures \(1 club\)\./, 'within 2.5m is about right, and no "biggest"');
});
