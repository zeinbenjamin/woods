// CRUD through the real forms: clubs, courses, range sessions and blocks,
// rounds. Every write is checked where it lands — in SQLite, via the API —
// not just in the page's own state.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, club, card, rangeSession, block } from './harness.js';

let app;
const artHole = {
  n: 1, par: 4, metres: 300, si: 1,   // the rest of the card has 2..18
  tees: { white: 300, blue: 320 },
  shape: { bend: 0.4, bendAt: 0.55, hazards: [{ kind: 'bunker', t: 0.5, side: -1 }] },
  art: { asset: 'a'.repeat(32), w: 540, h: 900, tee: [270, 810], green: [270, 108], gr: 30 },
};

before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 3, nominalCarry: 120 }), club('PW', 'wedge', { order: 4 })],
    courses: [
      { id: 'c_art', v: 2, name: 'Artwork GC', tee: 'white', holes: [artHole, ...card(18, { extra: {} }).slice(1)] },
    ],
    sessions: [rangeSession('s_old', '2026-01-10', [block('b_old', '7i', [[100, 120], [110, 130], [105, 126], [112, 131], [98, 118]])])],
  } });
});
after(() => app && app.stop());

/* ---------- clubs ---------- */

test('adding a club writes it to SQLite, code sanitised, beliefs stored as typed', async () => {
  app.act('newClub');
  app.fill('code', '5 i!'); app.fill('name', '5 Iron'); app.fill('category', 'iron');
  app.fill('nominalCarry', 150); app.fill('nominalTotal', 165);
  assert.equal(await app.save(), true);
  const c = await app.api.get('clubs', '5i');
  assert.ok(c, 'stored under the sanitised code');
  assert.equal(c.name, '5 Iron');
  assert.equal(c.nominalCarry, 150);
  assert.equal(c.nominalTotal, 165);
  assert.equal(c.retired, false);
});

test('a duplicate club code is refused and the sheet stays open', async () => {
  app.act('newClub');
  app.fill('code', '5i');
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /already in the bag/);
  app.click('#sheetInner [data-close]');
  assert.equal((await app.api.list('clubs')).length, 3);
});

test('editing a club keeps its code fixed; retiring hides it from new blocks only', async () => {
  app.act('editClub', { id: '7i' });
  assert.equal(app.field('code').hasAttribute('readonly'), true, 'code is the id and cannot change');
  app.fill('retired', true);
  assert.equal(await app.save(), true);
  const c = await app.api.get('clubs', '7i');
  assert.equal(c.retired, true);
  assert.equal(c.nominalCarry, 120, 'other fields survive the edit');

  const blockClubs = app.J(`[...new DOMParser().parseFromString(blockForm(), 'text/html').querySelectorAll('[name=club] option')].map(o => o.value)`);
  assert.ok(!blockClubs.includes('7i'), 'retired club not offered for a new block');

  // History still resolves: the 7i's old range shots still produce numbers.
  assert.equal(app.E(`clubStats('7i').n`), 5);
  app.go('bag');
  assert.match(app.text('#view'), /7i.*retired/s);
});

test('clubs are never deleted: there is no action or button that deletes one', () => {
  const acts = app.J('Object.keys(ACTIONS)');
  assert.deepEqual(acts.filter(k => /delete|remove/i.test(k) && /club/i.test(k)), []);
  app.go('bag');
  assert.equal(app.$$('#view [data-act]').filter(b => /delete/i.test(b.dataset.act)).length, 0);
});

/* ---------- courses ---------- */

test('a new course needs a name and a par on every hole', async () => {
  app.act('newCourse');
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /Name the course/);
  app.fill('name', 'Test Links'); app.fill('tee', 'White');
  app.click('#sheetInner [data-holes="9"]');
  for (let i = 1; i <= 9; i++) if (i !== 5) { app.fill(`par_${i}`, i % 3 ? 4 : 3); app.fill(`m_${i}`, 250 + i); }
  assert.equal(await app.save(), false, 'hole 5 has no par');
  assert.match(app.toast(), /par for hole 5\b/);
  app.fill('par_5', 5); app.fill('m_5', 460);
  assert.equal(await app.save(), true);

  const c = (await app.api.list('courses')).find(x => x.name === 'Test Links');
  assert.equal(c.v, 2);
  assert.equal(c.tee, 'white', 'tee name normalised to lower case');
  assert.deepEqual(c.holes.map(h => h.n), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'contiguous from 1');
  assert.equal(c.holes[4].par, 5);
  assert.deepEqual(c.holes[4].tees, { white: 460 }, 'metres mirrored into the tee set');
  assert.equal(c.holes[4].metres, 460);
});

test('switching 18 ↔ 9 holes in the form does not lose typed values', () => {
  app.act('newCourse');
  app.fill('par_1', 4); app.fill('m_1', 333); app.fill('par_14', 5);
  app.click('#sheetInner [data-holes="9"]');
  assert.equal(app.field('par_14'), null);
  app.click('#sheetInner [data-holes="18"]');
  assert.equal(app.field('m_1').value, '333');
  assert.equal(app.field('par_14').value, '5');
  app.click('#sheetInner [data-close]');
});

test('a near-duplicate course name asks in-page first; Cancel saves nothing', async () => {
  const before = (await app.api.list('courses')).length;
  app.act('newCourse');
  app.fill('name', 'test-links'); app.click('#sheetInner [data-holes="9"]');
  for (let i = 1; i <= 9; i++) app.fill(`par_${i}`, 4);
  const saving = app.save();
  await app.answer(false);
  assert.equal(await saving, false);
  assert.equal((await app.api.list('courses')).length, before);
  const again = app.save();
  await app.answer(true);
  assert.equal(await again, true);
  assert.equal((await app.api.list('courses')).length, before + 1);
});

test('editing a course preserves artwork, outline, stroke index and other tee sets', async () => {
  app.act('editCourse', { id: 'c_art' });
  app.fill('m_1', 305); app.fill('par_2', 5);
  assert.equal(await app.save(), true);
  const c = await app.api.get('courses', 'c_art');
  const h1 = c.holes[0];
  assert.deepEqual(h1.art, artHole.art, 'artwork kept');
  assert.deepEqual(h1.shape, artHole.shape, 'drawn outline kept');
  assert.equal(h1.si, 1, 'stroke index kept');
  assert.equal(h1.tees.blue, 320, 'a tee set the form does not show is kept');
  assert.equal(h1.tees.white, 305, 'the edited tee set takes the new distance');
  assert.equal(h1.metres, 305);
  assert.equal(c.holes[1].par, 5);
  assert.equal(c.holes[1].si, 2, 'untouched holes keep their fields too');
  assert.equal(c.holes.length, 18);
});

test('stroke index is typed on the scorecard: 1 to N, each once; a cleared box removes it', async () => {
  // Randwick came over with no stroke index and there was no way to add one.
  await app.api.put('courses', 'c_nosi', { id: 'c_nosi', v: 2, name: 'No Index GC', tee: 'white', holes: card(9).map(({ si, ...h }) => h) });
  await app.waitFor(() => !!app.E(`course('c_nosi')`), { what: 'course loaded' });
  app.act('editCourse', { id: 'c_nosi' });
  assert.equal(app.text('#sheetInner .hole-grid .h:nth-child(4)'), 'SI');
  const order = [6, 8, 2, 9, 1, 4, 3, 7, 5];
  order.forEach((v, i) => app.fill(`si_${i + 1}`, v));
  app.fill('si_9', 6);
  assert.equal(await app.save(), false, 'two holes with SI 6 are refused');
  app.fill('si_9', 10);
  assert.equal(await app.save(), false, 'SI 10 on a 9-hole card is refused');
  app.fill('si_9', 5);
  app.click('#sheetInner [data-holes="18"]'); app.click('#sheetInner [data-holes="9"]');
  assert.equal(app.field('si_4').value, '9', 'switching 9 ↔ 18 keeps typed values');
  assert.equal(await app.save(), true);
  assert.deepEqual((await app.api.get('courses', 'c_nosi')).holes.map(h => h.si), order);
  app.act('editCourse', { id: 'c_nosi' });
  assert.equal(app.field('si_1').value, '6', 'the saved index shows when editing again');
  app.fill('si_9', '');
  assert.equal(await app.save(), true);
  const c = await app.api.get('courses', 'c_nosi');
  assert.equal(c.holes[8].si, undefined, 'a cleared box removes that hole\'s index');
  assert.equal(c.holes[0].si, 6);
});

test('deleting a course uses the in-page confirm, never window.confirm', async () => {
  app.win.confirm = () => { throw new Error('window.confirm was called'); };
  const id = (await app.api.list('courses')).find(x => x.name === 'test-links').id;
  app.act('deleteCourse', { id });
  await app.answer(false);
  assert.ok(await app.api.get('courses', id), 'Cancel keeps it');
  app.act('deleteCourse', { id });
  await app.answer(true);
  await app.waitFor(async () => !(await app.api.get('courses', id)), { what: 'course deleted' });
});

test('the app source never calls window.confirm (blocked in the artifact sandbox)', () => {
  const src = readFileSync('web/index.html', 'utf8');
  const code = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, ''));   // the comment explaining why is fine
  const calls = code.filter(l => /(^|[^\w.])confirm\s*\(|window\.confirm/.test(l));
  assert.deepEqual(calls, []);
});

/* ---------- range sessions and blocks ---------- */

let sid;
test('a new range session saves and opens', async () => {
  app.act('newRange');
  app.fill('date', '2026-09-20'); app.fill('venue', 'Test Range'); app.fill('focus', 'tempo');
  assert.equal(await app.save(), true);
  sid = app.E('S.sub && S.sub.sessionId');
  assert.ok(sid && sid.startsWith('s_'));
  const s = await app.api.get('sessions', sid);
  assert.equal(s.type, 'range');
  assert.equal(s.venue, 'Test Range');
  assert.equal(s.date, '2026-09-20');
});

test('pasted shots parse in every supported shape', () => {
  const got = app.J(`parseShots(${JSON.stringify([
    '147.5  178.2  -',          // carry total, no speed
    '156.6,170.8,79.4 ✓',       // commas, speed, target hit
    '3\t120\t140\t80',          // row number first: dropped
    'junk line',
    '',
    '90',                       // one number: not a shot
  ].join('\n'))})`);
  assert.deepEqual(got, [
    { carry: 147.5, total: 178.2 },
    { carry: 156.6, total: 170.8, speed: 79.4, hitC: true },
    { carry: 120, total: 140, speed: 80 },
  ]);
  const round = app.J(`parseShots(shotsText(${JSON.stringify(got)}))`);
  assert.deepEqual(round, got, 'what the edit form shows parses back to the same shots');
});

test('a block with shots saves them; shot-derivable summary fields are dropped', async () => {
  app.act('newBlock', { id: sid });
  app.fill('club', 'PW'); app.fill('target', 90);
  app.fill('shots', '88 95 -\n92 99 -\n85 90 -');
  assert.match(app.text('#shotCount'), /3 shots parsed/);
  app.fill('sm_n', 40); app.fill('sm_avgCarry', 70); app.fill('sm_fromPinCarry', 6.5);
  assert.equal(await app.save(), true);
  const b = (await app.api.get('sessions', sid)).blocks[0];
  assert.equal(b.club, 'PW');
  assert.equal(b.target, 90);
  assert.equal(b.shots.length, 3);
  assert.deepEqual(b.summary, { fromPinCarry: 6.5 }, 'n and avgCarry come from the shots, from-pin only from the bay');
});

test('a block with neither shots nor a summary is refused', async () => {
  app.act('newBlock', { id: sid });
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /Paste shots or fill the bay summary/);
  app.click('#sheetInner [data-close]');
  assert.equal((await app.api.get('sessions', sid)).blocks.length, 1);
});

test('editing a block shows its shots and saves changes in place', async () => {
  const bid = (await app.api.get('sessions', sid)).blocks[0].id;
  app.act('editBlock', { sid, bid });
  assert.equal(app.field('shots').value.split('\n').length, 3);
  app.fill('shots', app.field('shots').value + '\n95 101 -');
  assert.equal(await app.save(), true);
  const s = await app.api.get('sessions', sid);
  assert.equal(s.blocks.length, 1);
  assert.equal(s.blocks[0].id, bid);
  assert.equal(s.blocks[0].shots.length, 4);
});

test('deleting a block, then the session, both go through the in-page confirm', async () => {
  const bid = (await app.api.get('sessions', sid)).blocks[0].id;
  app.act('deleteBlock', { sid, bid });
  await app.answer(true);
  await app.waitFor(async () => (await app.api.get('sessions', sid)).blocks.length === 0, { what: 'block gone' });
  app.act('deleteSession', { id: sid });
  await app.answer(true);
  await app.waitFor(async () => !(await app.api.get('sessions', sid)), { what: 'session gone' });
});

/* ---------- rounds ---------- */

test('a new round prefills par and metres from the course and needs a score', async () => {
  app.act('newRound');
  assert.equal(app.field('courseId').value, 'c_art');
  assert.equal(app.field('par_2').value, '5');
  assert.equal(app.field('m_1').value, '305');
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /at least one score/);
  app.fill('s_1', 6); app.fill('par_3', ''); app.fill('s_3', 5);
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /needs a par/);
  app.fill('par_3', 4);
  assert.equal(await app.save(), true);
  const id = app.E('S.sub.sessionId');
  const r = await app.api.get('sessions', id);
  assert.equal(r.type, 'round');
  assert.equal(r.courseName, 'Artwork GC');
  assert.equal(r.tee, 'white');
  assert.equal(r.detail, 'score_only');
  assert.equal(r.holes[0].strokes, 6);
  assert.equal(r.holes[1].strokes, undefined);
});

test('the course field searches by name or suburb and Enter picks the match', async () => {
  await app.api.put('courses', 'c_sub', { id: 'c_sub', v: 2, name: 'Zed Park', suburb: 'Northbridge', tee: 'white', holes: card(9) });
  await app.waitFor(() => app.E(`!!course('c_sub')`), { what: 'poll' });
  app.act('newRound');
  const box = app.$('#courseSearch');
  box.value = 'north'; box.dispatchEvent(new app.win.Event('input'));
  assert.deepEqual(app.$$('#courseResults [data-cid]').map(b => b.dataset.cid), ['c_sub']);
  box.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(app.field('courseId').value, 'c_sub');
  assert.equal(app.$$('#holesWrap [name^=par_]').length, 9, 'scorecard switched to the picked course');
  app.click('#sheetInner [data-close]');
});

test('editing a round keeps traced shots, putts and the typed score', async () => {
  const r = { id: 'r_edit', v: 2, type: 'round', date: '2026-09-01', courseId: 'c_art', courseName: 'Artwork GC', tee: 'white', detail: 'shot_level',
    holes: [{ n: 1, par: 4, metres: 305, shots: [{ t: 0.5, u: 0, club: 'PW' }, { t: 0.95, u: 0, club: 'PW' }], putts: 2, strokes: 4 }, { n: 2, par: 5, metres: 300, strokes: 6 }] };
  await app.api.put('sessions', r.id, r);
  await app.waitFor(() => app.E(`!!session('r_edit')`), { what: 'poll' });
  app.act('editRound', { id: 'r_edit' });
  app.fill('s_1', 7); app.fill('s_2', 7);
  assert.equal(await app.save(), true);
  const got = await app.api.get('sessions', 'r_edit');
  assert.equal(got.holes[0].shots.length, 2, 'shots kept');
  assert.equal(got.holes[0].putts, 2, 'putts kept');
  assert.equal(got.holes[0].manualStrokes, 7, 'typed score kept aside');
  assert.equal(got.holes[0].strokes, 4, 'score on a traced hole comes from its shots');
  assert.equal(got.holes[1].strokes, 7);
  assert.equal(got.detail, 'shot_level');
});

test('an unfinished round: unscored holes are their own kind of square, and the list says how many holes were played', async () => {
  // A round cut short (daylight) on 14 of 18. Its unscored squares used to carry
  // the class "empty", which is also the empty-state box (22px padding); on a
  // phone that swelled the score strip 415px past the screen and the page
  // zoomed out. Layout itself was checked in a real browser at 390px.
  const holes = card(18).map(h => ({ n: h.n, par: h.par, metres: h.metres }));
  await app.api.put('sessions', 'r_short', { id: 'r_short', v: 2, type: 'round', date: '2026-10-19', courseId: 'c_art', courseName: 'Artwork GC', tee: 'white', detail: 'score_only',
    holes: holes.map((h, i) => i < 14 ? { ...h, strokes: h.par + 1 } : h) });
  await app.waitFor(() => !!app.E(`session('r_short')`), { what: 'round loaded' });
  app.go('rounds', { sessionId: 'r_short' });
  const sq = app.$$('#view .scorestrip .sq');
  assert.equal(sq.length, 18);
  assert.deepEqual(sq.slice(14).map(b => [...b.classList].sort().join(' ')), Array(4).fill('sq unscored'));
  assert.equal(app.$$('#view .scorestrip .empty').length, 0, 'no score square takes the empty-state style');
  assert.match(app.text('#view'), /14 of 18 holes scored/);
  app.go('rounds');
  const item = app.$$('#view .item').find(b => b.dataset.go === 'rounds:sessionId:r_short');
  assert.match(item.textContent, /14 of 18 holes/);
  const css = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(css, /\.scorestrip \{[^}]*repeat\(9, minmax\(0, 1fr\)\)/, 'columns may shrink below their cells\' minimum');
  assert.match(css, /\.scorestrip\.mini \{[^}]*repeat\(18, minmax\(0, 1fr\)\)/);
});
