// Swing history (2.23.0): every swing on file in one timeline, newest first,
// flagged range or course with the date and the one fix its reading gave;
// and a summary per club put together from the readings. Nothing new is
// read. Checked on a hand-made set: two 7i readings at the range months
// apart with different fixes, an unread 5W swing on a round.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

let app, f1, f2;
const reading = (one, extra = {}) => ({ one_thing: one, why: 'w', feel: 'f', drill: { name: 'D', how: 'h' }, check: 'c', ball_data: 'agrees', observations: [{ what: one, evidence: 'frame 5', confidence: 'high' }], cannot_tell: ['Wrist angle at the top'], ...extra });
before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 4 })], courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }] } });
  f1 = (await app.api.upload(Buffer.from('frame-one'), 'image/webp')).id; f2 = (await app.api.upload(Buffer.from('frame-two'), 'image/webp')).id;
  const frames = [{ asset: f1, t: 0.05 }, { asset: f2, t: 0.3 }, { asset: f1, t: 0.55 }];
  await app.api.put('sessions', 's_aug', { id: 's_aug', v: 2, type: 'range', date: '2026-08-03', venue: 'Moore Park range', blocks: [], swings: [{ id: 'sw_a', view: 'dtl', club: '7i', note: 'hooking', frames, analysis: reading('Rotate through the ball', { ball_data: 'contradicts' }), analysedOn: '2026-08-03' }] });
  await app.api.put('sessions', 's_oct', { id: 's_oct', v: 2, type: 'range', date: '2026-10-19', venue: 'Moore Park range', blocks: [], swings: [{ id: 'sw_b', view: 'dtl', club: '7i', frames, analysis: reading('Hold the wrist angle longer', { wrist: { top: 'flat', lead_arm_parallel: 'released', frames: 'frames 6 and 9' } }), analysedOn: '2026-10-19' }, { id: 'sw_c', view: 'face', club: '7i', frames, analysis: reading('Hold the wrist angle longer'), analysedOn: '2026-10-19' }] });
  await app.api.put('sessions', 'r_sep', { id: 'r_sep', v: 2, type: 'round', date: '2026-09-14', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'score_only', holes: card(9).map(({ n, par, metres }) => ({ n, par, metres, strokes: par })), swings: [{ id: 'sw_d', view: 'face', club: '5W', frames, addedOn: '2026-09-14' }] });
  await app.waitFor(() => app.E(`allSwings().length`) === 4, { what: 'swings' });
});
after(() => app && app.stop());

test('the timeline lists every swing newest first, flagged range or course, with the date and the fix', () => {
  app.go('range');
  assert.match(app.text('#view [data-go="range:view=swings"]'), /Swing history: 4 swings/);
  app.go('range', { view: 'swings' });
  assert.match(app.text('#swingBasis'), /4 swings from 3 sessions, 3 Aug 2026 to 19 Oct 2026; 3 read/);
  const rows = app.$$('#swingTimeline .swrow');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.querySelector('.t').textContent.replace(/\s+/g, ' ').trim()), ['19 Oct 2026 range 7i Down the line', '19 Oct 2026 range 7i Face on', '14 Sept 2026 course 5W Face on', '3 Aug 2026 range 7i Down the line']);
  assert.deepEqual(rows.map(r => r.dataset.go), ['range:sessionId=s_oct', 'range:sessionId=s_oct', 'rounds:sessionId=r_sep', 'range:sessionId=s_aug'], 'each opens where it was filmed');
  assert.match(rows[0].textContent, /Moore Park range[\s\S]*Hold the wrist angle longer · ball data agrees/);
  assert.match(rows[2].textContent, /Test GC[\s\S]*not read yet/);
  assert.match(rows[3].textContent, /hooking[\s\S]*Rotate through the ball · contradicts ball data/);
  assert.equal(rows[0].querySelector('img.thumb').getAttribute('src'), `/_blob/${f2}`, 'the middle frame as the thumbnail');
});

test('a summary per club is put together from the readings: count, span, the fixes in order, agreement, the latest wrist answer', () => {
  const c = app.J(`swingClubSummary('7i', swingHistory())`);
  assert.equal(c.n, 3); assert.equal(c.read, 3);
  assert.deepEqual([c.first, c.last], ['2026-08-03', '2026-10-19']);
  assert.deepEqual(c.fixes.map(f => [f.date, f.view, f.fix, f.agrees]), [['2026-08-03', 'dtl', 'Rotate through the ball', false], ['2026-10-19', 'dtl', 'Hold the wrist angle longer', true], ['2026-10-19', 'face', 'Hold the wrist angle longer', true]]);
  assert.deepEqual([c.agrees, c.contradicts, c.cantTell], [2, 1, 1], 'the same can\'t-tell line three times counts once');
  assert.deepEqual(c.latest.wrist, null, 'the latest reading is the face-on one, which has no wrist answer');
  const w = app.J(`swingClubSummary('5W', swingHistory())`);
  assert.deepEqual([w.n, w.read, w.latest], [1, 0, null]);
  app.go('range', { view: 'swings' });
  const folds = app.$$('#swingClubs details');
  assert.deepEqual(folds.map(d => d.id), ['swc_5W', 'swc_7i'], 'bag order, closed folds with ids');
  assert.match(app.text('#swc_5W summary'), /5W 1 swing, none read yet/);
  assert.match(app.text('#swc_7i summary'), /7i 3 readings · latest: Hold the wrist angle longer/);
  assert.match(app.text('#swc_7i'), /3 swings \(Down the line, Face on\), 3 Aug 2026 to 19 Oct 2026; 3 readings, 2 agreeing with the ball data, 1 contradicting it\./);
  assert.deepEqual(app.$$('#swc_7i ol.fixes li').map(li => li.textContent.replace(/\s+/g, ' ').trim()), ['3 Aug 2026, Down the line: Rotate through the ball contradicts ball data', '19 Oct 2026, Down the line: Hold the wrist angle longer ball data agrees', '19 Oct 2026, Face on: Hold the wrist angle longer ball data agrees']);
  assert.match(app.text('#swc_7i'), /The fix has changed between readings/);
  assert.match(app.text('#swc_7i'), /1 thing the readings said they couldn't see/);
  assert.doesNotMatch(app.text('#swc_7i'), /Wrist, latest/, 'no wrist line when the latest reading has none');
});

test('with no swings the page says so, and the Range list has no link', async () => {
  for (const id of ['s_aug', 's_oct']) await app.api.put('sessions', id, { ...(await app.api.get('sessions', id)), swings: [] });
  await app.api.put('sessions', 'r_sep', { ...(await app.api.get('sessions', 'r_sep')), swings: [] });
  await app.waitFor(() => app.E(`allSwings().length`) === 0, { what: 'cleared' });
  app.go('range');
  assert.equal(app.$('#view [data-go="range:view=swings"]'), null);
  app.go('range', { view: 'swings' });
  assert.match(app.text('#view'), /No swings on file yet/);
});
