// GolfNow's own site (2.77.0): Wallacia and Woodville, whose public times are
// only there. The answer below is HAND-MADE in the shape a public write-up of
// golfnow.com's calls describes (ttResults.teeTimes, each with a local `time`
// and teeTimeRates); this container can't reach GolfNow to copy a real one, and
// the .com.au site is assumed to be the same platform. The first live search
// on the NAS is the test; an answer that doesn't fit comes back unreadable with
// a sample of what came.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { golfnowSource, golfnowPage, golfnowBody, parseGolfnow, miclubSource, teeitupSource, quick18Source } from '../server/teetimes.js';

const WAL = 'https://www.golfnow.com.au/tee-times/facility/16535-wallacia-country-club/search';
const rate = (name, holes, price, extra = {}) => ({ rateName: name, holeCount: holes, singlePlayerPrice: { greensFees: { value: price } }, ...extra });
const ANSWER = { ttResults: { teeTimes: [
  { time: '2026-11-04T07:10:00', formattedTime: '7:10', formattedTimeMeridian: 'AM', displayRate: 25, playerRule: 15, teeTimeRates: [rate('18 Holes', 18, 25), rate('9 Holes', 9, 20)] },
  { time: '2026-11-04T09:40:00', formattedTime: '9:40', formattedTimeMeridian: 'AM', displayRate: 19, playerRule: 3, teeTimeRates: [rate('Prepaid - Online Rate', 18, 19, { isHotDeal: true })] },
  { time: '2026-11-04T13:20:00', formattedTime: '1:20', formattedTimeMeridian: 'PM', displayRate: 10, maxPlayers: 4, teeTimeRates: [rate('Unlimited after 1pm', null, 10)] },
  { time: '2026-11-05T07:00:00', displayRate: 25, playerRule: 15, teeTimeRates: [rate('18 Holes', 18, 25)] },
] } };

test('which links are GolfNow\'s own facility pages, and the search sent for one', () => {
  const src = golfnowSource(WAL);
  assert.deepEqual(src, { origin: 'https://www.golfnow.com.au', facility: '16535', slug: '16535-wallacia-country-club' });
  assert.equal(golfnowSource('https://www.golfnow.com.au/tee-times/facility/16259-woodville-golf-course/search').facility, '16259');
  assert.equal(golfnowSource('https://www.golfnow.com.au/courses/-5363-woodville-golf-course-details'), null, 'a course details page is not a facility search');
  assert.equal(golfnowSource('https://georges-river-golf-course.book.teeitup.com/?course=16001'), null, 'TeeItUp pages stay TeeItUp\'s');
  for (const f of [miclubSource, teeitupSource, quick18Source]) assert.equal(f(WAL), null);
  assert.equal(golfnowPage(src), WAL);
  const b = golfnowBody(src, '2026-11-04', { lat: -33.86, lng: 150.64 });
  assert.deepEqual([b.FacilityId, b.SearchType, b.Date, b.Players, b.Holes, b.TimeMin, b.TimeMax, b.Latitude], [16535, 1, 'Nov 04 2026', '1', '3', '10', '42', -33.86]);
  assert.equal(JSON.stringify(golfnowBody(src, '2026-11-04')), JSON.stringify(golfnowBody(src, '2026-11-04')), 'the same course and day send the same search, so it is asked once');
});

test('an answer becomes rates: each time with its spots, holes and price, hot deals named, other days left out', () => {
  const rates = parseGolfnow(JSON.stringify(ANSWER), golfnowSource(WAL), '2026-11-04');
  assert.deepEqual(rates.map(r => [r.name, r.holes, r.price, r.special, r.times.map(t => [t.time, t.free])]), [
    ['18 Holes', 18, 25, false, [['07:10', 4]]],
    ['Prepaid - Online Rate (Hot Deal)', 18, 19, true, [['09:40', 2]]],
    ['9 Holes', 9, 20, false, [['07:10', 4]]],
    ['Unlimited after 1pm', null, 10, false, [['13:20', 4]]],
  ], 'player rule 15 is up to four, 3 up to two; a count when given; 5 Nov is another day');
  assert.equal(rates[0].url, WAL);
  assert.deepEqual(parseGolfnow('{"ttResults":{"teeTimes":[]}}', golfnowSource(WAL), '2026-11-04'), [], 'a day with nothing is empty, not unreadable');
  assert.equal(parseGolfnow('{"ttResults":{"teeTimes":[{"time":"2026-11-04T07:10:00","teeTimeRates":[]}]}}', golfnowSource(WAL), '2026-11-04'), null, 'times whose spots can\'t be told: unreadable, never a guess');
  for (const bad of ['<html>Access denied</html>', '{"error":"x"}', '[]']) assert.equal(parseGolfnow(bad, golfnowSource(WAL), '2026-11-04'), null, bad);
});

/* ---------- the route, against a stand-in GolfNow ---------- */

const DATA = mkdtempSync(join(tmpdir(), 'carry-gn-'));
const PORT = 8185;
const base = `http://127.0.0.1:${PORT}`;
let proc, fake, seen = [], reply = () => [200, JSON.stringify(ANSWER)];

before(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c)).on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], ua: req.headers['user-agent'], body: body ? JSON.parse(body) : null });
      const [code, out] = reply(); res.writeHead(code, { 'content-type': 'application/json' }); res.end(out);
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, DEV_USER: 'me@example.com', ANTHROPIC_API_KEY: '', TEETIMES_TTL_MS: '0', GOLFNOW_API: `http://127.0.0.1:${fake.address().port}` } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await fetch(`${base}/api/courses/c_wal`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'c_wal', v: 2, name: 'Wallacia', holes: [], lat: -33.86, lng: 150.64, bookable: true, bookingUrl: WAL }) });
});
after(() => { proc && proc.kill(); fake && fake.close(); rmSync(DATA, { recursive: true, force: true }); });
const get = path => fetch(base + path).then(async r => ({ status: r.status, body: await r.json() }));

test('a GolfNow course: the facility search is POSTed for the day, and the times come back filtered', async () => {
  const r = await get('/api/teetimes/c_wal?date=2026-11-04&players=3&holes=18');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.source, 'GolfNow');
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].type], ['POST', '/api/tee-times/tee-time-results', 'application/json']);
  assert.match(seen[0].ua, /^Carry\//);
  assert.deepEqual([seen[0].body.FacilityId, seen[0].body.Date, seen[0].body.Latitude], [16535, 'Nov 04 2026', -33.86], 'the course\'s own place');
  assert.deepEqual(r.body.rates.map(x => [x.name, x.times.map(t => t.time), x.listed]), [['18 Holes', ['07:10'], 1], ['Prepaid - Online Rate (Hot Deal)', [], 1], ['Unlimited after 1pm', ['13:20'], 1]],
    'the 9:40 hot deal has room for two, not three; a rate that doesn\'t say its holes is never filtered out on a guess');
  assert.equal(r.body.calendar, WAL);
});

test('what GolfNow says that Carry can\'t use is said, with a sample', async () => {
  reply = () => [200, '{"ttResults":{"other":1}}'];
  const odd = await get('/api/teetimes/c_wal?date=2026-11-05');
  assert.equal(odd.body.status, 'unreadable'); assert.match(odd.body.message, /not in a form Carry can read yet/); assert.equal(odd.body.sample, '{"ttResults":{"other":1}}');
  reply = () => [403, '<html>Access denied</html>'];
  const no = await get('/api/teetimes/c_wal?date=2026-11-06');
  assert.equal(no.body.status, 'unreachable'); assert.match(no.body.message, /403/); assert.equal(no.body.sample, '<html>Access denied</html>');
  reply = () => [200, '{"ttResults":{"teeTimes":[]}}'];
  const none = (await get('/api/teetimes/c_wal?date=2026-11-07')).body;
  assert.match(none.note, /GolfNow lists no times.*pro shop may have more/);
  assert.equal(none.sample, '{"ttResults":{"teeTimes":[]}}', 'an empty day keeps what came');
  assert.deepEqual([none.sent.FacilityId, none.sent.Date], [16535, 'Nov 07 2026'], 'and the search sent');
});
