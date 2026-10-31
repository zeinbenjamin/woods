// Quick18 (2.61.0): Lane Cove's tee sheet, read from a real copy of its page
// for Wed 4 Nov 2026 (test/fixtures/quick18-matrix.html, taken through a page
// reader; this container can't reach Quick18), and the route against a
// stand-in serving it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quick18Source, quick18Url, parseQuick18, teeitupSource, miclubSource } from '../server/teetimes.js';

const PAGE = readFileSync(new URL('./fixtures/quick18-matrix.html', import.meta.url), 'utf8');
const LC = quick18Source('https://lanecove.quick18.com');

test('which links are Quick18, and the day\'s tee sheet behind each', () => {
  assert.deepEqual(LC, { origin: 'https://lanecove.quick18.com' });
  assert.deepEqual(quick18Source('https://lanecove.quick18.com/teetimes/searchmatrix?teedate=20261101'), { origin: 'https://lanecove.quick18.com' });
  assert.equal(quick18Source('https://lanecove.quic18.com'), null, 'the NAS\'s misspelt link is not read');
  assert.equal(quick18Url(LC, '2026-11-04'), 'https://lanecove.quick18.com/teetimes/searchmatrix?teedate=20261104');
  assert.equal(teeitupSource('https://lanecove.quick18.com'), null);
  assert.equal(miclubSource('https://lanecove.quick18.com'), null);
});

test('Lane Cove\'s sheet: a rate per column, members left out, each time with its spots and its own Select link', () => {
  const rates = parseQuick18(PAGE, LC, '2026-11-04');
  assert.deepEqual(rates.map(r => [r.name, r.holes, r.price, r.times.length]), [['9 Holes', 9, 28.5, 66], ['9 Holes Concession', 9, 21, 66]],
    '6:00 to 8:50 and 9:30 to 5:20 pm (9:00–9:20 taken); from 5:30 only the members\' rate, which is left out');
  assert.deepEqual(rates[0].times[0], { time: '06:00', tee: null, free: 4, of: null, fees: [{ price: 28.5, who: '9 Holes' }], url: 'https://lanecove.quick18.com/teetimes/course/877/teetime/202611040600?psid=4454&p=0' });
  assert.equal(rates[0].times.at(-1).time, '17:20');
  assert.ok(!rates[0].times.some(t => t.time === '09:10'), 'a full time is not on the sheet');
  assert.ok(!rates.some(r => /member/i.test(r.name)));
  assert.equal(rates[0].url, 'https://lanecove.quick18.com/teetimes/searchmatrix?teedate=20261104');
});

test('players a time can still take, an inactive rate, and pages that aren\'t a sheet', () => {
  // Hand-made rows in the page's own markup, for the players wordings seen on 26 Oct ("1 or 2 players", "1 player").
  const row = (time, ampm, players, cell) => `<tr><td class="mtrxTeeTimes">${time}<div class="be_tee_time_ampm">${ampm}</div></td><td class="matrixPlayers">${players}</td>${cell}</tr>`;
  const on = (p, href) => `<td class="matrixsched"><div class="mtrxPrice">$${p}</div><div class="mtrxSelect"><a class="sexybutton teebutton" href="${href}">Select</a></div></td>`;
  const off = '<td class="matrixsched mtrxInactive"><div class="mtrxPriceNA">N/A</div></td>';
  const html = `<table class="matrixTable"><thead><tr><th class="mtrxHdrTeeTimes">Tee Time</th><th class="matrixHdrPlayers">Players</th><th class="matrixHdrSched">18 Holes</th></tr></thead><tbody>
    ${row('7:20', 'AM', '1 or 2 players', on('32.00', '/teetimes/course/877/teetime/202610270720?psid=1&amp;p=0'))}
    ${row('12:00', 'PM', '1 player', on('32.00', '/x'))}
    ${row('2:00', 'PM', '1 to 4 players', off)}</tbody></table>`;
  const [r] = parseQuick18(html, LC, '2026-10-27');
  assert.equal(r.holes, 18, 'holes from the rate\'s name');
  assert.deepEqual(r.times.map(t => [t.time, t.free]), [['07:20', 2], ['12:00', 1]], 'a rate not offered at 2 pm gives no time');
  assert.equal(r.times[0].url, 'https://lanecove.quick18.com/teetimes/course/877/teetime/202610270720?psid=1&p=0');
  assert.equal(parseQuick18('<html><body>Sign in to continue</body></html>', LC, '2026-11-04'), null, 'not a sheet: unreadable');
  assert.deepEqual(parseQuick18('<p>There are no tee times available for the date selected.</p>', LC, '2026-11-20'), [], 'a day with nothing is empty, not unreadable');
});

/* ---------- the route, against a stand-in Quick18 ---------- */

const DATA = mkdtempSync(join(tmpdir(), 'carry-q18-'));
const PORT = 8184;
const base = `http://127.0.0.1:${PORT}`;
let proc, fake, seen = [];

before(async () => {
  fake = createServer((req, res) => {
    seen.push(req.url);
    const day = new URL(req.url, 'http://x').searchParams.get('teedate');
    if (day === '20261104') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (day === '20261105') { res.writeHead(503); return res.end('down'); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>No tee times available.</p>');
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, DEV_USER: 'me@example.com', ANTHROPIC_API_KEY: '', TEETIMES_TTL_MS: '0' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await fetch(`${base}/api/courses/c_lc`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'c_lc', v: 2, name: 'Lane Cove', holes: [], bookable: true, bookingUrl: `http://127.0.0.1:${fake.address().port}/teetimes/searchmatrix` }) });
});
after(() => { proc && proc.kill(); fake && fake.close(); rmSync(DATA, { recursive: true, force: true }); });
const get = path => fetch(base + path).then(async r => ({ status: r.status, body: await r.json() }));

test('a Quick18 course: the day\'s sheet is asked for, the times come back filtered', async () => {
  const r = await get('/api/teetimes/c_lc?date=2026-11-04&from=17:00&players=3');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.source, 'Quick18');
  assert.equal(seen[0], '/teetimes/searchmatrix?teedate=20261104');
  assert.deepEqual(r.body.rates.map(x => [x.name, x.times.map(t => t.time), x.listed]), [['9 Holes', ['17:00', '17:10', '17:20'], 66], ['9 Holes Concession', ['17:00', '17:10', '17:20'], 66]]);
  assert.match(r.body.rates[0].times[0].url, /\/teetimes\/course\/877\/teetime\/202611041700\?psid=4454/);
  const eighteen = await get('/api/teetimes/c_lc?date=2026-11-04&holes=18');
  assert.deepEqual(eighteen.body.rates, []); assert.match(eighteen.body.note, /holes asked for/);
  assert.match((await get('/api/teetimes/c_lc?date=2026-11-20')).body.note, /No times are open/);
  const down = await get('/api/teetimes/c_lc?date=2026-11-05');
  assert.equal(down.body.status, 'unreachable'); assert.match(down.body.message, /503/);
});
