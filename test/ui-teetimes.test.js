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
  const days = app.$$('#ttDays button.chip');
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
  const ids = sel => app.$$(sel).map(x => x.dataset.tt || x.id.replace('tt_', ''));
  assert.deepEqual(ids('#ttList > [data-tt], #ttList > details'), ['c_near'], 'only courses with times in the list');
  assert.deepEqual(ids('#ttRestList > [data-tt]'), ['c_empty', 'c_down'], 'the rest folded: nothing that suits, then couldn\'t read');
  assert.match(app.text('#ttRest summary'), /Nothing that suits\s*2 courses, 1 couldn't be read/);
});

test('players, time and holes filter the answers already read, without asking the clubs again', async () => {
  const before = hits.length;
  app.click('#tt_players [data-v="2"]');
  assert.match(teaser('c_near'), /6 times from 12:48/, '12:16 has one spot left');
  const from = app.$('select[data-ttpref="from"]'); from.value = '13:00'; from.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  assert.match(teaser('c_near'), /4 times from 13:04/);
  app.click('#tt_holes [data-v="9"]');
  assert.match(row('c_near'), /No 9-hole rate on this day; it has 8 times at other lengths/);
  app.click('#tt_holes [data-v=""]');
  assert.match(teaser('c_near'), /4 times/);
  // Nothing fits: the nearest miss, from the day's own times.
  const sel = (k, v) => { const e = app.$(`select[data-ttpref="${k}"]`); e.value = v; e.dispatchEvent(new app.win.Event('change', { bubbles: true })); };
  sel('to', '13:00');
  assert.match(row('c_near'), /Nothing in your time window\. 6 times with room for 2 outside it, from 12:48\./, '13:00 to 13:00 has nothing');
  sel('from', '14:00'); sel('to', '');
  app.click('#tt_players [data-v="4"]');
  assert.match(row('c_near'), /Nothing in your time window\. 2 times with room for 4 outside it, from 13:04\./, 'after 14:00 only 14:32, with 2 spots');
  sel('from', '13:00'); app.click('#tt_players [data-v="2"]');
  assert.equal(hits.length, before, 'nothing asked of any club');
  assert.deepEqual(JSON.parse(app.win.localStorage.getItem('carry.tt')), { from: '13:00', to: '', holes: null, players: 2, within: 20, price: null }, 'kept for next time on this phone');
});

test('a price limit keeps the times at or under it, by each time\'s own fee, and says when none are', async () => {
  // Every time in the fixture's timesheet charges $45 (its own first fee), whatever its rate's price.
  const before = hits.length;
  const sel = (k, v) => { const e = app.$(`select[data-ttpref="${k}"]`); e.value = v; e.dispatchEvent(new app.win.Event('change', { bubbles: true })); };
  sel('price', '40');
  assert.match(row('c_near'), /Nothing at \$40 or less; the cheapest that otherwise suits is \$45\./);
  sel('price', '50');
  assert.match(teaser('c_near'), /4 times from 13:04/, 'all four still fit at $50');
  assert.equal(JSON.parse(app.win.localStorage.getItem('carry.tt')).price, 50, 'kept as a number');
  sel('price', '');
  assert.equal(JSON.parse(app.win.localStorage.getItem('carry.tt')).price, null);
  assert.equal(hits.length, before, 'filtering by price asks no club anything');
});

test('the filters are one size and two lines: day chips, buttons and selects all 16px', () => {
  // 2.42.0 (he asked): chips were 13px and the buttons the body size beside 16px selects. 16px is
  // what iOS needs to not zoom into a select, so everything matches it.
  const css = app.doc.querySelector('style').textContent;
  assert.match(css, /#ttDays \.chip, \.ttfilters \.seg button, \.ttfilters select \{ font: 500 16px var\(--body\); \}/);
  assert.deepEqual(app.$$('.ttfilters .ttline').map(l => [...l.querySelectorAll('.ttl')].map(x => x.textContent)), [['Time', 'Players'], ['Holes', 'Within', 'Max price']]);
});

test('any day up to a year ahead can be picked; a day outside that falls back to today', async () => {
  const far = day(40);
  const pick = app.$('#ttPick');
  assert.equal(pick.getAttribute('min'), day(0)); assert.equal(pick.getAttribute('max'), day(365));
  assert.match(app.text('#ttDays .ttpick'), /Pick a date/);
  const n = hits.length;
  pick.value = far; pick.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  assert.equal(app.J('S.sub').date, far);
  assert.equal(app.$('#ttDays .ttpick').getAttribute('aria-pressed'), 'true', 'the picked day is the pressed one');
  assert.ok(app.$$('#ttDays button.chip').every(b => b.getAttribute('aria-pressed') === 'false'));
  assert.doesNotMatch(app.text('#ttDays .ttpick'), /Pick a date/, 'it shows the date picked');
  await settled('a day 40 days out');
  assert.ok(hits.slice(n).some(h => h.includes(`selectedDate=${far}`)), 'the clubs are asked for that day');
  app.go('courses', { view: 'teetimes', date: day(-1) }); assert.equal(app.E('ttDate()'), day(0), 'yesterday reads as today');
  app.go('courses', { view: 'teetimes', date: day(400) }); assert.equal(app.E('ttDate()'), day(0), 'over a year out reads as today');
  app.go('courses', { view: 'teetimes', date: TOMORROW }); await settled('back to tomorrow');
});

test('a wider distance adds courses; another day asks again; check again re-reads', async () => {
  { const e = app.$('select[data-ttpref="within"]'); e.value = '0'; e.dispatchEvent(new app.win.Event('change', { bubbles: true })); }
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
