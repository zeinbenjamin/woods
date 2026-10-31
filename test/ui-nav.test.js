// Back goes where he came from (2.61.0, he asked: "the back button should reflect the page the user was
// previously on, not just the default of origination"). Walked through the real pages and links: each way
// into a round, a session, a block, a finding, a course, Settings and the swing feed, then back; sideways
// steps between holes; a trail that comes round in a circle; a tab starting afresh; a deleted page skipped;
// folds and the page left as they were. And the Swings tab's card: Play video, and the measured body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

// Down the line, as in ui-pose: address, top, impact, finish over 16 frames.
const blank = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0.1]);
const joints = pts => { const j = blank(); for (const [i, x, y] of pts) j[i] = [x, y, 0.99]; return j; };
const D_ADDR = [[0, 0.62, 0.30], [11, 0.555, 0.355], [12, 0.555, 0.355], [15, 0.60, 0.62], [16, 0.60, 0.62], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const D_TOP = [[0, 0.61, 0.30], [11, 0.54, 0.36], [12, 0.54, 0.36], [15, 0.42, 0.22], [16, 0.42, 0.22], [23, 0.455, 0.60], [24, 0.455, 0.60]];
const D_IMP = [[0, 0.61, 0.29], [11, 0.555, 0.34], [12, 0.555, 0.34], [15, 0.62, 0.64], [16, 0.62, 0.64], [23, 0.485, 0.60], [24, 0.485, 0.60]];
const D_FIN = [[0, 0.52, 0.28], [11, 0.50, 0.33], [12, 0.50, 0.33], [15, 0.40, 0.18], [16, 0.40, 0.18], [23, 0.47, 0.58], [24, 0.47, 0.58]];
function frames16() {
  const k = [[0, D_ADDR], [7, D_TOP], [11, D_IMP], [15, D_FIN]], out = [];
  for (let f = 0; f < 16; f++) {
    let s = 0; while (s < 3 && f > k[s + 1][0]) s++;
    const [fa, A] = k[s], [fb, B] = k[Math.min(3, s + 1)], t = fb === fa ? 0 : (f - fa) / (fb - fa), ja = joints(A), jb = joints(B);
    out.push(ja.map((p, i) => [p[0] + (jb[i][0] - p[0]) * t, p[1] + (jb[i][1] - p[1]) * t, ja[i][2]]));
  }
  return out;
}
const fr = pre => Array.from({ length: 16 }, (_, i) => ({ asset: `${pre}${i}`, t: +(0.05 + i * 0.1).toFixed(2) }));
const reading = { one_thing: 'Keep your chest over the ball', why: 'w', feel: 'f', drill: { name: 'D', how: 'h' }, check: 'c', ball_data: 'agrees', observations: [], cannot_tell: [] };
const shots = n => Array.from({ length: n }, (_, i) => ({ carry: 110 + i, total: 120 + i }));

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('7i', 'iron', { order: 4 }), club('5i', 'iron', { order: 3 })],
    courses: [{ id: 'c_a', v: 2, name: 'Alpha GC', tee: 'white', holes: card(9), lat: -33.9, lng: 151.1 }, { id: 'c_b', v: 2, name: 'Beta GC', tee: 'white', holes: card(9), lat: -33.95, lng: 151.15 }],
    sessions: [
      { id: 'r_a', v: 2, type: 'round', date: '2026-10-20', courseId: 'c_a', courseName: 'Alpha GC', tee: 'white', detail: 'score_only', holes: card(9).map(({ n, par, metres }) => ({ n, par, metres, strokes: par + 1 })),
        swings: [{ id: 'sw_r', view: 'dtl', club: '7i', frames: fr('r'), video: 'vid_r', analysis: reading, addedOn: '2026-10-20',
          pose: { by: 'test', on: '2026-10-20', aspect: 0.5625, frames: frames16().map((j, i) => ({ asset: `r${i}`, t: +(0.05 + i * 0.1).toFixed(2), j })) } }] },
      { id: 'r_b', v: 2, type: 'round', date: '2026-10-10', courseId: 'c_b', courseName: 'Beta GC', tee: 'white', detail: 'score_only', holes: card(9).map(({ n, par, metres }) => ({ n, par, metres, strokes: par })) },
      { id: 's_r', v: 2, type: 'range', date: '2026-10-15', venue: 'Moore Park', blocks: [{ id: 'b_7', seq: 1, club: '7i', target: 110, swing: 'full', shots: shots(6) }],
        swings: [{ id: 'sw_s', view: 'face', club: '7i', frames: fr('s'), addedOn: '2026-10-15' }] },
    ] } });
  await app.waitFor(() => app.E('S.sessions.length') === 3 && app.E('S.courses.length') === 2, { what: 'seeded' });
});
after(() => app && app.stop());

const backBtn = () => app.$('#view .back button');
const backText = () => (backBtn() || {}).textContent;
const here = () => app.J('[S.tab, S.sub]');
const tab = t => app.$(`nav.tabs button[data-tab="${t}"]`).click();
const goLink = sel => { const a = app.$(sel); assert.ok(a, `no ${sel}`); a.click(); };

test('with no trail, a page goes back to its parent, as before', () => {
  tab('rounds'); app.E(`go('rounds', { sessionId: 'r_a' }, { nav: 'reset' })`);
  assert.equal(backText(), '‹ Rounds');
  backBtn().click();
  assert.deepEqual(here(), ['rounds', null]);
});

test('a round opened from the Swings tab goes back to the Swings tab, not to Rounds', () => {
  tab('swings');
  app.$('#swingTimeline .swrow[data-wid="sw_r"]').click();
  assert.ok(app.sheetOpen());
  app.$('#sheetInner [data-act="reelOpen"]').click();
  assert.deepEqual(here(), ['rounds', { sessionId: 'r_a' }]);
  assert.equal(backText(), '‹ Swings');
  backBtn().click();
  assert.deepEqual(here(), ['swings', null]);
  // the session too
  app.$('#swingTimeline .swrow[data-wid="sw_s"]').click();
  app.$('#sheetInner [data-act="reelOpen"]').click();
  assert.deepEqual(here(), ['range', { sessionId: 's_r' }]);
  assert.equal(backText(), '‹ Swings');
});

test('a finding opened from the Overview goes back to the Overview, and the fold he had open is open again', () => {
  tab('overview');
  const fold = app.$('#view details.fold[id]'); assert.ok(fold, 'a fold on the Overview'); fold.open = true;
  goLink('#view [data-go^="range:goal="]');
  assert.equal(app.E('S.tab'), 'range'); assert.ok(app.E('S.sub.goal'));
  assert.equal(backText(), '‹ Overview');
  backBtn().click();
  assert.deepEqual(here(), ['overview', null]);
  assert.ok(app.$(`#${fold.id}`).open, 'the fold is as he left it');
});

test('range: list → session → block and back the same way; a block opened from its finding goes back to the finding', () => {
  tab('range');
  app.E(`go('range', { sessionId: 's_r' })`);
  assert.equal(backText(), '‹ Range');
  goLink('#view [data-go="range:blockId:b_7"]');
  assert.equal(backText(), '‹ 15 Oct 2026');
  backBtn().click(); assert.deepEqual(here(), ['range', { sessionId: 's_r' }]);
  backBtn().click(); assert.deepEqual(here(), ['range', null]);
  // from a finding's page (its range blocks link to the block)
  const key = app.E(`rankedPractice().now[0].key`);
  app.E(`go('range', { goal: ${JSON.stringify('KEY')} })`.replace('KEY', key));
  const name = app.text('#view h1');
  app.E(`go('range', { blockId: 'b_7' })`);
  assert.equal(backText(), `‹ ${name}`);
});

test('hole to hole is a step, not a stack: back from any hole is the round, then where the round was opened from', () => {
  tab('courses');
  app.E(`go('courses', { courseId: 'c_a' })`);
  goLink('#view [data-go^="rounds:sessionId=r_a"], #view [data-go="rounds:sessionId:r_a"]');
  assert.equal(backText(), '‹ Alpha GC', 'the round goes back to the course it was opened from');
  app.E(`go('rounds', { sessionId: 'r_a', hole: 1 })`);
  assert.equal(backText(), '‹ Alpha GC', 'the hole goes back to its round (named for its course)');
  app.E(`go('rounds', { sessionId: 'r_a', hole: 2 })`); app.E(`go('rounds', { sessionId: 'r_a', hole: 3 })`);
  backBtn().click(); assert.deepEqual(here(), ['rounds', { sessionId: 'r_a' }], 'hole 3 → the round, not hole 2');
  backBtn().click(); assert.deepEqual(here(), ['courses', { courseId: 'c_a' }]);
  assert.equal(backText(), '‹ Courses');
});

test('a trail that comes round in a circle returns rather than growing', () => {
  tab('rounds');
  app.E(`go('rounds', { sessionId: 'r_a' })`);
  app.E(`go('courses', { courseId: 'c_a' })`);
  app.E(`go('rounds', { sessionId: 'r_a' })`);   // the same round again, by a link
  assert.equal(backText(), '‹ Rounds', 'back from the round is where the round was first opened from, not the course');
  assert.equal(app.J('navStack.length'), 1);
});

test('a tab starts afresh, Settings goes back to the page the gear was tapped on, and Play\'s finish does not stack', () => {
  tab('swings'); app.E(`go('rounds', { sessionId: 'r_b' })`);
  assert.equal(backText(), '‹ Swings');
  tab('rounds'); app.E(`go('rounds', { sessionId: 'r_b' })`);
  assert.equal(backText(), '‹ Rounds', 'the Rounds tab tapped: a new trail');
  app.$('#settingsBtn').click();
  assert.equal(app.E('S.tab'), 'settings');
  assert.equal(backText(), '‹ Beta GC');
  backBtn().click(); assert.deepEqual(here(), ['rounds', { sessionId: 'r_b' }]);
  app.E(`go('settings', null, { nav: 'reset' })`);
  assert.equal(backBtn(), null, 'opened as a tab with nothing behind it: no back');
  // Play: Rounds → play → finish → the round, whose back is Rounds (the play page isn't one to return to)
  tab('rounds'); app.E(`go('rounds', { sessionId: 'r_b', play: '1', hole: '1' })`);
  app.E(`ACTIONS.finishPlay({ sid: 'r_b' })`);
  assert.deepEqual(here(), ['rounds', { sessionId: 'r_b' }]);
  assert.equal(backText(), '‹ Rounds');
});

test('the swing feed\'s chevron goes back to where the feed was opened; a deleted page in the trail is skipped', async () => {
  tab('swings'); app.E(`go('swings', { view: 'reels' })`);
  app.$('#reels .reelsClose').click();
  assert.deepEqual(here(), ['swings', null]);
  // Swings → a round → a hole; the round is deleted from elsewhere: back from the hole skips it
  app.E(`go('rounds', { sessionId: 'r_b' })`); app.E(`go('rounds', { sessionId: 'r_b', hole: 1 })`);
  app.E(`go('range', { sessionId: 's_r' })`);
  await app.api.del('sessions', 'r_b');
  await app.waitFor(() => !app.E(`session('r_b')`), { what: 'round gone' });
  assert.equal(backText(), '‹ Swings', 'the gone round and its hole are skipped');
});

test('the Swings tab\'s card: Play video at the top right plays the clip in the card; the measured body follows the reading, read-only', () => {
  tab('swings');
  app.$('#swingTimeline .swrow[data-wid="sw_r"]').click();
  const head = app.$('#sheetInner .spread');
  assert.ok(head.querySelector('h2') && head.lastElementChild.id === 'reelPlay', 'the button sits to the right of the heading');
  assert.equal(app.text('#reelPlay'), 'Play video');
  app.$('#reelPlay').click();
  const v = app.$('#reelVideo video');
  assert.ok(v && v.getAttribute('src') === '/_blob/vid_r' && v.hasAttribute('controls') && v.hasAttribute('playsinline'));
  assert.equal(app.text('#reelPlay'), 'Hide video');
  app.$('#reelPlay').click();
  assert.equal(app.$('#reelVideo video'), null);
  // the body: positions, measures, Across the swing; nothing to measure with, and no id shared with a page
  const pose = app.$('#reelPose');
  assert.ok(pose && app.$('#reelCard').compareDocumentPosition(pose) & 4, 'after the reading');
  assert.equal(pose.querySelectorAll('.posePos figure').length, 4);
  assert.match(pose.textContent, /The body, measured 16 of 16 frames/);
  assert.ok(pose.querySelector('#rc_ptr_sw_r .traxis'), 'Across the swing, its ids prefixed');
  assert.equal(pose.querySelectorAll('[data-act="measureSwing"]').length, 0, 'read-only');
  assert.equal(app.$$('#sheetInner [id]').filter(e => e.id.startsWith('pose_') || e.id.startsWith('ptr_')).length, 0);
  app.$('#sheetInner [data-close]').click();
  // a swing with no video and no measured body
  app.$('#swingTimeline .swrow[data-wid="sw_s"]').click();
  assert.equal(app.$('#reelPlay'), null, 'no video, no button');
  assert.match(app.text('#sheetInner'), /The body isn't measured on this swing yet: Analyse on its session's page measures it/);
  app.$('#sheetInner [data-close]').click();
});

test('deleting a page returns to the page before it, not its parent', async () => {
  // A block opened straight from a course page (not its session): deleted, it returns to the course.
  tab('courses'); app.E(`go('courses', { courseId: 'c_a' })`);
  app.E(`go('range', { blockId: 'b_7' })`);
  app.$('#view [data-act="deleteBlock"]').click();
  await app.answer(true);
  await app.waitFor(() => !app.E(`S.sessions.find(s => s.id === 's_r').blocks.length`), { what: 'block deleted' });
  assert.deepEqual(here(), ['courses', { courseId: 'c_a' }], 'back where he was, not on the block\'s session');
  assert.equal(backText(), '‹ Courses');
  // A session deleted from its own page: back to where it was opened from.
  tab('swings'); app.E(`go('range', { sessionId: 's_r' })`);
  app.$('#view [data-act="deleteSession"]').click();
  await app.answer(true);
  await app.waitFor(() => !app.E(`session('s_r')`), { what: 'session deleted' });
  assert.deepEqual(here(), ['swings', null]);
});
