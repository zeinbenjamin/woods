// Every course import in imports/ is a carry-export holding one course whose
// card adds up: holes 1..n with no gaps, a par on every hole, the primary
// tee's length mirrored in `metres`, a stroke index each hole once (when
// present), and a note on where every number came from. Bexley (2026-10-28)
// is checked against the figures three sources agree on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../imports/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

test('every import file is a carry-export with one consistent course', () => {
  assert.ok(files.length >= 4, files.join(', '));
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, dir)));
    assert.equal(d.format, 'carry-export', f);
    assert.deepEqual([d.clubs, d.sessions, d.assets], [[], [], {}], `${f}: course only`);
    assert.equal(d.courses.length, 1, f);
    const c = d.courses[0];
    assert.ok(c.id && c.name && c.tee && c.source && c.notes, `${f}: id, name, tee, source, notes`);
    assert.deepEqual(c.holes.map(h => h.n), c.holes.map((_, i) => i + 1), `${f}: holes 1..n`);
    assert.ok([9, 10, 12, 18].includes(c.holes.length), `${f}: a card size`);
    for (const h of c.holes) {
      assert.ok([3, 4, 5, 6].includes(h.par), `${f} hole ${h.n}: par`);
      assert.equal(h.metres, h.tees[c.tee], `${f} hole ${h.n}: metres is the primary tee's length`);
      assert.ok(h.metres > 50 && h.metres < 650, `${f} hole ${h.n}: a plausible length in metres`);
    }
    const sis = c.holes.filter(h => h.si != null).map(h => h.si);
    if (sis.length) assert.deepEqual(sis.slice().sort((a, b) => a - b), c.holes.map((_, i) => i + 1).slice(0, sis.length), `${f}: each stroke index once`);
    assert.ok(typeof c.lat === 'number' && typeof c.lng === 'number' && c.lat < -33 && c.lat > -35 && c.lng > 150 && c.lng < 152, `${f}: in Sydney`);
  }
});

test('Bexley: par 64, 4,097 m off the blue tees, three tee sets, 17 the hardest hole', () => {
  const c = JSON.parse(readFileSync(new URL('bexley.json', dir))).courses[0];
  assert.equal(c.holes.length, 18);
  assert.equal(c.holes.reduce((s, h) => s + h.par, 0), 64);
  assert.equal(c.holes.filter(h => h.par === 3).length, 8, 'eight par 3s');
  assert.equal(c.holes.reduce((s, h) => s + h.tees.blue, 0), 4097, 'the total GolfNSW and the club publish');
  assert.equal(c.holes.reduce((s, h) => s + h.tees.white, 0), 3891, 'hole by hole; TheGrint\'s printed total of 3,889 is its yard total converted');
  assert.equal(c.holes.reduce((s, h) => s + h.tees.red, 0), 3888);
  assert.equal(c.holes.find(h => h.si === 1).n, 17);
  assert.equal(c.holes.find(h => h.si === 18).n, 11);
  assert.equal(c.ratings, undefined, 'no rating stored: none from Golf Australia was found');
  assert.equal(c.prereg, true, 'public players register on the club site first');
});

// The 2026-10-28 batch: every course map the hole-maps chat built has an
// import, or a reason it hasn't (no card that could be trusted). Courses
// already on the NAS before the batch are not in imports/.
const ON_NAS = ['randwick', 'bardwell-valley', 'the-coast', 'bondi', 'massey-park', 'long-reef', 'northbridge', 'hurstville',
  'barnwell-park', 'beverley-park', 'lane-cove', 'hunter-valley', 'bexley', 'moore-park'];
const NO_CARD = ['brighton-lakes', 'del-rio', 'fairfield-city', 'hawkesbury-waters', 'kingdom-estate', 'kurrajong-hills',
  'orchard-hills', 'shortees', 'sylvania-par-3'];

// A course whose club has a new name the map file hasn't caught up with. The map belongs to the
// hole-maps chat; the course record carries the club's own name. Empty since Chatswood's map took
// the name Newgreens Chatswood (its old layout's shapes dropped until OSM has the new one).
// Courses whose club trades under another name than the map's (OpenStreetMap's).
const RENAMED = { liverpool: 'Oak Point Golf Club' };
test('every course map has an import, or is on the NAS already, or has no card worth storing', () => {
  const maps = JSON.parse(readFileSync(new URL('../web/course-maps/index.json', import.meta.url)));
  const missing = maps.map(m => m.id).filter(id => !ON_NAS.includes(id) && !NO_CARD.includes(id) && !files.includes(`${id}.json`));
  assert.deepEqual(missing, []);
  for (const id of NO_CARD) assert.ok(!files.includes(`${id}.json`), `${id}: listed as having no card but an import exists`);
  const byId = Object.fromEntries(maps.map(m => [m.id, m]));
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!byId[id]) continue;
    const c = JSON.parse(readFileSync(new URL(f, dir))).courses[0];
    assert.equal(c.name, RENAMED[id] || byId[id].name, `${f}: named as the map is`);
    if (byId[id].holes === 18 && id !== 'kogarah' && !RENAMED[id]) assert.equal(c.holes.length, 18, `${f}: an 18-hole map has an 18-hole card`);
  }
});

test('the batch keeps the source honest: metres add up to the totals it states, ratings are noted but never stored, and every file says where its card came from', () => {
  const batch = files.filter(f => !['bondi-golf-diggers.json', 'massey-park.json', 'moore-park.json', 'bexley.json'].includes(f));
  assert.ok(batch.length >= 70, `${batch.length} in the batch`);
  for (const f of batch) {
    const c = JSON.parse(readFileSync(new URL(f, dir))).courses[0];
    assert.match(c.source, /^Card: /, f);
    assert.match(c.notes, /No handicap rating stored/, `${f}: ratings are noted, never stored, until one from Golf Australia is in hand`);
    assert.equal(c.ratings, undefined, f);
    for (const tee of Object.keys(c.holes[0].tees)) {
      const m = c.notes.match(new RegExp(`(\\d[\\d,]*) m off the ${tee} tees`));
      if (m) assert.equal(c.holes.reduce((s, h) => s + h.tees[tee], 0), +m[1].replace(/,/g, ''), `${f}: ${tee} total as stated`);
    }
  }
});

test('Newgreens Chatswood: the club\'s 12-hole card in place of the old 18, same record, readable for tee times', () => {
  // The club's scorecard (March 2026) and course page, read 2026-10-30: par 44, 2,871 m, one distance
  // column, index 1–12 each once. Same id as the old Chatswood record, so rounds there keep their course.
  const c = JSON.parse(readFileSync(new URL('chatswood.json', dir))).courses[0];
  assert.equal(c.id, 'c_chatswood');
  assert.equal(c.name, 'Newgreens Chatswood');
  assert.deepEqual(c.holes.map(h => h.par), [4, 5, 3, 4, 3, 3, 3, 4, 4, 3, 4, 4]);
  assert.deepEqual(c.holes.map(h => h.metres), [275, 464, 183, 264, 118, 127, 137, 394, 250, 118, 238, 303]);
  assert.deepEqual(c.holes.map(h => h.si), [9, 2, 3, 6, 10, 11, 8, 1, 7, 12, 5, 4]);
  assert.equal(c.holes.reduce((s, h) => s + h.par, 0), 44);
  assert.equal(c.holes.reduce((s, h) => s + h.tees.standard, 0), 2871);
  assert.deepEqual([c.holes[1].par, c.holes[1].metres, c.holes[2].metres, c.holes[10].metres], [5, 464, 183, 238], 'the signature holes as the course page gives them');
  assert.equal(c.ratings, undefined, 'the club says the rating is to be confirmed');
  assert.match(c.bookingUrl, /^https:\/\/chatswood\.miclub\.com\.au\/guests\/bookings\/ViewPublicCalendar\.msp\?booking_resource_id=3000000$/);
  assert.deepEqual([c.bookable, c.feeWeekday, c.feeWeekend], [true, 49, 59]);
});
