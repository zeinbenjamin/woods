// Course maps: the build script, the committed map files, and the rules in
// web/holemap.js that decide distances and lies (loaded exactly as the build
// script loads it, so these are the app's own rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const load = () => { const sb = {}; vm.runInNewContext(readFileSync('web/holemap.js', 'utf8'), sb); return sb.HoleMap; };
const HM = load();
const { lineLen, dist, centroid } = HM.geom;
const mapOf = id => { const m = JSON.parse(readFileSync(`web/course-maps/${id}.json`, 'utf8')); HM._put(id, m); return HM.get(id); };
const card = id => Object.fromEntries(JSON.parse(readFileSync(`course-maps/src/${id}.json`, 'utf8')).card.holes.map(h => [h[0], { par: h[1], metres: h[2] }]));

test('the committed maps are exactly what their sources build', () => {
  const out = mkdtempSync(join(tmpdir(), 'carry-maps-'));
  try {
    execFileSync('node', ['scripts/course-maps.js', 'build'], { env: { ...process.env, COURSE_MAPS_OUT: out }, stdio: 'ignore' });
    const files = readdirSync('web/course-maps').sort();
    assert.deepEqual(readdirSync(out).sort(), files);
    for (const f of files) assert.equal(readFileSync(join(out, f), 'utf8'), readFileSync(join('web/course-maps', f), 'utf8'), `${f} is out of date: run node scripts/course-maps.js build`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('every map credits OpenStreetMap and has a fixed origin', () => {
  const idx = JSON.parse(readFileSync('web/course-maps/index.json', 'utf8'));
  assert.deepEqual(idx.map(x => x.id), ['bardwell-valley', 'randwick', 'the-coast']);
  for (const { id } of idx) {
    const m = mapOf(id), src = JSON.parse(readFileSync(`course-maps/src/${id}.json`, 'utf8'));
    assert.equal(m.attribution, '© OpenStreetMap contributors'); assert.equal(m.licence, 'ODbL-1.0');
    assert.deepEqual(m.origin, src.origin, 'shots are stored in this plane, so it never moves');
    assert.equal(m.holes.length, 18);
    for (const h of m.holes) {
      const g = m.features[h.green];
      assert.equal(g.k, 'green', `hole ${h.n} ends on a green`);
      assert.ok(dist(h.line[h.line.length - 1], centroid(g.r[0])) < 0.2, `hole ${h.n} is measured to the middle of its green`);
    }
  }
});

test('Randwick: its own 18 hole lines, not the neighbour\'s, and every red tee on a mapped box', () => {
  const m = mapOf('randwick'), c = card('randwick');
  // The export had second lines numbered 13 and 14 from the course next door.
  assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.ok(Math.abs(lineLen(m.byN[13].line) - 144) < 3 && Math.abs(lineLen(m.byN[14].line) - 286) < 3);
  // 3 and 5 are 24 m and 15 m apart from the card, but the red tee lands on
  // the mapped tee box both times (hole 3's is 45 m long), so neither is flagged.
  const checks = m.holes.map(h => HM.mismatch(h, c[h.n].metres, m));
  assert.deepEqual(checks.filter(x => x.flagged).map((x, i) => i), []);
  assert.ok(checks[2].diff > 20 && checks[2].onTee && checks[4].diff > 14 && checks[4].onTee);
});

test('a neighbour\'s fairway poking over the boundary belongs to no hole', () => {
  // Randwick has no mapped fairways of its own; the ones in the extract are
  // next door. When one counted as hole 7's, the estimated strip vanished.
  const m = mapOf('randwick');
  assert.ok(m.features.some(f => f.k === 'fairway'));
  assert.ok(m.features.filter(f => f.k === 'fairway').every(f => f.h == null));
  const pl = HM.playLine(m.byN[7], 260);
  assert.ok(HM.stripFor(m, m.byN[7], 4, pl), 'par 4 without a fairway gets the estimated strip');
  assert.equal(HM.stripFor(m, m.byN[8], 3, HM.playLine(m.byN[8], 130)), null, 'par 3s never do');
});

test('Bardwell Valley: holes from the mapping, the putting green and the range left out', () => {
  const m = mapOf('bardwell-valley'), src = JSON.parse(readFileSync('course-maps/src/bardwell-valley.json', 'utf8'));
  for (const [n, e] of Object.entries(src.holes)) assert.equal(m.features[m.byN[n].green].osm, e.green, `hole ${n}'s green`);
  const greens = new Set(m.holes.map(h => m.features[h.green].osm));
  for (const osm of Object.keys(src.ignore)) assert.ok(!greens.has(osm), `${src.ignore[osm]} is not a hole's green`);
  for (const f of m.features) if (src.ignore[f.osm]) assert.equal(f.h, null, `${src.ignore[f.osm]} belongs to no hole`);
  // Holes 10 and 18 share one tee box, and each starts from its own half of it.
  const t10 = m.byN[10].line[0], t18 = m.byN[18].line[0];
  assert.ok(dist(t10, t18) > 5 && dist(t10, t18) < 40);
  // Hole 17 follows its curved fairway: the line bends, it isn't tee-to-green straight.
  assert.ok(lineLen(m.byN[17].line) > dist(m.byN[17].line[0], m.byN[17].line.at(-1)) * 1.2);
});

test('The Coast: OSM lines from the back tees, the yellows on mapped boxes, 4 and 14 by hand', () => {
  const m = mapOf('the-coast'), c = card('the-coast'), src = JSON.parse(readFileSync('course-maps/src/the-coast.json', 'utf8'));
  assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  for (const n of ['4', '14']) assert.equal(m.features[m.byN[n].green].osm, src.addHoles[n].green, `hole ${n}'s green is the one he confirmed`);
  assert.ok(Math.abs(lineLen(m.byN[4].line) - 140) < 3 && Math.abs(lineLen(m.byN[14].line) - 321) < 1);
  const x = m.holes.map(h => HM.mismatch(h, c[h.n].metres, m));
  // 2, 3 and 7 run 60-73 m past the yellow card, and the yellow tee still lands on a mapped box.
  for (const n of [2, 3, 7]) assert.ok(x[n - 1].diff > 60 && x[n - 1].onTee, `hole ${n}`);
  assert.deepEqual(x.map((y, i) => y.flagged ? i + 1 : 0).filter(Boolean), [18], 'only 18 has no box within 15 m');
});

test('Bardwell Valley flags only the hole whose yellow tee is off every mapped box', () => {
  const m = mapOf('bardwell-valley'), c = card('bardwell-valley');
  assert.deepEqual(m.holes.filter(h => HM.mismatch(h, c[h.n].metres, m).flagged).map(h => h.n), [11]);
});

test('the tee rule: the card distance from the middle of the green, along the line', () => {
  const hole = { n: 1, line: [[0, 0], [0, 100], [60, 180]] };   // 100 m, then 100 m bending right
  const L = lineLen(hole.line);
  assert.equal(L, 200);
  const short = HM.playLine(hole, 150);   // card shorter: the tee moves forward along the line
  assert.ok(Math.abs(lineLen(short) - 150) < 1e-9); assert.deepEqual([...short[0]], [0, 50]);
  const long = HM.playLine(hole, 230);    // card longer: straight back behind the mapped tee
  assert.ok(Math.abs(lineLen(long) - 230) < 1e-9); assert.deepEqual([...long[0]], [0, -30]);
  assert.equal(HM.toGreen(long, long[0]), 230, 'from the tee it is the card distance');
  // Before the bend: straight to the bend, then along. After it: straight at the green.
  assert.equal(HM.toGreen(long, [10, 40]), dist([10, 40], [0, 100]) + 100);
  assert.equal(HM.toGreen(long, [50, 150]), dist([50, 150], [60, 180]));
  // With no tee boxes to land on, flagged strictly over 10%.
  assert.equal(HM.mismatch(hole, 220).flagged, false);
  assert.equal(HM.mismatch(hole, 182).flagged, false);   // 18 m on 182 is 9.9%
  assert.equal(HM.mismatch(hole, 180).flagged, true);
  assert.equal(HM.mismatch(hole, null).flagged, false, 'no card, nothing to compare');
  // A mapped tee box where the card puts the tee clears it; 15 m is near enough, 16 isn't.
  const box = (y0, y1) => ({ k: 'tee', r: [[[-5, y0], [5, y0], [5, y1], [-5, y1]]] });
  const withBox = b => ({ features: [b] }), h2 = { ...hole, tees: [0] };
  assert.equal(HM.mismatch(h2, 150, withBox(box(45, 55))).flagged, false, 'the tee (0, 50) is on the box');
  assert.equal(HM.mismatch(h2, 150, withBox(box(65, 75))).flagged, false, '15 m short of it');
  assert.equal(HM.mismatch(h2, 150, withBox(box(66, 75))).flagged, true, '16 m short of it');
  assert.equal(HM.mismatch({ ...hole, tees: [] }, 150, withBox(box(45, 55))).flagged, true, 'another hole\'s box doesn\'t count');
});

test('lies come from the shape under the tap; nothing mapped means null, never rough', () => {
  const sq = (x, y, w) => [[[x, y], [x + w, y], [x + w, y + w], [x, y + w]]];
  const map = { features: [
    { k: 'fairway', r: sq(0, 0, 100) }, { k: 'bunker', r: sq(10, 10, 10) }, { k: 'water', r: sq(50, 50, 10) },
    { k: 'green', r: sq(80, 80, 15) }, { k: 'tee', r: sq(200, 0, 10) }, { k: 'canopy', r: sq(300, 0, 20) },
    { k: 'crowns', c: [[400, 0, 7]] }, { k: 'tree', c: [500, 0], rad: 5 }, { k: 'rough', r: sq(600, 0, 20) },
  ] };
  assert.equal(HM.lieAt(map, [15, 15]), 'bunker', 'a bunker inside a fairway is a bunker');
  assert.equal(HM.lieAt(map, [55, 55]), 'water');
  assert.equal(HM.lieAt(map, [85, 85]), 'green');
  assert.equal(HM.lieAt(map, [40, 40]), 'fairway');
  assert.equal(HM.lieAt(map, [205, 5]), 'fairway', 'a tee box plays like fairway');
  assert.equal(HM.lieAt(map, [310, 10]), 'trees');
  assert.equal(HM.lieAt(map, [404, 0]), 'trees');
  assert.equal(HM.lieAt(map, [503, 0]), 'trees');
  assert.equal(HM.lieAt(map, [610, 10]), 'rough', 'mapped rough is rough');
  assert.equal(HM.lieAt(map, [150, 150]), null, 'unmapped: he picks');
});

test('the view puts the tee at the bottom and the green at the top, and taps round-trip', () => {
  const m = mapOf('randwick');
  for (const n of [2, 7, 16]) {
    const hm = HM.forHole('randwick', n, card('randwick')[n].metres);
    const tee = HM.mapToView(hm, hm.tee), green = HM.mapToView(hm, hm.green);
    assert.ok(Math.abs(tee[0] - green[0]) < 1e-6 && tee[1] > green[1], `hole ${n} plays straight up the tile`);
    for (const q of [[20, 30], [150, 250], [280, 480]]) {
      const back = HM.mapToView(hm, HM.tapToMap(hm, q));
      assert.ok(Math.abs(back[0] - q[0]) < 1e-6 && Math.abs(back[1] - q[1]) < 1e-6);
    }
    assert.match(HM.svg(hm, { big: true, par: 4 }), /^<svg class="stencil holemap"/);
  }
  assert.ok(m.features.some(f => f.k === 'crowns'), 'mapped single trees were merged into canopy');
});
