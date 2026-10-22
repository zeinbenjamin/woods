// Pasting a scorecard into the course form (2.8.0), with the hole-maps chat's
// Hurstville note as the input, word for word: the card fills from it, the tee
// it names is set, everything the card doesn't own survives the save, and the
// rounds there are offered the new pars (asked, scores untouched).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

const NOTE = `Source: Zein's GPS app screenshots, 2026-10-21, blue tees, metres. Par 70, 5,278 m.
Hole: par / blue metres / stroke index
1: 4 / 260 / 16    10: 4 / 296 / 14
2: 3 / 134 / 17    11: 3 / 117 / 18
3: 3 / 132 / 13    12: 5 / 434 / 11
4: 4 / 342 / 6     13: 3 / 162 / 4
5: 4 / 288 / 10    14: 4 / 290 / 7
6: 5 / 538 / 5     15: 4 / 376 / 2
7: 3 / 112 / 15    16: 5 / 486 / 12
8: 4 / 382 / 1     17: 5 / 496 / 3
9: 3 / 148 / 8     18: 4 / 285 / 9`;
const NEW = { par: [4, 3, 3, 4, 4, 5, 3, 4, 3, 4, 3, 5, 3, 4, 4, 5, 5, 4], m: [260, 134, 132, 342, 288, 538, 112, 382, 148, 296, 117, 434, 162, 290, 376, 486, 496, 285], si: [16, 17, 13, 6, 10, 5, 15, 1, 8, 14, 18, 11, 4, 7, 2, 12, 3, 9] };
// The record as it might stand: the old, par 70 card in the old numbering, white primary, red too.
const OLD = { par: [4, 3, 5, 3, 4, 4, 5, 5, 4, 4, 3, 3, 4, 4, 5, 3, 4, 3], white: [308, 115, 462, 168, 304, 400, 458, 523, 347, 284, 146, 137, 310, 314, 573, 119, 319, 160], red: [290, 117, 435, 166, 288, 378, 439, 492, 322, 266, 135, 134, 395, 281, 488, 112, 379, 149] };
const mark = { k: 'flag', lat: -33.9725, lng: 151.0609, acc: 4, at: '2026-10-21T01:00:00.000Z', by: 'zein@example.com' };
const HURST = { id: 'c_hurst', v: 2, name: 'Hurstville Golf Club', tee: 'white', lat: -33.9725, lng: 151.0609, map: { id: 'hurstville', linked: '2026-10-21' },
  ratings: { white: { cr: 67.5, slope: 118 } }, notes: 'Peakhurst',
  holes: OLD.par.map((par, i) => ({ n: i + 1, par, metres: OLD.white[i], tees: { white: OLD.white[i], red: OLD.red[i] }, ...(i === 0 ? { marks: [mark] } : {}) })) };
// Today's round, scored as he played the holes, against the old card's pars.
const strokes = [5, 4, 4, 5, 5, 6, 4, 5, 4, 5, 4, 6, 4, 5, 5, 6, 6, 5];
const ROUND = { id: 'r_h', v: 2, type: 'round', date: '2026-10-21', courseId: 'c_hurst', courseName: 'Hurstville Golf Club', tee: 'blue', detail: 'score_only',
  holes: OLD.par.map((par, i) => ({ n: i + 1, par, metres: OLD.white[i], strokes: strokes[i] })) };

let app;
before(async () => { app = await startApp({ seed: { clubs: [club('7i', 'iron')], courses: [HURST], sessions: [ROUND] } }); });
after(() => app && app.stop());
const fillFrom = text => { app.fill('cardText', text); app.click('#cardFill'); };

test('a card that doesn\'t read cleanly fills nothing, and says why', () => {
  app.act('editCourse', { id: 'c_hurst' });
  const before = app.field('par_3').value;
  fillFrom('1: 4 / 260 / 16\n2: 3 / 134\n2: 3 / 140\n3: 7 / 132 / 13');
  assert.equal(app.text('#cardFillNote'), 'Not filled: hole 2 is there twice; hole 3: par 7?; no line for holes 4, 5, 6, 7, 8, 9.');
  assert.equal(app.field('par_3').value, before, 'nothing changed');
  fillFrom('the 7th is a long one');
  assert.match(app.text('#cardFillNote'), /no "n: par \/ metres" lines found/);
  app.click('#sheetInner [data-close]');
});

test('the note fills the card, and the tee it names; the other tee sets are pointed out, not touched', () => {
  app.act('editCourse', { id: 'c_hurst' });
  fillFrom(NOTE);
  assert.equal(app.text('#cardFillNote'), 'Filled 18 holes from the blue tees: par 70, 5,278 m. Check them, then Save. The white and red lengths on this course aren\'t changed by this; check them against the same card.');
  assert.equal(app.field('tee').value, 'blue');
  for (let n = 1; n <= 18; n++) assert.deepEqual([+app.field('par_' + n).value, +app.field('m_' + n).value, +app.field('si_' + n).value], [NEW.par[n - 1], NEW.m[n - 1], NEW.si[n - 1]], `hole ${n}`);
});

test('saving keeps everything the card doesn\'t own, then offers the rounds there the new pars', async () => {
  const done = app.save();
  await app.answer(true);           // "1 round at Hurstville has a different par on holes …: use this card's pars?"
  await done;
  await app.waitFor(async () => (await app.api.get('courses', 'c_hurst')).tee === 'blue', { what: 'course saved' });
  const c = await app.api.get('courses', 'c_hurst');
  assert.deepEqual(c.holes.map(h => [h.par, h.tees.blue, h.si]), NEW.par.map((p, i) => [p, NEW.m[i], NEW.si[i]]));
  assert.deepEqual(c.holes.map(h => h.tees.white), OLD.white, 'white left as it was, for him to check');
  assert.deepEqual(c.holes.map(h => h.tees.red), OLD.red);
  assert.deepEqual([c.map, c.ratings, c.notes, c.lat], [HURST.map, HURST.ratings, 'Peakhurst', -33.9725], 'map link, ratings, notes, location kept');
  assert.deepEqual(c.holes[0].marks.map(m => m.at), [mark.at], 'GPS marks kept');
  await app.waitFor(async () => (await app.api.get('sessions', 'r_h')).holes[2].par === 3, { what: 'round pars updated' });
  const r = await app.api.get('sessions', 'r_h');
  assert.deepEqual(r.holes.map(h => h.par), NEW.par);
  assert.deepEqual(r.holes.map(h => h.strokes), strokes, 'scores untouched');
  assert.match(app.toast(), /Pars updated on 1 round/);
});

test('an edit that changes no par doesn\'t ask about old rounds', async () => {
  // A round that still differs from the card, so there would be something to ask about.
  await app.api.put('sessions', 'r_old', { ...ROUND, id: 'r_old', date: '2026-09-01' });
  await app.waitFor(() => app.E(`!!session('r_old')`), { what: 'round arrives' });
  app.act('editCourse', { id: 'c_hurst' });
  app.fill('notes', 'Peakhurst. Renumbered 2023.');
  assert.equal(await app.save(), true);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(app.confirmOpen(), false);
});
