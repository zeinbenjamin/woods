// TeeItUp (2.43.0): GolfNow's booking engine for clubs, read at Zein's
// decision. The answer below is HAND-MADE in the shape TeeItUp's page is known
// to use (this container can't reach GolfNow to copy a real one), with the
// times the live Georges River page showed for Sat 31 Oct 2026: 10:28 for one
// player at $45 (18 holes), 11:17 for up to four, 2:24 pm for one or two at
// $32 (9 holes). The first live search on the NAS is its real test; a reply
// that doesn't fit comes back unreadable with a sample of what came.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { teeitupSource, teeitupPage, parseTeeitup } from '../server/teetimes.js';

const DAY = [{
  dayInfo: {},
  teetimes: [
    { teetime: '2026-10-30T23:28:00.000Z', backNine: false, maxPlayers: 4, bookedPlayers: 3, rates: [{ name: '18 Holes', holes: 18, greenFeeWalking: 4500, allowedPlayers: [1] }] },
    { teetime: '2026-10-31T00:17:00.000Z', backNine: false, maxPlayers: 4, bookedPlayers: 0, rates: [{ name: '18 Holes', holes: 18, greenFeeWalking: 4500, allowedPlayers: [1, 2, 3, 4] }] },
    { teetime: '2026-10-31T03:24:00.000Z', backNine: true, maxPlayers: 4, bookedPlayers: 2, rates: [{ name: '9 Holes Afternoon', holes: 9, greenFeeWalking: 3200, allowedPlayers: [1, 2] }] },
  ],
}];
const GR = 'https://georges-river-golf-course.book.teeitup.com/?course=16001&date=2026-10-30&max=999999';

test('which links are TeeItUp, with the alias and GolfNow course id behind each', () => {
  assert.deepEqual(teeitupSource(GR), { alias: 'georges-river-golf-course', facility: '16001' });
  assert.deepEqual(teeitupSource('https://bardwell-valley-golf.book.teeitup.com/?course=16578'), { alias: 'bardwell-valley-golf', facility: '16578' });
  assert.equal(teeitupSource('https://bardwell-valley-golf.book.teeitup.com/'), null, 'no course id: not readable (the page redirects to it, the API needs it)');
  assert.equal(teeitupSource('https://www.golfnow.com.au/tee-times/facility/16264-marrickville-golf-club/search'), null, 'GolfNow\'s own pages are not read');
  assert.equal(teeitupPage(teeitupSource(GR), '2026-11-07'), 'https://georges-river-golf-course.book.teeitup.com/?course=16001&date=2026-11-07');
});

test('an answer becomes rates of Sydney times with spots free, dollars from cents', () => {
  const rates = parseTeeitup(JSON.stringify(DAY), teeitupSource(GR), '2026-10-31');
  assert.deepEqual(rates.map(r => [r.name, r.holes, r.price]), [['18 Holes', 18, 45], ['9 Holes Afternoon', 9, 32]]);
  assert.deepEqual(rates[0].times.map(t => [t.time, t.free, t.of]), [['10:28', 1, 4], ['11:17', 4, 4]], 'UTC moved to Sydney summer time (+11)');
  assert.deepEqual(rates[1].times[0], { time: '14:24', tee: 'Back nine', free: 2, of: 4, fees: [{ price: 32, who: '9 Holes Afternoon' }] });
  assert.equal(rates[0].url, 'https://georges-river-golf-course.book.teeitup.com/?course=16001&date=2026-10-31');
  // Without allowedPlayers, the spots left are max − booked; a time written without an offset is taken as written; dollars stay dollars.
  const plain = parseTeeitup([{ teetimes: [{ teetime: '2026-10-31T07:05:00', maxPlayers: 4, bookedPlayers: 1, rates: [{ name: 'Twilight', holes: 18, greenFeeWalking: 25 }] }] }], teeitupSource(GR), '2026-10-31');
  assert.deepEqual([plain[0].times[0].time, plain[0].times[0].free, plain[0].price], ['07:05', 3, 25]);
  assert.deepEqual(parseTeeitup('[{"teetimes": []}]', teeitupSource(GR), '2026-10-31'), [], 'a day with nothing is empty, not unreadable');
  for (const bad of ['<html>Login</html>', '{"error":"not found"}', '[]', 'null']) assert.equal(parseTeeitup(bad, teeitupSource(GR), '2026-10-31'), null, bad);
});

/* ---------- the route, against a stand-in GolfNow API ---------- */

const DATA = mkdtempSync(join(tmpdir(), 'carry-tiu-'));
const PORT = 8183;
const base = `http://127.0.0.1:${PORT}`;
let proc, fake, seen = [], reply = () => [200, JSON.stringify(DAY)];

before(async () => {
  fake = createServer((req, res) => { seen.push({ url: req.url, alias: req.headers['x-be-alias'], ua: req.headers['user-agent'] }); const [code, body] = reply(req); res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, DEV_USER: 'me@example.com', ANTHROPIC_API_KEY: '', TEETIMES_TTL_MS: '0', TEEITUP_API: `http://127.0.0.1:${fake.address().port}` } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await fetch(`${base}/api/courses/c_gr`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'c_gr', v: 2, name: 'Georges River', holes: [], bookable: true, bookingUrl: GR }) });
});
after(() => { proc && proc.kill(); fake && fake.close(); rmSync(DATA, { recursive: true, force: true }); });
const get = path => fetch(base + path).then(async r => ({ status: r.status, body: await r.json() }));

test('a TeeItUp course: the API is asked with the club\'s alias, and the times come back filtered', async () => {
  const r = await get('/api/teetimes/c_gr?date=2026-10-31&players=2');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.source, 'TeeItUp');
  assert.equal(seen[0].url, '/v2/tee-times?date=2026-10-31&facilityIds=16001');
  assert.equal(seen[0].alias, 'georges-river-golf-course');
  assert.match(seen[0].ua, /^Carry\//);
  assert.deepEqual(r.body.rates.map(x => [x.name, x.times.map(t => t.time), x.listed]), [['18 Holes', ['11:17'], 2], ['9 Holes Afternoon', ['14:24'], 1]], '10:28 has one spot, too few for two');
  assert.equal(r.body.calendar, 'https://georges-river-golf-course.book.teeitup.com/?course=16001&date=2026-10-31', 'the club\'s page for the day');
  const nine = await get('/api/teetimes/c_gr?date=2026-10-31&holes=9');
  assert.deepEqual(nine.body.rates.map(x => x.name), ['9 Holes Afternoon']);
});

test('an answer Carry can\'t read says so, with what came back, so it can be fixed', async () => {
  reply = () => [200, '{"message":"something new"}'];
  const odd = await get('/api/teetimes/c_gr?date=2026-11-01');
  assert.equal(odd.body.status, 'unreadable'); assert.match(odd.body.message, /not in a form Carry can read yet/); assert.equal(odd.body.sample, '{"message":"something new"}');
  reply = () => [403, '{"error":"missing alias"}'];
  const no = await get('/api/teetimes/c_gr?date=2026-11-02');
  assert.equal(no.body.status, 'unreachable'); assert.match(no.body.message, /403/); assert.equal(no.body.sample, '{"error":"missing alias"}');
  reply = () => [200, '[{"teetimes": []}]'];
  assert.match((await get('/api/teetimes/c_gr?date=2026-11-03')).body.note, /Nothing is open to the public/);
});
