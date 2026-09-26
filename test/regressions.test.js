// Regressions from the 1.3.0 review, each reproduced before it was fixed:
// local dates, quick taps, render cost at a season of data, panels that
// snapped shut on every save, the token left in the URL, and an unescaped
// club code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card, sleep } from './harness.js';

const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const holes9 = card(9).map(({ n, par, metres }) => ({ n, par, metres }));

let app;
before(async () => {
  app = await startApp({ query: '?token=secret-token&keep=1', seed: {
    clubs: [club('7i', 'iron', { nominalTotal: 150 }), club('PW', 'wedge'), club('<i>x</i>', 'iron', { nominalTotal: 50 })],
    courses: [{ id: 'c', v: 2, name: 'C', tee: 'white', holes: card(9) }],
    sessions: [
      { id: 'r', v: 2, type: 'round', date: '2026-09-20', courseId: 'c', courseName: 'C', tee: 'white', detail: 'score_only', holes: holes9 },
      // A 150m full swing with a "club" whose code is markup, against a 50m belief: flagged as suspect.
      { id: 'r_x', v: 2, type: 'round', date: daysAgo(2), courseId: 'c', courseName: 'C', tee: 'white', detail: 'shot_level',
        holes: [{ n: 1, par: 4, metres: 300, shots: [{ t: 0.5, u: 0, club: '<i>x</i>', lie: 'fairway' }, { t: 0.97, u: 0, club: 'PW', lie: 'green' }], putts: 2, strokes: 4 }] },
    ],
  } });
});
after(() => app && app.stop());

/* ---------- 1. a round belongs to the local calendar day ---------- */

test('before 10am in Sydney, "today" is still today', () => {
  const was = process.env.TZ;
  process.env.TZ = 'Australia/Sydney';
  try {
    // 7:30am on 27 Sep in Sydney is 21:30 on 26 Sep UTC.
    const got = app.E(`(() => { const Real = Date, at = Real.parse('2026-09-26T21:30:00Z');
      Date = class extends Real { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return at; } };
      try { return today(); } finally { Date = Real; } })()`);
    assert.equal(got, '2026-09-27');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

/* ---------- 2. two quick taps are two shots ---------- */

test('two taps in quick succession both land', async () => {
  app.go('rounds', { sessionId: 'r', hole: '1' });
  const pt = t => app.J(`(() => { const all = holesOf(session('r')); const h = all[0]; const maxM = Math.max(...all.map(x => x.metres || 0), 1);
    return holePt(holeGeom(h, (h.metres || maxM) / maxM), ${t}, 0); })()`);
  for (const t of [0.5, 0.9]) { const p = pt(t); app.$('#logMap').dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y })); }
  await app.waitFor(async () => ((await app.api.get('sessions', 'r')).holes[0].shots || []).length >= 2, { what: 'both shots saved', timeout: 3000 });
  const shots = (await app.api.get('sessions', 'r')).holes[0].shots;
  assert.equal(shots.length, 2);
  assert.ok(shots[0].t < shots[1].t, 'in the order tapped');
});

/* ---------- 6. folded panels stay as he left them ---------- */

test('the quick-score panel stays open while scores are tapped in', async () => {
  app.go('rounds', { sessionId: 'r' });
  app.$('#view details.sec').open = true;
  for (const [n, s] of [[3, 5], [4, 6]]) {
    app.click(`#view [data-act="quickScore"][data-n="${n}"][data-s="${s}"]`);
    await app.waitFor(async () => (await app.api.get('sessions', 'r')).holes[n - 1].strokes === s, { what: `hole ${n} scored` });
    await sleep(400);                                  // let the next poll land too
    assert.equal(app.$('#view details.sec').open, true, `still open after scoring hole ${n}`);
  }
});

test('a save of our own does not redraw the screen again when the poll sees it', async () => {
  app.go('rounds', { sessionId: 'r' });
  await sleep(400);
  const renders = await app.E(`(async () => { let n = 0; const real = render; render = () => { n++; real(); };
    try { await ACTIONS.quickScore({ sid: 'r', n: '5', s: '4' }); await new Promise(r => setTimeout(r, 600)); return n; } finally { render = real; } })()`);
  assert.equal(renders, 2, 'one from the local write, one from the action — none from the poll echo');
});

/* ---------- 8. the token doesn't stay in the address bar ---------- */

test('a ?token= link is stored and then removed from the URL, keeping anything else', () => {
  assert.equal(app.win.localStorage.getItem('carry.token'), 'secret-token');
  assert.equal(app.win.location.search, '?keep=1');
});

/* ---------- 9. club codes are escaped in the calibration warning ---------- */

test('a club code is shown as text in the "check this tap" warning, never as markup', async () => {
  app.go('bag');
  const warn = app.$('#view .notice.warn');
  assert.ok(warn, 'the tap is flagged');
  assert.match(warn.textContent, /<i>x<\/i> on hole 1/);
  assert.equal(warn.querySelector('i'), null);
});

/* ---------- 3. a season of data still draws quickly ---------- */

test('with a season of data, each club\'s numbers are worked out once per change, and screens draw fast', async () => {
  const sessions = [];
  for (let k = 0; k < 40; k++) sessions.push({ id: 'rs' + k, v: 2, type: 'round', date: daysAgo(k * 5 + 3), courseId: 'c', courseName: 'C', tee: 'white', detail: 'shot_level',
    holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, metres: 300, putts: 2, strokes: 6,
      shots: [{ t: .5, u: (i % 3) - 1, club: '7i' }, { t: .85, u: 0, club: '7i' }, { t: .97, u: .3, club: 'PW' }, { t: .99, u: 0, club: 'PW' }] })) });
  for (let k = 0; k < 30; k++) sessions.push({ id: 'ss' + k, v: 2, type: 'range', date: daysAgo(k * 7 + 1),
    blocks: ['7i', 'PW'].map((c, j) => ({ id: `bb${k}${j}`, seq: j, club: c, swing: 'full', shots: Array.from({ length: 25 }, (_, n) => ({ carry: 100 + (n % 7) * 5, total: 110 + (n % 5) * 8 })) })) });
  for (const s of sessions) await app.api.put('sessions', s.id, s);
  await app.waitFor(() => app.E('S.sessions.length') >= 72, { what: 'poll', timeout: 8000 });
  const calls = app.E(`(() => { let n = 0; const real = fullShotsUncached; fullShotsUncached = c => (n++, real(c));
    try { go('range'); go('overview'); go('bag'); return n; } finally { fullShotsUncached = real; } })()`);
  assert.ok(calls <= app.E('S.clubs.length'), `range scans: ${calls}, at most one per club`);
  const t0 = performance.now();
  for (const tab of ['overview', 'range', 'overview', 'range']) app.go(tab);
  const per = (performance.now() - t0) / 4;
  assert.ok(per < 500, `${per.toFixed(0)}ms a screen`);
  // And a change still shows up: the cache follows the data.
  const before = app.E(`clubStats('7i').n`);
  await app.api.put('sessions', 'ss_new', { id: 'ss_new', v: 2, type: 'range', date: daysAgo(0), blocks: [{ id: 'bn', seq: 1, club: '7i', swing: 'full', shots: [{ carry: 120, total: 130 }] }] });
  await app.waitFor(() => app.E(`clubStats('7i').n`) === before + 1, { what: 'new shot counted' });
});
