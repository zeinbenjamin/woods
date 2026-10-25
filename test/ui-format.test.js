// A round's format (2.15.0): a team round (Ambrose, best ball) is his card
// but not his game alone, so it is listed and labelled, and left out of the
// handicap, Current form, the scoring trend, course history and the
// practice evidence. Asked for after the Lane Cove Ambrose of 25 Oct 2026
// counted as a 9-hole handicap score about seven strokes better than his own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

const COURSE = { id: 'c_lc', v: 2, name: 'Lane Cove', tee: 'white', ratings: { white: { cr: 36, slope: 113 } }, holes: card(9, { par: [4, 3, 4], metres: [300, 140, 320] }) };
const holes = f => card(9, { par: [4, 3, 4], metres: [300, 140, 320] }).map((h, i) => ({ n: h.n, par: h.par, metres: h.metres, ...f(h, i) }));
const round = (id, date, strokesOver, extra = {}) => ({ id, v: 2, type: 'round', date, courseId: 'c_lc', courseName: 'Lane Cove', tee: 'white', detail: 'score_only', holes: holes(h => ({ strokes: h.par + strokesOver, putts: 2 })), ...extra });
let app;
before(async () => {
  app = await startApp({ seed: { clubs: [club('7i', 'iron')], courses: [COURSE], sessions: [
    round('r_solo1', '2026-10-04', 2),                                  // 51, his own
    round('r_solo2', '2026-10-11', 2),
    round('r_solo3', '2026-10-18', 2),
    round('r_team', '2026-10-25', -1, { format: 'ambrose', holes: holes(h => ({ strokes: h.par - 1, putts: 1, shots: [{ t: 0.5, u: 1.3, club: '7i', lie: 'water', penalty: true }, { t: 0.96, u: 0, club: '7i', lie: 'green' }] })) }),   // 24: the team's card
  ] } });
});
after(() => app && app.stop());

test('a team round is not a handicap score, and the list says why', () => {
  const hc = app.J('handicap()');
  assert.deepEqual(hc.scores.flatMap(s => s.rounds.map(r => r.id)), ['r_solo1', 'r_solo2'], 'his first two nines pair into a score');
  assert.equal(hc.waiting && hc.waiting.rounds[0].id, 'r_solo3', 'the third waits for a nine to pair with: the team round is not it');
  assert.deepEqual(hc.left.map(x => [x.r.id, x.why]), [['r_team', "a team round (Ambrose) isn't a handicap score"]]);
  app.go('overview');
  assert.match(app.text('#hcpLeft'), /Lane Cove, 25 Oct 2026: a team round \(Ambrose\) isn't a handicap score/);
});

test('Current form, the trend and course history use his own rounds; the team round is listed and labelled', () => {
  app.go('overview');
  assert.match(app.text('#formTiles'), /51\+18.*Lane Cove, 18 Oct 2026/s, 'last score is his last solo round, not the 24');
  assert.doesNotMatch(app.text('#view .trend'), /−9/, 'no team bar on the trend');
  assert.match(app.text('#recentList'), /25 Oct 2026 · Lane Cove · 24/, 'Recent still lists it');
  assert.equal(app.J('puttingStats().holes'), 27, 'putts from the three solo rounds, not the team one');
  assert.equal(app.J('shotRecords().length'), 0, 'the team round\'s traced shots are not evidence');
  assert.equal(app.J("practiceItems().find(x => x.key === 'penalty') || null"), null, 'its penalty makes no practice item');
  app.go('rounds');
  const item = app.$$('#view .item').find(b => /25 Oct 2026/.test(b.textContent));
  assert.match(item.textContent, /Ambrose/);
  app.go('courses', { courseId: 'c_lc' });
  assert.equal(app.$$('#view .item').filter(b => /Lane Cove/.test(b.textContent)).length, 4, 'all four in Rounds here');
  app.go('courses', { courseId: 'c_lc', hole: '1' });
  assert.match(app.text('#view'), /3played/, 'hole history counts his three');
  app.go('rounds', { sessionId: 'r_team' });
  assert.match(app.text('#teamNote'), /A team round \(Ambrose\): kept and shown here, but not counted/);
});

test('the format is set on the round form, and clearing it back to solo removes the field', async () => {
  app.act('editRound', { id: 'r_solo3' });
  assert.equal(app.field('format').value, 'solo');
  app.fill('format', 'bestball');
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`session('r_solo3').format`) === 'bestball', { what: 'saved' });
  assert.equal(app.J('handicap().left').length, 2);
  app.act('editRound', { id: 'r_solo3' });
  app.fill('format', 'solo');
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`session('r_solo3').format`) === undefined, { what: 'solo again: no field stored' });
  assert.equal(app.J('handicap().left').length, 1);
});
