// Past rounds from screenshots (2.48.0). Claude's replies are stubbed at
// /api/analyse, hand-made from two real 18Birdies summary screens he sent on
// 2026-10-30 (Lane Cove 09/05/2026: 5 5 3 5 5 6 7 6 4 = 46, blue tee; Bexley
// 14/05/2026: 123, 63 out and 60 in, blue 4109 m) plus a made-up full scorecard
// for the Bexley round with putts, and a handicap chart that isn't a round.
// Each fake screenshot carries a word the stub picks its reply by; everything
// else (the review sheet, the save, the stored screenshots) is the real app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, card } from './harness.js';

const BEX = JSON.parse(readFileSync('imports/bexley.json', 'utf8')).courses[0];
const LC = { id: 'c_lanecove', v: 2, name: 'Lane Cove Golf Course', tee: 'blue', holes: card(9, { tee: 'blue', par: [4, 4, 4, 3, 3, 3, 3, 3, 3] }) };
const BEX_SCORES = [11, 7, 5, 8, 6, 6, 7, 7, 6, 5, 4, 7, 6, 5, 10, 5, 10, 8];
const REPLIES = {
  lanecove: { kind: 'summary', app: '18Birdies', date: '09/05/2026', club: 'Lane Cove Golf Club', course: 'Lane Cove', tee: 'Blue', coursePar: 30, gross: 46, nineTotals: [46], player: 'Zein B.',
    holes: [5, 5, 3, 5, 5, 6, 7, 6, 4].map((score, i) => ({ n: i + 1, score, putts: null, par: null })) },
  bexley: { kind: 'summary', app: '18Birdies', date: '14/05/2026', club: 'Bexley Golf Club', course: 'Bexley', tee: 'Blue', teeLength: 4109, teeUnits: 'm', coursePar: 64, gross: 123, nineTotals: [63, 60], player: 'Zein B.',
    holes: BEX_SCORES.map((score, i) => ({ n: i + 1, score })) },
  bexcard: { kind: 'scorecard', app: '18Birdies', date: '14/05/2026', club: 'Bexley Golf Club', course: 'Bexley', tee: 'Blue', player: 'Zein B.',
    holes: BEX_SCORES.map((score, i) => ({ n: i + 1, score, putts: i === 0 ? 3 : 2 })) },
  chart: { kind: 'other', holes: [] },
};
let app, calls = [];
before(async () => {
  app = await startApp({
    seed: { clubs: [], courses: [BEX, LC], sessions: [] },
    intercept: async (url, o) => {
      if (!url.endsWith('/api/analyse')) return null;
      const body = JSON.parse(o.body), word = Buffer.from(body.images[0].data, 'base64').toString();
      calls.push({ word, prompt: body.prompt, n: body.images.length });
      return new Response(JSON.stringify({ text: '', json: REPLIES[word], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
});
after(() => app && app.stop());

const png = word => new app.win.File([word], word + '.png', { type: 'image/png' });
async function readScreens(words) {
  app.go('rounds');
  app.click('#addPastRound');
  app.click('#roundsFromImages');
  Object.defineProperty(app.field('imgs'), 'files', { value: words.map(png) });
  app.$('#sheetInner [data-save]').click();
  await app.waitFor(() => app.$('#sheetInner .readround') || /No rounds/.test(app.text('#readNote')), { what: 'read finished' });
}

test('reading: day-first dates, the course and tee matched to Carry, totals checked, nothing smoothed over', () => {
  const n = raw => app.J(`normaliseRoundRead(${JSON.stringify(raw)})`);
  const lc = n(REPLIES.lanecove);
  assert.equal(lc.date, '2026-05-09', '09/05/2026 is 9 May, as an Australian phone shows it');
  assert.equal(lc.courseId, 'c_lanecove', '"Lane Cove Golf Club" / "Lane Cove" is the Lane Cove Golf Course in Carry');
  assert.equal(lc.tee, 'blue', '"Blue" is the card\'s blue');
  assert.deepEqual(lc.warnings, []);
  const bad = n({ ...REPLIES.bexley, gross: 120, nineTotals: [63, 61], holes: [...REPLIES.bexley.holes.slice(0, 17), { n: 18, score: 40 }] });
  assert.equal(bad.courseId, BEX.id);
  assert.equal(bad.holes.length, 17, 'an implausible score is left out, never kept');
  assert.ok(bad.warnings.some(w => /Hole 18 left out: 40/.test(w)));
  assert.ok(bad.warnings.some(w => /add to 115, the screen's total says 120/.test(w)), 'the holes against the screen\'s total');
  assert.ok(bad.warnings.some(w => /Holes 10–17 add to 52, the screen's row total says 61/.test(w)));
  const odd = n({ ...REPLIES.lanecove, date: '31/02/2026', club: 'Royal Nowhere', course: 'Nowhere', coursePar: 72 });
  assert.equal(odd.date, null); assert.ok(odd.warnings.some(w => /31\/02\/2026" couldn't be read as a day/.test(w)));
  assert.equal(odd.courseId, ''); assert.ok(odd.warnings.some(w => /No course in Carry matches "Royal Nowhere \/ Nowhere"/.test(w)));
  const par = n({ ...REPLIES.lanecove, coursePar: 34, tee: 'Gold' });
  assert.ok(par.warnings.some(w => /course par as 34; Carry's card says 30/.test(w)));
  assert.ok(par.warnings.some(w => /says the Gold tee/.test(w)) && par.tee === 'blue', 'a tee the card lacks falls back to its primary, and says so');
});

test('screenshots → one round each, a scorecard joining its summary, the rest named; checked, then saved', async () => {
  await readScreens(['lanecove', 'bexley', 'bexcard', 'chart']);
  assert.equal(calls.length, 4, 'one reading per screenshot');
  assert.ok(calls.every(c => c.n === 1) && /read only the first golfer's scores/.test(calls[0].prompt));
  assert.equal(app.$$('#sheetInner .readround').length, 2, 'the Bexley scorecard joined its summary');
  assert.match(app.text('#roundSkipped'), /chart\.png \(not a round summary or scorecard\)/);
  assert.equal(app.field('scores_0').value, '1-9: 5 5 3 5 5 6 7 6 4');
  assert.equal(app.field('scores_1').value, '1-9: 11 7 5 8 6 6 7 7 6\n10-18: 5 4 7 6 5 10 5 10 8');
  assert.equal(app.field('putts_1').value, '1-9: 3 2 2 2 2 2 2 2 2\n10-18: 2 2 2 2 2 2 2 2 2', 'putts from the full scorecard');
  assert.equal(app.field('putts_0'), null, 'none read, none asked');
  assert.match(app.text('#sheetInner [data-rcount="0"]'), /9 holes, 46 strokes \(the screen says 46\), \+16 on Carry's par 30/);
  assert.match(app.text('#sheetInner [data-rcount="1"]'), /18 holes, 123 strokes \(the screen says 123\), \+59 on Carry's par 64/);
  assert.equal(app.$$('#sheetInner .readround')[1].querySelectorAll('img').length, 2, 'both Bexley screenshots beside it');
  // A typing slip is refused, not guessed at.
  const ta = app.field('scores_0'); ta.value = '1-9: 5 5 3 5 5 6 7 6'; ta.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  assert.match(app.text('#sheetInner [data-rcount="0"]'), /Can't read/);
  ta.value = '1-9: 5 5 3 5 5 6 7 6 4'; ta.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  app.$('#sheetInner [data-save]').click();
  await app.waitFor(async () => (await app.api.list('sessions')).length === 2, { what: 'two rounds saved' });
  const rounds = await app.api.list('sessions'), lc = rounds.find(r => r.courseId === 'c_lanecove'), bx = rounds.find(r => r.courseId === BEX.id);
  assert.deepEqual([lc.date, lc.tee, lc.detail, lc.courseName], ['2026-05-09', 'blue', 'score_only', 'Lane Cove Golf Course']);
  assert.deepEqual(lc.holes.map(h => h.strokes), [5, 5, 3, 5, 5, 6, 7, 6, 4]);
  assert.deepEqual(lc.holes.map(h => h.par), [4, 4, 4, 3, 3, 3, 3, 3, 3], 'pars from Carry\'s card, never the screenshot');
  assert.equal(bx.holes[0].metres, BEX.holes[0].tees.blue, 'lengths from the blue tee on the card');
  assert.deepEqual([bx.holes[0].putts, bx.holes[17].putts], [3, 2]);
  assert.equal(lc.fromImages.assets.length, 1); assert.equal(bx.fromImages.assets.length, 2);
  assert.equal(bx.fromImages.app, '18Birdies');
  assert.deepEqual(app.J(`sessionAssets(session('${bx.id}'))`), bx.fromImages.assets, 'exported and released with the round');
  app.go('rounds', { sessionId: bx.id });
  assert.match(app.text('#roundSource'), /Read from 2 screenshots of 18Birdies/);
  assert.equal(app.$$('#roundSource img').length, 2);
  assert.match(app.text('#view'), /123/);
});

test('a round already in Carry for that course and day comes unticked, and a course Carry lacks must be picked', () => {
  const m = app.J(`mergeRoundReads([{ name: 'a.png', read: normaliseRoundRead(${JSON.stringify(REPLIES.lanecove)}) }, { name: 'b.png', read: normaliseRoundRead(${JSON.stringify({ ...REPLIES.lanecove, club: 'Nowhere GC', course: 'Nowhere', date: '01/06/2026' })}) }])`);
  assert.equal(m.rounds.length, 2);
  assert.equal(m.rounds[0].dupe, true); assert.ok(m.rounds[0].warnings.some(w => /already have a round here on this day/.test(w)));
  assert.equal(m.rounds[1].courseId, '');
});

test('the Rounds heading has Play and one button for a past round, which offers typing it in or screenshots', () => {
  // 2.50.0, he found the top crowded on his phone: two buttons and a link became one.
  app.go('rounds');
  const head = app.$('#view h1').parentElement;
  assert.deepEqual(app.$$('button', head).map(b => [b.id, b.textContent]), [['addPastRound', 'Add past round'], ['playOpen', 'Play']]);
  assert.equal(app.$('#playOpen').dataset.act, 'startPlay');
  assert.ok(!app.$('#view #roundsFromImages'), 'screenshots are in the sheet, not on the page');
  app.click('#addPastRound');
  assert.deepEqual(app.$$('#sheetInner .choice b').map(b => b.textContent), ['Type it in', 'From screenshots']);
  app.click('#sheetInner [data-act="newRound"]');
  assert.ok(app.$('#sheetInner [name=courseId]'), 'Type it in opens the round form');
  assert.ok(app.$('#sheetInner [data-save]'));
  app.$('#sheetInner [data-close]').click();
});
