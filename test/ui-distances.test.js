// How club distances are worked out: recent shots count more, and which
// sessions count at all (left out by hand, date window, ball type).
//
// Scenario (synthetic): the 7i hit 130m twice today on premium balls, and
// 100m three times 60 days ago on range balls. Weighted by recency the two
// new shots outweigh the three old ones (≈2 vs ≈1.5); counted equally the
// old ones are the majority.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, sleep } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shots = (n, carry, total) => Array.from({ length: n }, () => ({ carry, total }));

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 3 }), club('9i', 'iron', { order: 4 }), club('PW', 'wedge', { order: 5 })],
    sessions: [
      { id: 's_new', v: 2, type: 'range', date: daysAgo(0), ballType: 'premium', venue: 'New', blocks: [{ id: 'bn', seq: 1, club: '7i', swing: 'full', shots: shots(2, 130, 140) }] },
      { id: 's_old', v: 2, type: 'range', date: daysAgo(60), ballType: 'range', venue: 'Old', blocks: [{ id: 'bo', seq: 1, club: '7i', swing: 'full', shots: shots(3, 100, 110) }] },
      { id: 's_nb', v: 2, type: 'range', date: daysAgo(5), venue: 'No ball type', blocks: [{ id: 'b9', seq: 1, club: '9i', swing: 'full', shots: shots(4, 120, 130) }] },
      { id: 's_sum', v: 2, type: 'range', date: daysAgo(3), ballType: 'range', blocks: [{ id: 'bs', seq: 1, club: 'PW', swing: 'full', summary: { n: 20, avgCarry: 90, avgTotal: 96 } }] },
    ],
  } });
});
after(() => app && app.stop());

const stats = () => app.J(`clubStats('7i')`);
const setting = async (act, v) => {
  app.go('overview');
  app.click(`#view [data-act="${act}"][data-v="${v}"]`);
  const key = act === 'setWeighting' ? 'weighting' : 'balls';
  await app.waitFor(async () => (await app.api.get('settings', 'app'))[key] === v, { what: `${key} saved` });
};

test('the weighted median is the ordinary median when every weight is equal', () => {
  const m = pairs => app.E(`weightedMedian(${JSON.stringify(pairs)})`);
  assert.equal(m([[3, 1], [1, 1], [2, 1]]), 2);
  assert.equal(m([[1, 1], [2, 1], [3, 1], [4, 1]]), 2.5);
  assert.equal(m([[100, 0.5], [100, 0.5], [100, 0.5], [130, 1], [130, 1]]), 130, 'the heavier side wins');
  assert.equal(m([]), null);
});

test('by default recent shots count more: stock carry follows today\'s shots', () => {
  const s = stats();
  assert.equal(s.stockCarry, 130);
  assert.equal(s.n, 5);
  assert.equal(s.weighted, true);
  assert.equal(s.nEff, 4, 'two full-weight shots and three half-weight ones count like about four');
  assert.equal(s.newest, daysAgo(0));
  assert.deepEqual([s.pure, s.short], [2, 3], 'the strike profile stays a plain count');
});

test('the Overview says what each number rests on, and the panel says how shots are counted', () => {
  app.go('overview');
  const rung = app.$$('#view .rung').find(r => /^7i/.test(r.textContent.trim()));
  assert.equal(rung.querySelector('.val b').textContent, '130');
  assert.equal(rung.querySelector('.conf').textContent, '5 shots · counts like 4 recent · early signal');
  assert.match(app.text('#rangeFilter summary'), /^Range numbers: All time · recent shots count more · all balls$/);
});

test('"every shot the same" gives the plain median over the whole window', async () => {
  await setting('setWeighting', 'equal');
  await app.waitFor(() => app.E(`clubStats('7i').stockCarry`) === 100, { what: 'recomputed' });
  assert.equal(stats().weighted, false);
  app.go('overview');
  assert.equal(app.$$('#view .rung').find(r => /^7i/.test(r.textContent.trim())).querySelector('.conf').textContent, '5 shots · emerging');
  await setting('setWeighting', 'recent');
});

test('the ball filter counts only matching sessions; an unrecorded ball type counts only under all balls', async () => {
  await setting('setBalls', 'range');
  await app.waitFor(() => app.E(`clubStats('7i').n`) === 3, { what: 'range balls only' });
  assert.equal(stats().stockCarry, 100);
  assert.equal(app.E(`clubStats('9i')`), null, 'the session with no ball type is out');
  app.go('overview');
  assert.match(app.text('#rangeFilter'), /1 session didn't record the ball type/);
  await setting('setBalls', 'better');
  await app.waitFor(() => app.E(`clubStats('7i').n`) === 2, { what: 'premium and own only' });
  assert.equal(stats().stockCarry, 130);
  await setting('setBalls', 'all');
  await app.waitFor(() => app.E(`clubStats('7i').n`) === 5, { what: 'all again' });
  assert.equal(app.E(`clubStats('9i').n`), 4);
});

test('a session left out by hand stops counting, but its own page still shows its shots', async () => {
  app.go('range', { sessionId: 's_new' });
  app.click('#view [data-act="toggleExclude"]');
  await app.waitFor(async () => (await app.api.get('sessions', 's_new')).excluded === true, { what: 'saved' });
  await app.waitFor(() => app.E(`clubStats('7i').n`) === 3, { what: 'recomputed' });
  assert.equal(stats().stockCarry, 100);
  assert.match(app.text('#leftOut'), /Left out of your numbers/);
  assert.equal(app.$$('#view .block-row svg circle').length, 2, 'its two shots still plotted');
  app.go('range');
  assert.match(app.text('#view'), /left out/);
  app.go('overview');
  assert.match(app.text('#rangeFilter summary'), /· 1 left out$/);
  app.go('range', { sessionId: 's_new' });
  app.click('#leftOut [data-act="toggleExclude"]');
  await app.waitFor(async () => (await app.api.get('sessions', 's_new')).excluded === false, { what: 'counted again' });
  await app.waitFor(() => app.E(`clubStats('7i').n`) === 5, { what: 'back in' });
});

test('summary-only blocks follow the same rules: a left-out session\'s averages stop counting', async () => {
  assert.deepEqual(app.J(`carryRef('PW')`), { v: 90, measured: true, src: 'range summary' });
  const s = await app.api.get('sessions', 's_sum');
  await app.api.put('sessions', 's_sum', { ...s, excluded: true });
  await app.waitFor(() => app.E(`carryRef('PW')`) === null, { what: 'no measured PW' });
  await app.api.put('sessions', 's_sum', { ...s, excluded: false });
  await app.waitFor(() => !!app.E(`carryRef('PW')`), { what: 'back' });
});

test('a block\'s page tags each shot with its strike class (the tags used to be blank)', async () => {
  await sleep(200);
  app.go('range', { blockId: 'bn' });
  const tags = app.$$('#view table tbody tr').map(tr => (tr.querySelector('.tag') || {}).textContent || '');
  assert.deepEqual(tags, ['pure', 'pure']);
  assert.ok(app.$$('#view .strip circle.dot-pure').length === 2, 'and the dots are coloured');
});

test('a shot\'s weight is set by its day, so the clock ticking mid-calculation changes nothing', async () => {
  // Weights used to come from Date.now() to the millisecond, read once per shot,
  // so shots from the same day could weigh a hair apart and a mean came out as
  // 125.25000000025072 (a CI failure in 1.6.1). Make the clock move on every read.
  const pure = () => app.J(`(() => { const s = clubStats('7i'); return [s.stockCarry, s.pureCarry, s.nEff]; })()`);
  const before = pure();
  app.win.eval(`window.__now = Date.now; { let t = __now.call(Date); Date.now = () => (t += 1); }`);
  try {
    await app.api.put('settings', 'app', { ...(await app.api.get('settings', 'app')), marker: Date.now() });
    await app.waitFor(() => app.E(`!!settings().marker`), { what: 'data state changed, cache cleared' });
    assert.deepEqual(pure(), before);
    assert.equal(app.E(`shotWeight(today())`), 1, 'today weighs exactly 1');
    assert.equal(app.E(`shotWeight(localDay(new Date(Date.now() - 60 * 864e5)))`), 0.5, 'sixty days ago exactly half');
  } finally { app.win.eval(`Date.now = __now`); }
});
