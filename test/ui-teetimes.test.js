// Tee times (2.41.0): Courses → Tee times, driven through the real page
// against a stand-in MiClub serving Bexley's real pages (test/fixtures/).
// Which courses are searched (public, readable, within the distance), the
// filters working on the answers without asking the clubs again, each time
// linking to the club's page, and every course that shows nothing saying why.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startApp, card } from './harness.js';

const fixture = f => readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8');
const CAL = fixture('miclub-calendar.html'), SHEET = fixture('miclub-timesheet.html'), EMPTY = fixture('miclub-calendar-empty.html');
// Tomorrow, local: today would hide the times already past, which depends on the clock.
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TOMORROW = day(1), LATER = day(3);

let fake, hits = [], app;
before(async () => {
  // Bexley's calendar offers "18 Holes" and its late rate on the day asked for
  // (its Saturday column, moved to that date); the 9-hole rate isn't offered.
  // Its other columns are moved out of the way, or a run on one of their dates sees them.
  fake = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push(u.pathname + u.search);
    const id = u.searchParams.get('booking_resource_id') || u.searchParams.get('bookingResourceId');
    if (id === '4') { res.writeHead(503); return res.end('down'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (/ViewPublicCalendar/.test(u.pathname)) return res.end(id === '5' ? EMPTY : CAL.replaceAll('2026-10-30', '1999-01-01').replaceAll('2026-11-02', '1999-01-02').replaceAll('2026-10-31', u.searchParams.get('selectedDate')));
    res.end(SHEET);
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const mi = id => `http://127.0.0.1:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${id}`;
  const c = (id, name, lat, extra) => ({ id, v: 2, name, tee: 'white', holes: card(9), lat, lng: 151.2, ...extra });
  app = await startApp({ env: { TEETIMES_FRESH_MS: '0' }, seed: { clubs: [], sessions: [], settings: { home: { label: 'Home', lat: -33.9, lng: 151.2 } }, courses: [
    c('c_near', 'Near GC', -33.91, { bookable: true, bookingUrl: mi(3000000), suburb: 'Bexley' }),
    c('c_far', 'Far GC', -34.2, { bookable: true, bookingUrl: mi(3000001) }),
    c('c_down', 'Down GC', -33.92, { bookable: true, bookingUrl: mi(4) }),
    c('c_empty', 'Empty GC', -33.93, { bookingUrl: mi(5) }),
    c('c_q18', 'Quick GC', -33.94, { bookable: true, bookingUrl: 'https://lanecove.quick18.com/teetimes/searchmatrix', bookingNote: 'Public 9 holes.' }),
    c('c_priv', 'Private GC', -33.905, { bookable: false, bookingUrl: mi(3000002) }),
    c('c_shut', 'Shut GC', -33.905, { closed: true, bookingUrl: mi(3000003) }),
  ] } });
});
after(() => { app && app.stop(); fake && fake.close(); });

const settled = what => app.waitFor(() => /suit/.test(app.text('#ttStatus')), { what });
const teaser = id => app.text(`#tt_${id} summary`);
const row = id => app.text(`[data-tt="${id}"]`);

test('Courses opens Tee times: seven days, today first, and the courses near home are checked', async () => {
  app.go('courses');
  app.click('#ttOpen');
  const days = app.$$('#ttDays .chip');
  assert.equal(days.length, 7);
  assert.deepEqual([days[0].textContent, days[1].textContent], ['Today', 'Tomorrow']);
  assert.equal(days[0].getAttribute('aria-pressed'), 'true');
  app.click(days[1]);
  await settled('tomorrow checked');
  const asked = new Set(hits.filter(h => /Calendar/.test(h)).map(h => new URL(h, 'http://x').searchParams.get('booking_resource_id')));
  assert.deepEqual([...asked].sort(), ['3000000', '4', '5'], 'near home, public or not known, readable: not Far (33 km), Private, Shut or Quick');
  assert.match(app.text('#ttStatus'), /1 of 3 courses has times that suit/);
  assert.match(app.text('#ttNotes'), /2 private or closed courses are not searched/);
});

test('a course with times: its rates, each time with its spots and the club\'s own page', async () => {
  assert.match(teaser('c_near'), /8 times from 12:16 · from \$25/, 'two rates of four times each; the late rate is $25');
  const chips = app.$$('#tt_c_near a.ttime');
  assert.deepEqual(chips.slice(0, 4).map(a => a.firstChild.textContent), ['12:16', '12:48', '13:04', '14:32']);
  assert.match(chips[0].textContent, /1 free/);
  const href = new URL(chips[0].href);
  assert.equal(href.pathname, '/guests/bookings/ViewPublicTimesheet.msp');
  assert.equal(href.searchParams.get('selectedDate'), TOMORROW);
  assert.equal(href.searchParams.get('feeGroupId'), '5315151');
  assert.equal(chips[0].target, '_blank');
  assert.match(app.text('#tt_c_near'), /18 Holes · \$45/);
  assert.match(app.text('#tt_c_near'), /PHILTER LATE RATE · \$25 special/);
  assert.match(chips[4].textContent, /12:16.*1 free · \$45/, 'a time whose fee differs from its rate says so');
});

test('every course that shows nothing says why', () => {
  assert.match(row('c_down'), /Couldn't read its tee times: the booking site answered 503/);
  assert.match(row('c_empty'), /lists no rates at all/);
  assert.match(app.text('#ttOther'), /Quick GC/);
  assert.match(app.text('#ttOther'), /Public 9 holes/);
  const order = app.$$('#ttList > [data-tt], #ttList > details').map(x => x.dataset.tt || x.id.replace('tt_', ''));
  assert.deepEqual(order, ['c_near', 'c_empty', 'c_down'], 'times first, then nothing that suits, then couldn\'t read');
});

test('players, time and holes filter the answers already read, without asking the clubs again', async () => {
  const before = hits.length;
  app.click('#tt_players [data-v="2"]');
  assert.match(teaser('c_near'), /6 times from 12:48/, '12:16 has one spot left');
  const from = app.$('select[data-ttpref="from"]'); from.value = '13:00'; from.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  assert.match(teaser('c_near'), /4 times from 13:04/);
  app.click('#tt_holes [data-v="9"]');
  assert.match(row('c_near'), /No times left that match/, 'no 9-hole rate that day');
  app.click('#tt_holes [data-v=""]');
  assert.match(teaser('c_near'), /4 times/);
  assert.equal(hits.length, before, 'nothing asked of any club');
  assert.deepEqual(JSON.parse(app.win.localStorage.getItem('carry.tt')), { from: '13:00', to: '', holes: null, players: 2, within: 20 }, 'kept for next time on this phone');
});

test('a wider distance adds courses; another day asks again; check again re-reads', async () => {
  app.click('#tt_within [data-v="0"]');
  await settled('far course checked');
  assert.match(teaser('c_far'), /4 times from 13:04/);
  const n = hits.length;
  app.click(`#ttDays [data-v="${LATER}"]`);
  await settled('another day');
  assert.ok(hits.slice(n).some(h => h.includes(`selectedDate=${LATER}`)));
  const m = hits.length;
  app.click('[data-act="ttRefresh"]');
  await settled('read again');
  assert.ok(hits.length > m, 'Check again reads the clubs again (here with no minute to wait)');
});

test('without a home location every readable public course is searched, and it says so', async () => {
  await app.api.put('settings', 'app', { id: 'app' });
  await app.waitFor(() => app.$('#ttHome'), { what: 'no home' });
  assert.equal(app.$('#tt_within'), null, 'no distance filter without a home');
  await settled('all checked');
  assert.ok(app.$('#tt_c_far'), 'the far course is in');
  assert.equal(app.$('[data-tt="c_priv"]') || app.$('#tt_c_priv'), null, 'never a private course');
});

test('today shows only the times still ahead', async () => {
  // The page's clock at 13:30 today, so the answer doesn't depend on when the suite runs.
  const Real = app.win.Date, d = new Real(); const fixed = new Real(d.getFullYear(), d.getMonth(), d.getDate(), 13, 30).getTime();
  app.win.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  try {
    app.click(`#ttDays [data-v="${day(0)}"]`);
    await settled('today checked');
    // The filters left by the earlier tests: 2 players, from 13:00, so 13:04 and 14:32 on each of two rates.
    assert.deepEqual(app.$$('#tt_c_near a.ttime').map(a => a.firstChild.textContent), ['14:32', '14:32'], '13:04 has gone by 13:30');
  } finally { app.win.Date = Real; }
});
