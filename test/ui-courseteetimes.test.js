// A course's own tee times (2.45.0): the Tee times fold on a course page,
// against the stand-in MiClub of ui-teetimes (Bexley's real pages). Closed,
// it asks no club anything; opened, it asks for this course alone. Today
// first, tomorrow once today's times have gone; a day picked stays on the
// course page; players filters; a redraw asks nothing new; a course Carry
// can't read says how it books, and a closed one has no fold.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startApp, card } from './harness.js';

const fixture = f => readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8');
const CAL = fixture('miclub-calendar.html'), SHEET = fixture('miclub-timesheet.html');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let fake, hits = [], app;
before(async () => {
  fake = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push(u.pathname + u.search);
    res.writeHead(200, { 'content-type': 'text/html' });
    if (/ViewPublicCalendar/.test(u.pathname)) return res.end(CAL.replaceAll('2026-10-30', '1999-01-01').replaceAll('2026-11-02', '1999-01-02').replaceAll('2026-10-31', u.searchParams.get('selectedDate')));
    res.end(SHEET);
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const mi = id => `http://127.0.0.1:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${id}`;
  const c = (id, name, extra) => ({ id, v: 2, name, tee: 'white', holes: card(9), lat: -33.95, lng: 151.1, ...extra });
  app = await startApp({ env: { TEETIMES_FRESH_MS: '0' }, seed: { clubs: [], sessions: [], settings: { home: { label: 'Home', lat: -33.9, lng: 151.2 } }, courses: [
    c('c_bex', 'Bexley GC', { bookable: true, bookingUrl: mi(3000000) }),
    c('c_phone', 'Phone GC', { bookable: true, bookingUrl: 'https://phone.example/teetimes', bookingNote: 'Call the pro shop on 02 9000 0000.' }),
    c('c_shut', 'Shut GC', { closed: true, bookingUrl: mi(3000003) }),
  ] } });
});
after(() => { app && app.stop(); fake && fake.close(); });

const at = (hh, mm) => { const Real = app.win.Date, d = new Real(); const fixed = new Real(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
  app.win.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; return () => { app.win.Date = Real; }; };
const openFold = () => { const d = app.$('#courseTt'); d.open = true; d.dispatchEvent(new app.win.Event('toggle')); };
const teaserOf = () => app.text('#courseTt summary .muted');
const loaded = what => app.waitFor(() => /: \d+ times?|nothing free|couldn/.test(teaserOf()), { what });

test('closed, the fold asks no club; opened, it asks for this course and lists its times, linked to the club', async () => {
  const restore = at(9, 0);
  try {
    app.go('courses', { courseId: 'c_bex' });
    assert.ok(app.$('#courseTt') && !app.$('#courseTt').open, 'there, and closed');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(hits.length, 0, 'no club asked on opening the course page');
    openFold();
    await loaded('today read');
    assert.ok(hits.length > 0 && hits.every(h => h.includes(`selectedDate=${day(0)}`) || /Timesheet/.test(h)), 'today, this course');
    assert.match(app.text('#courseTt summary'), /Today: \d+ times? from \d\d:\d\d · from \$\d+/);
    const chip = app.$('#courseTt a.ttime');
    assert.match(chip.getAttribute('href'), /ViewPublicTimesheet/);
    assert.equal(chip.getAttribute('target'), '_blank');
    assert.equal(app.$('#courseTt [data-act="ttDay"][aria-pressed="true"]').dataset.v, day(0));
    const n = hits.length; app.E('render()');
    await new Promise(r => setTimeout(r, 200));
    assert.equal(hits.length, n, 'a redraw with it open asks nothing new');
    assert.ok(app.$('#courseTt').open, 'and it stays open');
  } finally { restore(); }
});

test('once today\'s times have all gone it shows tomorrow, and says so', async () => {
  const restore = at(23, 30);
  try {
    app.E('render()');
    await app.waitFor(() => /Tomorrow:/.test(app.text('#courseTt summary')), { what: 'tomorrow' });
    assert.match(app.text('#ctStatus'), /Today’s times have all gone, so this is tomorrow/);
    assert.equal(app.$('#courseTt [data-act="ttDay"][aria-pressed="true"]').dataset.v, day(1));
  } finally { restore(); }
});

test('a day picked stays on the course page; players filters; the search is a tap away for that day', async () => {
  app.click(`#courseTt [data-v="${day(3)}"]`);
  assert.deepEqual(app.J('S.sub'), { courseId: 'c_bex', date: day(3) });
  await app.waitFor(() => app.text('#courseTt summary').includes(':') && app.$('#courseTt a.ttime'), { what: 'day 3 read' });
  const all = app.$$('#courseTt a.ttime').length;
  app.click('#courseTt [data-act="ttPref"][data-v="4"]');
  const four = app.$$('#courseTt a.ttime').length;
  assert.ok(four < all, `fewer with room for 4 (${four} of ${all})`);
  assert.ok(app.$$('#courseTt a.ttime small').every(s => Number(/(\d+) free/.exec(s.textContent)[1]) >= 4));
  assert.equal(app.J('ttPrefs()').players, 4, 'the search\'s own setting');
  app.click('#courseTt [data-act="ttPref"][data-v="1"]');
  assert.equal(app.$('#courseTt [data-go]').dataset.go, `courses:view=teetimes,date=${day(3)}`);
});

test('a course Carry can\'t read says how it books; a closed course has no fold', () => {
  app.go('courses', { courseId: 'c_phone' });
  assert.match(app.text('#courseTt summary'), /booked on their site/);
  assert.match(app.text('#ctOther'), /Call the pro shop on 02 9000 0000/);
  assert.match(app.$('#ctOther a').getAttribute('href'), /phone\.example/);
  app.go('courses', { courseId: 'c_shut' });
  assert.equal(app.$('#courseTt'), null);
});
