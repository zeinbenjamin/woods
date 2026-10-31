// Tee times (2.40.0): the MiClub reader against pages copied from Bexley's
// public booking site, and the route end to end against a stand-in MiClub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miclubSource, calendarUrl, timesheetUrl, parseCalendar, parseTimesheet, clock, suits, readFilters } from '../server/teetimes.js';

const fixture = f => readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8');
const CAL = fixture('miclub-calendar.html'), SHEET = fixture('miclub-timesheet.html'), EMPTY = fixture('miclub-calendar-empty.html');

test('which booking links are MiClub, and the course id behind each', () => {
  assert.deepEqual(miclubSource('https://www.bexleygolf.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000'),
    { origin: 'https://www.bexleygolf.com.au', resource: '3000000', guessed: false }, 'a club domain under /guests/bookings/');
  assert.equal(miclubSource('https://moorepark.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3050007').resource, '3050007');
  assert.equal(miclubSource('https://coast.miclub.com.au/guests/bookings/ViewPublicTimesheet.msp?bookingResourceId=').guessed, true, 'an empty id is a guess');
  assert.deepEqual(miclubSource('https://masseypark.miclub.com.au/cms/public-bookings/'), { origin: 'https://masseypark.miclub.com.au', resource: '3000000', guessed: true });
  // Gordon's and Richmond's links, on their own domains: their calendar is at the usual address (read 2026-10-30).
  assert.deepEqual(miclubSource('https://www.gordongolfcourse.com.au/guests/ListBookingEvents.msp?booking_resource_id=187'), { origin: 'https://www.gordongolfcourse.com.au', resource: '187', guessed: false });
  assert.equal(miclubSource('https://www.richmondgolfclub.com.au/guests/ListBookingEvents.msp?booking_resource_id=3000000').resource, '3000000');
  assert.equal(miclubSource('https://example.com/guests/'), null, 'a /guests/ path alone is not MiClub');
  for (const u of ['https://lanecove.quick18.com/teetimes/searchmatrix', 'https://www.golfnow.com.au/tee-times/facility/17227-avalon-golf-course/search',
    'https://hurstvillegolf.com.au/book/', 'javascript:alert(1)', 'not a url', '', undefined]) assert.equal(miclubSource(u), null, String(u));
  const src = miclubSource('https://www.bexleygolf.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000');
  assert.equal(calendarUrl(src, '2026-11-07'), 'https://www.bexleygolf.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000&selectedDate=2026-11-07');
  assert.equal(timesheetUrl(src, '2026-10-31', '5315151'), 'https://www.bexleygolf.com.au/guests/bookings/ViewPublicTimesheet.msp?bookingResourceId=3000000&selectedDate=2026-10-31&feeGroupId=5315151',
    'the address the real page sent its 18-hole Saturday link to');
});

test('the calendar: each rate, its holes, and its price on the days it is offered', () => {
  const cal = parseCalendar(CAL);
  assert.deepEqual(cal.map(r => [r.id, r.name, r.holes]), [['5315151', '18 Holes', 18], ['10320821', 'PHILTER LATE RATE', 18], ['5315152', '9 Holes', 9]]);
  assert.deepEqual(cal[0].days, { '2026-10-30': { price: 40, special: false }, '2026-10-31': { price: 45, special: false }, '2026-11-02': { price: 25, special: false } });
  assert.deepEqual(cal[1].days['2026-10-31'], { price: 25, special: true });
  assert.deepEqual(Object.keys(cal[2].days), ['2026-10-30', '2026-11-02'], '"Not Available" on Saturday is left out');
  assert.equal(parseCalendar('<html><body>Please log in</body></html>'), null, 'a page that is not a calendar is unreadable, not empty');
  // Moore Park's 12-hole rate carries MiClub's nineHole class (seen live 2026-10-30): the name wins.
  const twelve = CAL.replace('<h3>9 Holes</h3>', '<h3>12-Holes</h3>');
  assert.equal(parseCalendar(twelve)[2].holes, 12);
  assert.deepEqual(parseCalendar(EMPTY), [], 'Massey Park\'s calendar: a calendar, with no rates');
  // Camden's, Castle Hill's, Cronulla's and Richmond's (seen 2026-11-01): no days, no rates, one line.
  assert.deepEqual(parseCalendar('<div class="container"><p>No rows meeting selected criteria.</p> <a href="?all=1">Show All</a></div>'), [], 'a calendar listing nothing is empty, not unreadable');
});

test('the timesheet: every tee time in 24-hour time with its free spots', () => {
  const sheet = parseTimesheet(SHEET);
  assert.deepEqual(sheet.map(t => [t.time, t.free, t.of]), [['12:16', 1, 4], ['12:48', 2, 4], ['13:04', 4, 4], ['14:32', 2, 4]]);
  assert.deepEqual(sheet[0].fees, [{ price: 45, who: 'Adult (Sat-Sun + Public Holidays)' }]);
  assert.equal(sheet[0].tee, '1st Tee | Social Golf');
  assert.equal(parseTimesheet('<p>Session expired</p>'), null);
  assert.deepEqual([clock('07:04 am'), clock('12:00 pm'), clock('12:08 am'), clock('9:30'), clock('noon')], ['07:04', '12:00', '00:08', '09:30', null]);
});

test('filters: time window, holes and players; a full time never suits', () => {
  const r18 = { holes: 18 }, t = (time, free) => ({ time, free });
  assert.equal(suits(t('12:16', 1), r18, { players: 2 }), false);
  assert.equal(suits(t('12:48', 2), r18, { players: 2 }), true);
  assert.equal(suits(t('12:48', 2), r18, { from: '13:00' }), false);
  assert.equal(suits(t('14:32', 2), r18, { to: '14:00' }), false);
  assert.equal(suits(t('14:00', 2), r18, { from: '14:00', to: '14:00' }), true, 'both ends included');
  assert.equal(suits(t('09:00', 4), r18, { holes: 9 }), false);
  assert.equal(suits(t('09:00', 0), r18, {}), false);
  assert.deepEqual(readFilters({ from: '07:00', to: '7pm', holes: '27', players: '9' }), { from: '07:00', to: null, holes: null, players: 4 }, 'nonsense is dropped, players capped at a four');
  assert.equal(readFilters({ holes: '12' }).holes, 12, 'a 12-hole course can be asked for');
});

/* ---------- end to end ---------- */

const DATA = mkdtempSync(join(tmpdir(), 'carry-tt-'));
const PORT = 8173;
const base = `http://127.0.0.1:${PORT}`;
const hdr = { 'content-type': 'application/json' };
let proc, fake, seen = [], broken = false;

before(async () => {
  fake = createServer((req, res) => {
    seen.push(req.url + ' ' + req.headers['user-agent']);
    if (broken) { res.writeHead(503); return res.end('down'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(/ViewPublicCalendar/.test(req.url) ? (/resource_id=5\b/.test(req.url) || /^localhost:/.test(req.headers.host) ? EMPTY : CAL) : /ViewPublicTimesheet/.test(req.url) ? SHEET : 'nope');
  });
  await new Promise(r => fake.listen(0, r));
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, DEV_USER: 'me@example.com', ANTHROPIC_API_KEY: '', TEETIMES_TTL_MS: '1500' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const put = (id, doc) => fetch(`${base}/api/courses/${id}`, { method: 'PUT', headers: hdr, body: JSON.stringify({ id, v: 2, name: id, holes: [], ...doc }) });
  await put('c_mi', { bookingUrl: `http://127.0.0.1:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000` });
  await put('c_q18', { bookingUrl: 'https://www.golf-booking.com/en/club/hurstville-golf-course' });
  await put('c_none', {});
  await put('c_empty', { bookingUrl: `http://127.0.0.1:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=5` });
  await put('c_guess', { bookingUrl: `http://localhost:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp` });   // no id in the link (as Massey Park's), an empty calendar
  await put('c_down', { bookingUrl: `http://127.0.0.1:${fake.address().port}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=4` });
});
after(() => { proc && proc.kill(); fake && fake.close(); rmSync(DATA, { recursive: true, force: true }); });
const get = path => fetch(base + path).then(async r => ({ status: r.status, body: await r.json(), cache: r.headers.get('cache-control') }));

test('a MiClub course: Saturday\'s rates with the times that suit, each linked to its own page', async () => {
  const r = await get('/api/teetimes/c_mi?date=2026-10-31&players=2');
  assert.equal(r.status, 200); assert.equal(r.cache, 'no-store');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.source, 'MiClub');
  assert.deepEqual(r.body.rates.map(x => [x.name, x.holes, x.price, x.special]), [['18 Holes', 18, 45, false], ['PHILTER LATE RATE', 18, 25, true]],
    'the 9-hole rate is not offered on the Saturday');
  assert.deepEqual(r.body.rates[0].times.map(t => [t.time, t.free]), [['12:48', 2], ['13:04', 4], ['14:32', 2]], '12:16 has one spot, too few for two');
  assert.match(r.body.rates[0].url, /ViewPublicTimesheet\.msp\?bookingResourceId=3000000&selectedDate=2026-10-31&feeGroupId=5315151$/);
  assert.equal(r.body.rates[0].listed, 4);
  assert.ok(seen.every(l => /^\/guests\/bookings\/.* Carry\//.test(l)), 'only the two public pages, saying who is asking');
  assert.ok(!seen.some(l => /me@example\.com/.test(l)), 'nothing about who is signed in');
});

test('filters reach the club only as its own pages: holes picks the rates, the rest is applied here', async () => {
  seen = [];
  const r = await get('/api/teetimes/c_mi?date=2026-10-30&holes=9&from=13:00&to=14:00');
  assert.deepEqual(r.body.rates.map(x => x.name), ['9 Holes']);
  assert.deepEqual(r.body.rates[0].times.map(t => t.time), ['13:04']);
  const again = await get('/api/teetimes/c_mi?date=2026-10-30&holes=9');
  assert.equal(again.body.rates[0].times.length, 4);
  assert.equal(seen.length, 2, 'the second search was answered from memory: one calendar, one timesheet');
  await new Promise(r => setTimeout(r, 1600));
  await get('/api/teetimes/c_mi?date=2026-10-30&holes=9');
  assert.equal(seen.length, 4, 'and asked again once the memory is older than its few minutes (1.5 s here)');
  await get('/api/teetimes/c_mi?date=2026-10-30&holes=9&fresh=1');
  assert.equal(seen.length, 4, '"check again" leaves a page read under a minute ago alone');
});

test('an empty answer says why: nothing that day, a calendar with no rates, a holes filter', async () => {
  const day = await get('/api/teetimes/c_mi?date=2026-11-07');
  assert.deepEqual(day.body.rates, []); assert.match(day.body.note, /Nothing is open to the public on this day/, 'Bexley on Saturday 7 Nov');
  const none = await get('/api/teetimes/c_empty?date=2026-11-07');
  assert.match(none.body.note, /lists no rates at all/); assert.doesNotMatch(none.body.note, /assumed/, 'the id was in the link');
  assert.match((await get('/api/teetimes/c_guess?date=2026-11-07')).body.note, /assumed \(3000000\)/, 'Massey Park: the id was assumed');
  assert.match((await get('/api/teetimes/c_mi?date=2026-10-31&holes=9')).body.note, /matches the holes/);
  assert.equal((await get('/api/teetimes/c_mi?date=2026-10-31')).body.note, undefined, 'no note when there are rates');
});

test('what can\'t be read says so, and is never "no times"', async () => {
  assert.equal((await get('/api/teetimes/c_q18?date=2026-10-31')).body.status, 'unsupported');
  assert.match((await get('/api/teetimes/c_none?date=2026-10-31')).body.message, /no booking link/);
  broken = true;
  const down = await get('/api/teetimes/c_down?date=2026-10-31');
  broken = false;
  assert.equal(down.body.status, 'unreachable'); assert.match(down.body.message, /503/);
  assert.equal((await get('/api/teetimes/c_mi?date=31/10/2026')).status, 400);
  assert.equal((await get('/api/teetimes/c_nope?date=2026-10-31')).status, 404);
});

test('the route needs sign-in like the rest of /api', async () => {
  const p = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: mkdtempSync(join(tmpdir(), 'carry-tt2-')), DEV_USER: '', CF_ACCESS_TEAM: 'x.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' } });
  try {
    let s;
    for (let i = 0; i < 80; i++) { try { s = (await fetch(`http://127.0.0.1:${PORT + 1}/api/teetimes/c_mi?date=2026-10-31`)).status; break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    assert.equal(s, 401);
  } finally { p.kill(); }
});
