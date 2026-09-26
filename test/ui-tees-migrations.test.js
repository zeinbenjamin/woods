// Schema v1 → v2 migrations (run by the page on load, written back to
// SQLite) and tee sets: a hole's distance resolves through the tee the
// round was played off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sleep } from './harness.js';

const art = { asset: 'c'.repeat(32), w: 540, h: 900, tee: [270, 810], green: [270, 108], gr: 30 };
const stamps = async app => (await fetch(`${app.base}/api/stamps`)).json();

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [],
    courses: [
      // v1 shapes: no `v`, no `tees`, maybe a teeName.
      { id: 'c_v1', name: 'Old Card GC', holes: [{ n: 1, par: 4, metres: 310, art }, { n: 2, par: 3, metres: 150, si: 18 }, { n: 3, par: 5 }] },
      { id: 'c_v1b', name: 'Blue Only GC', teeName: 'blue', holes: [{ n: 1, par: 4, metres: 290 }] },
      // Already current: must be left alone.
      { id: 'c_tees', v: 2, name: 'Two Tee GC', tee: 'white', holes: [
        { n: 1, par: 4, metres: 300, tees: { white: 300, blue: 320 } },
        { n: 2, par: 3, metres: 140, tees: { white: 140 } },
      ] },
    ],
    sessions: [
      { id: 'r_v1', type: 'round', date: '2026-03-01', courseId: 'c_v1', courseName: 'Old Card GC', holes: [{ n: 1, par: 4, metres: 310, strokes: 6 }] },
      { id: 'r_v1_nocourse', type: 'round', date: '2026-03-02', courseId: 'c_gone', courseName: 'Gone GC', holes: [{ n: 1, par: 4, metres: 280, strokes: 5 }] },
      { id: 's_v1', type: 'range', date: '2026-03-03', venue: 'Somewhere', blocks: [{ id: 'b1', seq: 1, club: '7i', summary: { n: 20, avgCarry: 100 } }] },
      { id: 'r_blue', v: 2, type: 'round', date: '2026-04-01', courseId: 'c_tees', courseName: 'Two Tee GC', tee: 'blue', detail: 'shot_level',
        holes: [{ n: 1, par: 4, metres: 300, shots: [{ t: 0.5, u: 0, club: '7i' }], strokes: 1 }, { n: 2, par: 3, metres: 140, strokes: 3 }] },
    ],
  } });
});
after(() => app && app.stop());

test('on load, v1 courses are migrated and written back to SQLite', async () => {
  const c = await app.api.get('courses', 'c_v1');
  assert.equal(c.v, 2);
  assert.equal(c.tee, 'white', 'no tee recorded → white');
  assert.deepEqual(c.holes[0].tees, { white: 310 });
  assert.deepEqual(c.holes[2].tees, {}, 'a hole with no distance gets an empty tee set, not a guessed one');
  const b = await app.api.get('courses', 'c_v1b');
  assert.equal(b.tee, 'blue', 'a v1 teeName becomes the primary tee');
  assert.deepEqual(b.holes[0].tees, { blue: 290 });
});

test('migration keeps artwork and every other hole field', async () => {
  const c = await app.api.get('courses', 'c_v1');
  assert.deepEqual(c.holes[0].art, art);
  assert.equal(c.holes[1].si, 18);
  assert.equal(c.holes[0].metres, 310, 'metres still mirrors the primary tee');
});

test('v1 rounds take their course\'s primary tee; a round whose course is gone gets null, not a guess', async () => {
  const r = await app.api.get('sessions', 'r_v1');
  assert.equal(r.v, 2);
  assert.equal(r.tee, 'white');
  assert.equal(r.holes[0].strokes, 6);
  const orphan = await app.api.get('sessions', 'r_v1_nocourse');
  assert.equal(orphan.v, 2);
  assert.equal(orphan.tee, null);
});

test('v1 range sessions are only re-versioned', async () => {
  const s = await app.api.get('sessions', 's_v1');
  assert.equal(s.v, 2);
  assert.deepEqual(s.blocks, [{ id: 'b1', seq: 1, club: '7i', summary: { n: 20, avgCarry: 100 } }]);
  assert.equal(s.venue, 'Somewhere');
});

test('migrations are idempotent: current documents are untouched, a second pass writes nothing', async () => {
  const c = await app.api.get('courses', 'c_tees');
  assert.equal(c.holes[0].tees.blue, 320);
  assert.equal(app.E(`migrateCourse(course('c_tees'))`), null);
  assert.equal(app.E(`migrateSession(session('r_v1'))`), null);
  const again = app.J(`migrateCourse(migrateCourse({ id: 'x', name: 'x', holes: [{ n: 1, par: 4, metres: 200 }] }))`);
  assert.equal(again, null, 'migrating a migrated course is a no-op');
  const s0 = await stamps(app);
  await app.E('runMigrations()');
  await sleep(200);
  assert.deepEqual(await stamps(app), s0);
});

test('teeMetres resolves through the tee, falling back to the hole\'s own metres', () => {
  assert.equal(app.E(`teeMetres(course('c_tees').holes[0], 'blue')`), 320);
  assert.equal(app.E(`teeMetres(course('c_tees').holes[1], 'blue')`), 140, 'no blue tee on hole 2 → the card distance');
  assert.equal(app.E(`teeMetres(null, 'blue')`), null);
  assert.deepEqual(app.J(`teeNames(course('c_tees'))`), ['white', 'blue']);
  assert.equal(app.E(`primaryTee(course('c_tees'))`), 'white');
  assert.deepEqual(app.J(`holesForTee(course('c_tees'), 'blue').map(h => h.metres)`), [320, 140]);
});

test('a round played off the blue tee measures every distance from the blue tee', () => {
  const h = app.J(`holesOf(session('r_blue'))[0]`);
  assert.equal(h.metres, 320, 'not the 300 snapshot in the round');
  assert.equal(app.E(`toGreen(holesOf(session('r_blue'))[0], { t: 0.5, u: 0 })`), 160);
  app.go('rounds', { sessionId: 'r_blue', hole: '1' });
  assert.match(app.text('#view h1'), /320m/);
  assert.match(app.text('#view .map-hint'), /160m to the green/);
});

test('a round whose course is gone still resolves through its own snapshot', () => {
  assert.equal(app.E(`holesOf(session('r_v1_nocourse'))[0].metres`), 280);
});

test('the round form offers the course\'s tee sets and saves the one chosen', async () => {
  app.act('editRound', { id: 'r_blue' });
  const opts = app.$$('#sheetInner select[name=tee] option').map(o => o.value);
  assert.deepEqual(opts, ['white', 'blue']);
  assert.equal(app.field('tee').value, 'blue');
  app.fill('tee', 'white');
  assert.equal(await app.save(), true);
  const r = await app.api.get('sessions', 'r_blue');
  assert.equal(r.tee, 'white');
  assert.equal(app.E(`holesOf(session('r_blue'))[0].metres`), 300);
});

// Regression: the tee control used to stay on the first course's tee.
test('picking a different course in New round also switches the tee', async () => {
  await app.api.put('courses', 'c_a', { id: 'c_a', v: 2, name: 'Aardvark GC', tee: 'blue', holes: [{ n: 1, par: 4, metres: 330, tees: { blue: 330 } }] });
  await app.waitFor(() => app.E(`S.courses[0] && S.courses[0].id === 'c_a'`), { what: 'poll' });
  app.act('newRound');
  assert.equal(app.field('tee').value, 'blue', 'opens on Aardvark, primary tee blue');
  const box = app.$('#courseSearch'); box.value = 'two tee'; box.dispatchEvent(new app.win.Event('input'));
  box.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(app.field('courseId').value, 'c_tees');
  try {
    assert.equal(app.field('tee').value, 'white', 'Two Tee GC plays off white by default');
  } finally { app.click('#sheetInner [data-close]'); }
});
