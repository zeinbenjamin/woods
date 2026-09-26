// The analytical invariants from CLAUDE.md, checked against the real app:
// strike classes, stock vs pure carry, derived-never-stored, nominal vs
// measured, the recency window, calibration and "it's real", and
// unmeasurable-means-null (the bug that once produced 2,800m shots).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card, rangeSession, block } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Hand-classified (see the working in the first test). Synthetic numbers.
const SEVEN = [[130, 140], [128, 138], [125, 135], [124, 150], [100, 108], [15, 40], [118, 127]];
const OLD = [[90, 100], [92, 101], [91, 99], [93, 102]];
const art = { asset: 'b'.repeat(32), w: 540, h: 900, tee: [270, 810], green: [270, 108], gr: 30 };

let app;
before(async () => {
  app = await startApp({ seed: {
    clubs: [club('D', 'driver', { order: 1 }), club('7i', 'iron', { order: 3, nominalCarry: 115, nominalTotal: 130 }), club('PW', 'wedge', { order: 4 })],
    courses: [
      { id: 'c_long', v: 2, name: 'Long GC', tee: 'white', holes: card(9, { par: [5], metres: [600] }) },
      { id: 'c_art2', v: 2, name: 'Art GC', tee: 'white', holes: card(9, { extra: { 1: { art } } }) },
      { id: 'c_noart', v: 2, name: 'Bare GC', tee: 'white', holes: card(9) },
    ],
    sessions: [
      rangeSession('s_new', daysAgo(10), [block('b_new', '7i', SEVEN)]),
      rangeSession('s_old', daysAgo(400), [block('b_old', '7i', OLD)]),
      { id: 'r_cal', v: 2, type: 'round', date: daysAgo(5), courseId: 'c_long', courseName: 'Long GC', tee: 'white', detail: 'shot_level',
        holes: [{ n: 1, par: 5, metres: 600, shots: [{ t: 0.5, u: 0, club: '7i' }, { t: 0.97, u: 0, club: 'PW' }], putts: 2, strokes: 4 }] },
      // A hole traced on artwork, then one outline shot mixed in: two frames.
      { id: 'r_mixed', v: 2, type: 'round', date: daysAgo(4), courseId: 'c_art2', courseName: 'Art GC', tee: 'white', detail: 'shot_level',
        holes: [{ n: 1, par: 4, metres: 300, shots: [{ t: 0.4, u: 0, club: '7i' }, { x: 270, y: 300, club: 'PW' }], putts: 2, strokes: 4 }] },
      // Pixel shots on a hole that has no artwork (it was removed under them).
      { id: 'r_orphan', v: 2, type: 'round', date: daysAgo(3), courseId: 'c_noart', courseName: 'Bare GC', tee: 'white', detail: 'shot_level',
        holes: [{ n: 1, par: 4, metres: 300, shots: [{ x: 270, y: 500, club: '7i' }, { x: 272, y: 120, club: 'PW' }], putts: 1, strokes: 3 }] },
    ],
  } });
});
after(() => app && app.stop());

test('strike classes follow the definitions, relative to the club\'s own 90th percentile', () => {
  // live carries 100,118,124,125,128,130 → p90 = 129, pure line 116.1
  // pure-zone roll% median = 7.81%, so runner above 17.81%
  //   124/150 rolls 21% → runner; 100/108 is under the pure line → short; 15 → top
  const got = app.J(`classify(${JSON.stringify(SEVEN.map(([carry, total]) => ({ carry, total })))})`);
  assert.deepEqual(got, ['pure', 'pure', 'pure', 'runner', 'short', 'top', 'pure']);
});

test('fewer than four live shots is not enough to classify: unknown, not a guess', () => {
  const got = app.J(`classify([{carry:120,total:130},{carry:110,total:118},{carry:10,total:30}])`);
  assert.deepEqual(got, ['unknown', 'unknown', 'top']);
});

test('stock carry is the median of non-topped shots; pure carry the mean of pure strikes', async () => {
  await app.api.put('settings', 'app', { id: 'app', window: '365' });
  await app.waitFor(() => app.E(`settings().window === '365'`), { what: 'window setting' });
  const s = app.J(`clubStats('7i')`);
  assert.equal(s.n, 7);
  assert.equal(s.stockCarry, 124.5, 'median of 100,118,124,125,128,130 — the 15m top excluded');
  assert.equal(s.pureCarry, 125.25, 'mean of 130,128,125,118');
  assert.deepEqual([s.pure, s.runner, s.short, s.top], [4, 1, 1, 1]);
});

test('the recency window drops old range sessions, and the chip stores only the setting', async () => {
  app.go('overview');
  app.click('#view [data-act="setWindow"][data-w="all"]');
  await app.waitFor(async () => (await app.api.get('settings', 'app')).window === 'all', { what: 'window saved' });
  assert.equal(app.E(`clubStats('7i').n`), 11, 'all time: both sessions');
  app.click('#view [data-act="setWindow"][data-w="90"]');
  await app.waitFor(async () => (await app.api.get('settings', 'app')).window === '90', { what: 'window saved' });
  assert.equal(app.E(`clubStats('7i').n`), 7, 'last 90 days: the 400-day-old session is out');
  assert.deepEqual(Object.keys(await app.api.get('settings', 'app')).sort(), ['id', 'window']);
});

test('rendering every view writes nothing: derived data is never stored', async () => {
  const before = await (await fetch(`${app.base}/api/stamps`)).json();
  const views = [['overview'], ['range'], ['range', { sessionId: 's_new' }], ['range', { blockId: 'b_new' }], ['rounds'],
    ['rounds', { sessionId: 'r_cal' }], ['rounds', { sessionId: 'r_cal', hole: '1' }], ['courses'], ['courses', { courseId: 'c_long' }],
    ['courses', { courseId: 'c_long', hole: '1' }], ['bag']];
  for (const [tab, sub] of views) { app.go(tab, sub); assert.ok(app.text('#view').length > 20, `${tab} rendered`); }
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(await (await fetch(`${app.base}/api/stamps`)).json(), before);

  const derived = /^(stockCarry|stockTotal|pureCarry|roll|profile|strike|calibration|practice|gir|fir|toPar|gross)$/;
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.ok(!derived.test(k), `derived key ${path}.${k} stored`); walk(x, `${path}.${k}`); }
  };
  for (const col of ['clubs', 'courses', 'sessions', 'settings']) walk(await app.api.list(col), col);
});

test('nominal carry stays what he believes; measured numbers are never written over it', async () => {
  const c = await app.api.get('clubs', '7i');
  assert.equal(c.nominalCarry, 115);
  assert.equal(c.nominalTotal, 130);
  app.go('bag');
  const row = app.$$('#view tbody tr').find(tr => /^7i/.test(tr.textContent.trim()));
  const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
  assert.equal(cells[2], '115', 'assumed carry column');
  assert.equal(cells[4], '125', 'stock carry column is measured (124.5, 90-day window)');
});

test('the freshness line says what the list stands on and that it is recalculated, not stored', () => {
  // It renders above the practice list, which is empty for this data, so read it directly.
  const line = app.E('basisLine()');
  assert.match(line, /3 holes of shot data/);
  assert.match(line, /Recalculated every time this screen draws — there is no stored copy/);
});

test('calibration flags an on-course shot longer than the range allows, above ceiling + 25%', () => {
  app.E(`S.settings = { ...settings(), window: 'all' }`);
  const cal = app.J(`calibration().find(c => c.club === '7i')`);
  assert.equal(cal.n, 2, 'the 300m tee shot at Long GC and the 120m one at Art GC');
  assert.equal(cal.suspect.length, 1);
  assert.equal(cal.suspect[0].r.id, 'r_cal');
  assert.ok(cal.suspect[0].len > 280 && cal.suspect[0].len < 320, `tap-to-tap length ~300m, got ${cal.suspect[0].len}`);
  app.go('bag');
  assert.match(app.text('#view'), /Check this tap/);
});

test('"It\'s real" marks the shot verified: it stays in the numbers and stops being flagged', async () => {
  app.go('bag');
  app.click('#view [data-act="verifyShot"]');
  await app.waitFor(async () => (await app.api.get('sessions', 'r_cal')).holes[0].shots[0].verified === true, { what: 'verified saved' });
  await app.waitFor(() => app.E(`calibration().find(c => c.club === '7i').suspect.length === 0`), { what: 'unflagged' });
  assert.equal(app.E(`calibration().find(c => c.club === '7i').n`), 2, 'still counted');
  assert.doesNotMatch(app.text('#view'), /Check this tap/);
});

test('a shot measured across two coordinate frames is not measurable: null, not a number', () => {
  assert.equal(app.E(`shotLen(holesOf(session('r_mixed'))[0], 1)`), null);
  assert.ok(app.E(`shotLen(holesOf(session('r_mixed'))[0], 0)`) > 0, 'the same-frame shot still measures');
  app.go('rounds', { sessionId: 'r_mixed', hole: '1' });
  assert.match(app.$$('#view .shotrow')[1].textContent, /not measurable/);
});

test('pixel shots on a hole with no artwork measure as null, never as thousands of metres', () => {
  const h = `holesOf(session('r_orphan'))[0]`;
  assert.equal(app.E(`toGreen(${h}, ${h}.shots[0])`), null);
  assert.equal(app.E(`shotLen(${h}, 0)`), null);
  assert.equal(app.E(`shotLen(${h}, 1)`), null);
  const st = app.J(`roundStats(session('r_orphan'))`);
  assert.deepEqual(st.approaches, []);
  assert.deepEqual(st.byClub, {});
  assert.equal(app.J(`shotRecords().filter(x => x.r.id === 'r_orphan')`).length, 0, 'kept out of the practice loop');
  app.go('rounds', { sessionId: 'r_orphan', hole: '1' });
  const txt = app.text('#view');
  assert.match(txt, /not measurable/);
  const big = (txt.match(/\d{4,}\s*m/g) || []);
  assert.deepEqual(big, [], 'no four-digit distances anywhere on the hole');
});
