// A card of 10 or 12 holes (2.20.0): Moore Park plays holes 1–10 of its old
// layout while a 12-hole course is built. Before this the app knew only 9- and
// 18-hole cards: a 10-hole course was shown as an 18-hole card with holes 11–18
// missing, the form offered 9 or 18, and a round there prefilled 18 holes.
// The real import file is loaded and checked against the club's published card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, club, card } from './harness.js';

const MP = JSON.parse(readFileSync(new URL('../imports/moore-park.json', import.meta.url))).courses[0];
let app;
before(async () => { app = await startApp({ seed: { clubs: [club('7i', 'iron'), club('D', 'driver')], courses: [MP, { id: 'c_nine', v: 2, name: 'Nine GC', tee: 'white', holes: card(9) }, { id: 'c_full', v: 2, name: 'Full GC', tee: 'white', holes: card(18) }] } }); });
after(() => app && app.stop());

test('the Moore Park import is the club\'s card: 10 holes, par 38, three tees, index re-ranked 1–10', () => {
  assert.equal(MP.holes.length, 10);
  assert.deepEqual(MP.holes.map(h => h.par), [4, 3, 4, 5, 3, 5, 3, 4, 4, 3]);
  assert.deepEqual(MP.holes.map(h => h.tees.blue), [398, 137, 382, 550, 158, 480, 190, 363, 286, 156], 'blue, from mooreparkgolf.com.au/play/the-course');
  assert.deepEqual(MP.holes.map(h => h.tees.white), [378, 131, 333, 535, 155, 463, 171, 358, 280, 144]);
  assert.deepEqual(MP.holes.map(h => h.tees.red), [330, 125, 305, 451, 140, 407, 140, 323, 257, 123]);
  assert.ok(MP.holes.every(h => h.metres === h.tees.blue), 'blue is the primary tee');
  assert.deepEqual(MP.holes.map(h => h.si).slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'each index once');
  assert.deepEqual(MP.holes.map(h => h.si), [1, 10, 4, 2, 8, 7, 9, 3, 6, 5], 'the club\'s 18-hole order 2, 18, 7, 3, 14, 12, 16, 5, 10, 8 re-ranked');
  assert.equal(MP.ratings, undefined, 'no rating: only the old 18 holes were rated');
  assert.match(MP.notes, /2 November 2026/);
});

test('a card is 9, 10, 12 or 18 holes: a 10-hole course is not an 18-hole card with 8 missing', () => {
  assert.equal(app.E(`cardSize(course('c_moorepark').holes)`), 10);
  assert.equal(app.E(`fullCard(course('c_moorepark').holes).length`), 10);
  assert.deepEqual(app.J(`missingHoles(course('c_moorepark').holes)`), [], 'nothing missing');
  assert.equal(app.E(`cardSize(course('c_nine').holes)`), 9);
  assert.equal(app.E(`cardSize(course('c_full').holes)`), 18);
  assert.equal(app.E(`cardSize([])`), 18, 'a new course starts as 18');
  assert.equal(app.E(`cardSize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ n: n === 10 ? 12 : n, par: 4 })))`), 18, 'ten holes that are not 1..10 is an 18-hole card with gaps');
  assert.equal(app.E(`cardSize(Array.from({ length: 12 }, (_, i) => ({ n: i + 1, par: 4 })))`), 12);
  assert.equal(app.E(`cardSize(Array.from({ length: 11 }, (_, i) => ({ n: i + 1, par: 4 })))`), 18, '11 is not a card size');
  app.go('courses', { courseId: 'c_moorepark' });
  assert.doesNotMatch(app.text('#view'), /missing/i, 'the course page does not ask for holes 11–18');
  assert.equal(app.$$('#view .tile').length, 10);
});

test('the course form shows the 10 holes and keeps the card at 10 on save', async () => {
  app.act('editCourse', { id: 'c_moorepark' });
  assert.equal(app.$('#sheetInner [data-holes="10"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(app.$$('#sheetInner [data-holes]').map(b => b.dataset.holes), ['9', '10', '12', '18']);
  assert.equal(app.field('par_10').value, '3');
  assert.equal(app.field('par_11'), null);
  assert.match(app.text('#sheetInner'), /for 10 holes/, 'the ratings hint says the card is 10 holes');
  app.fill('notes', MP.notes + ' Edited.');
  assert.equal(await app.save(), true);
  await app.waitFor(() => /Edited\.$/.test(app.E(`course('c_moorepark').notes`)), { what: 'saved' });
  const c = await app.api.get('courses', 'c_moorepark');
  assert.equal(c.holes.length, 10);
  assert.deepEqual(c.holes.map(h => h.tees.red), MP.holes.map(h => h.tees.red), 'the other tee sets survive the edit');
  assert.deepEqual(c.holes.map(h => h.si), MP.holes.map(h => h.si));
});

test('a round there prefills 10 holes, scores as 10, and is honest about the handicap', async () => {
  app.go('rounds');
  app.act('newRound');
  app.fill('courseId', 'c_moorepark'); app.$('#sheetInner [name=courseId]').dispatchEvent(new app.win.Event('change'));
  assert.equal(app.$('#sheetInner [data-holes="10"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.field('par_10').value, '3'); assert.equal(app.field('s_11'), null);
  for (let i = 1; i <= 10; i++) app.fill(`s_${i}`, MP.holes[i - 1].par + 1);
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`S.sessions.some(s => s.courseId === 'c_moorepark')`), { what: 'round' });
  const r = app.J(`S.sessions.find(s => s.courseId === 'c_moorepark')`);
  assert.equal(r.holes.length, 10);
  const st = app.J(`roundStats(S.sessions.find(s => s.courseId === 'c_moorepark'))`);
  assert.deepEqual([st.holes, st.gross, st.toPar], [10, 48, 10]);
  app.go('rounds', { sessionId: r.id });
  assert.equal(app.$$('#scorecard table').length, 2, 'a nine and the tenth');
  assert.match(app.text('#scorecard'), /Out[\s\S]*In/);
  app.go('overview');
  assert.match(app.text('#view'), /10 holes/, 'a 10-hole score is labelled, never read as 18');
  const left = app.J(`handicap().left`).find(x => x.r.id === r.id);
  assert.equal(left && left.why, 'the scorecard has 10 holes, and only 9- and 18-hole cards are rated', 'listed as not counting, with the reason');
  assert.match(app.text('#hcpLeft'), /Moore Park Golf.*10 holes, and only 9- and 18-hole cards are rated/);
});
