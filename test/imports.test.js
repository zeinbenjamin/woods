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
