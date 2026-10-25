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
  assert.deepEqual(idx.map(x => x.id), ['bardwell-valley', 'barnwell-park', 'beverley-park', 'bondi', 'hunter-valley', 'hurstville', 'lane-cove', 'long-reef', 'massey-park', 'northbridge', 'randwick', 'the-coast']);
  for (const { id } of idx) {
    const m = mapOf(id), src = JSON.parse(readFileSync(`course-maps/src/${id}.json`, 'utf8'));
    assert.equal(m.attribution, '© OpenStreetMap contributors'); assert.equal(m.licence, 'ODbL-1.0');
    assert.deepEqual(m.origin, src.origin, 'shots are stored in this plane, so it never moves');
    // Holes 1..N with no gaps; with a card, a line for every hole on it.
    assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: m.holes.length }, (_, i) => i + 1));
    if (src.card) for (const [n] of src.card.holes) assert.ok(m.byN[n], `a line for hole ${n} on the card`);
    for (const h of m.holes) {
      const g = m.features[h.green];
      assert.equal(g.k, 'green', `hole ${h.n} ends on a green`);
      assert.ok(dist(h.line[h.line.length - 1], centroid(g.r[0])) < 0.2, `hole ${h.n} is measured to the middle of its green`);
      if (id !== 'hurstville' && id !== 'hunter-valley') assert.ok(!g.est, `hole ${h.n}'s green is mapped, not estimated`);
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

test('Bondi: nine OSM lines against the metres card; the card in yards would fit worse', () => {
  const m = mapOf('bondi'), c = card('bondi');
  assert.deepEqual(m.holes.map(h => h.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(m.holes.filter(h => HM.mismatch(h, c[h.n].metres, m).flagged).map(h => h.n), [8]);
  // The same card in yards (what 1.10's course import holds as metres) sits
  // further from the mapped lines, and flags 6 as well.
  const yards = [145, 113, 121, 150, 280, 110, 163, 128, 134];
  const off = cardOf => m.holes.reduce((s, h) => s + Math.abs(HM.mismatch(h, cardOf(h), m).diff), 0);
  assert.ok(off(h => c[h.n].metres) < off(h => yards[h.n - 1]) - 30);
  assert.deepEqual(m.holes.filter(h => HM.mismatch(h, yards[h.n - 1], m).flagged).map(h => h.n), [6, 8]);
});

test('Massey Park: every red tee on a mapped box, hole 9 with no red length', () => {
  const m = mapOf('massey-park'), c = card('massey-park');
  assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(c[5].par, 5, 'the card\'s par 5, though OSM says 4');
  assert.equal(c[9].metres, null, 'the GPS app shows no red for 9: none invented');
  const x = m.holes.map(h => HM.mismatch(h, c[h.n].metres, m));
  assert.deepEqual(x.map((y, i) => y.flagged ? i + 1 : 0).filter(Boolean), []);
  assert.ok(x[6].onTee && x[6].teeGap > 14, 'hole 7 lands right at the 15 m limit');
});

test('Long Reef: OSM lines from the back tees; three whites off every mapped box', () => {
  const m = mapOf('long-reef'), c = card('long-reef');
  assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  const x = m.holes.map(h => HM.mismatch(h, c[h.n].metres, m));
  assert.deepEqual(x.map((y, i) => y.flagged ? i + 1 : 0).filter(Boolean), [4, 11, 16]);
  // 17 runs 61 m past the white card and still lands on a mapped box.
  assert.ok(x[16].diff > 60 && x[16].onTee);
  // 15 is the one hole whose card is longer than its line: the tee goes back, onto a box.
  assert.ok(x[14].diff < -20 && x[14].onTee);
});

test('Northbridge: built from OSM alone, no card; the app checks it against the NAS card', () => {
  const m = mapOf('northbridge'), src = JSON.parse(readFileSync('course-maps/src/northbridge.json', 'utf8'));
  assert.equal(src.card, undefined, 'no screenshots: the course page does the card check live');
  assert.equal(m.holes.length, 18);
  for (const h of m.holes) assert.ok(h.tees.length >= 1, `hole ${h.n} has a mapped tee box for the check to use`);
});

test('a GPS fix lands on the map where the build put the shapes', () => {
  const m = mapOf('randwick'), geo = JSON.parse(readFileSync('course-maps/osm/randwick.geojson', 'utf8')).features;
  // Every green's first corner, projected from its lat/long now, matches the
  // committed map (built with the same projection, rounded to 0.1 m).
  for (const f of geo.filter(f => f.properties.golf === 'green').slice(0, 5)) {
    const [lng, lat] = f.geometry.coordinates[0][0];
    const built = m.features.find(x => x.osm === f.properties['@id']).r[0][0];
    assert.ok(dist(HM.fromLatLng(m, lat, lng), built) < 0.08, f.properties['@id']);
  }
  const back = HM.toLatLng(m, [123.4, -567.8]), again = HM.fromLatLng(m, back.lat, back.lng);
  assert.ok(dist(again, [123.4, -567.8]) < 1e-6, 'round trip');
  // A fix on the course is 0 m off it; one 2 km away is about 2 km off.
  const h = m.byN[1];
  assert.equal(HM.offCourse(m, h.line[1] || h.line[0]), 0);
  assert.ok(HM.offCourse(m, [2000, 0]) > 1000);
});

test('front, middle and back of the green along the line from where he stands', () => {
  const sq = [[[-10, 90], [10, 90], [10, 110], [-10, 110]]];
  const hm = { map: { features: [{ k: 'green', r: sq }] }, hole: { green: 0 }, green: [0, 100] };
  const d = HM.greenDistances(hm, [0, 0]);
  assert.ok(Math.abs(d.front - 90) <= 0.5 && Math.abs(d.middle - 100) < 1e-9 && Math.abs(d.back - 110) <= 0.5, JSON.stringify(d));
  const on = HM.greenDistances(hm, [0, 95]);
  assert.equal(on.front, 0, 'standing on the green');
  assert.ok(Math.abs(on.back - 15) <= 0.5);
  const unmapped = HM.greenDistances({ ...hm, map: { features: [] } }, [0, 0]);
  assert.deepEqual([unmapped.front, unmapped.back], [null, null], 'no green shape: only the middle, never a guessed edge');
});

test('Hurstville: OSM numbers from the old start, so its 10-18 are the front nine today', () => {
  const m = mapOf('hurstville'), c = card('hurstville'), src = JSON.parse(readFileSync('course-maps/src/hurstville.json', 'utf8'));
  const geo = JSON.parse(readFileSync('course-maps/osm/hurstville.geojson', 'utf8')).features;
  assert.deepEqual(src.origin, [-33.97247, 151.06092], 'shots already logged are stored in this frame: it never moves');
  // Every hole is one OSM line, renumbered: OSM 10 is hole 1, OSM 1 is hole 10.
  const lineOf = ref => geo.find(f => f.properties.golf === 'hole' && f.properties.ref === String(ref));
  for (let ref = 1; ref <= 18; ref++) {
    const n = (ref + 8) % 18 + 1, h = m.byN[n], osm = lineOf(ref).geometry.coordinates;
    const [x, y] = HM.fromLatLng(m, osm[0][1], osm[0][0]);
    assert.ok(Math.hypot(h.line[0][0] - x, h.line[0][1] - y) < 0.2, `hole ${n} starts where OSM hole ${ref} does`);
  }
  // Against his blue card: every tee but 18's on a mapped tee point, within 12 m.
  for (let n = 1; n <= 17; n++) {
    const x = HM.mismatch(m.byN[n], c[n].metres, m);
    assert.ok(x.onTee && !x.flagged && Math.abs(x.diff) <= 12, `hole ${n}: card ${c[n].metres}, line ${Math.round(x.line)}`);
  }
  // 18's blue tee is 38 m ahead of the one OSM maps: flagged, the tee placed from the card.
  const x18 = HM.mismatch(m.byN[18], c[18].metres, m);
  assert.ok(x18.flagged && Math.round(x18.diff) === 38 && Math.abs(lineLen(HM.playLine(m.byN[18], 285)) - 285) < 0.5);
  assert.ok(lineLen(m.byN[8].line) > 1.2 * dist(m.byN[8].line[0], m.byN[8].line.at(-1)), 'hole 8 is the dogleg, as on his GPS app');
  // No green is mapped: each is estimated on its pin, never a lie, no front or back.
  const pins = geo.filter(f => f.properties.golf === 'pin').map(f => f.properties['@id']);
  for (const h of m.holes) {
    const g = m.features[h.green], mid = h.line.at(-1);
    assert.ok(g.est && pins.includes(g.osm), `hole ${h.n}'s estimated green sits on its mapped pin`);
    assert.equal(HM.lieAt(m, mid), null);
    const d = HM.greenDistances({ map: m, hole: h, green: mid }, h.line[0]);
    assert.deepEqual([d.front, d.back], [null, null]);
    assert.equal(h.tees.length, 1, 'its tee is mapped as a point');
  }
  const hm = HM.forHole('hurstville', 3, 132);
  assert.match(HM.svg(hm, { big: true, par: 3 }), /hm-green-est/);
  assert.ok(HM.legendKinds(hm, { big: true, par: 3 }).includes('greenEst') && !HM.legendKinds(hm, { big: true, par: 3 }).includes('green'));
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

/* ---------- holes from GPS marks ---------- */
// Points inside a map's boundary, as GPS marks there would read.
const inside = (m, step = 10) => {
  const [x0, y0, x1, y1] = HM.geom.bbox(m.boundary.flat()), out = [];
  for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) if (HM.geom.inRings([x, y], m.boundary) && HM.offCourse(m, [x, y]) === 0) out.push([x, y]);
  return out;
};
// Two points inside, about `d` metres apart, each with 25 m of course around it.
const pairAt = (m, d) => {
  const pts = inside(m).filter(p => [[25, 0], [-25, 0], [0, 25], [0, -25]].every(([dx, dy]) => HM.geom.inRings([p[0] + dx, p[1] + dy], m.boundary)));
  let best = null;
  for (let i = 0; i < pts.length; i += 7) for (let j = i + 1; j < pts.length; j += 7) { const e = Math.abs(dist(pts[i], pts[j]) - d); if (!best || e < best.e) best = { e, a: pts[i], b: pts[j] }; }
  return [best.a, best.b];
};
const mark = (m, k, p, extra = {}) => { const { lat, lng } = HM.toLatLng(m, p); return { k, lat, lng, acc: 4, at: '2026-10-20T01:00:00.000Z', by: 'zein@test', ...(k === 'tee' ? { tee: 'white' } : {}), ...extra }; };
const plus = (p, dx, dy = 0) => [p[0] + dx, p[1] + dy];

test('Barnwell Park, Beverley Park and Lane Cove: a boundary and a fixed origin, holes only from marks', () => {
  for (const id of ['barnwell-park', 'beverley-park', 'lane-cove']) {
    const m = mapOf(id), src = JSON.parse(readFileSync(`course-maps/src/${id}.json`, 'utf8'));
    assert.equal(src.holes, 'marks'); assert.equal(m.holesFrom, 'your GPS marks');
    assert.deepEqual(m.holes, [], 'OSM has no hole lines here');
    assert.ok(inside(m, 25).length > 50, `${id} has a real boundary to place fixes on`);
    assert.equal(HM.forHole(id, 1, 300), null, 'no marks, no hole: never a guess');
    assert.equal(HM.forHole(id, 1, 300, { marks: [] }), null);
  }
});

test('a hole drawn from marks: the tee played to the average of the flags, the green estimated', () => {
  const m = mapOf('barnwell-park'), before = JSON.stringify(m.features), [t, g] = pairAt(m, 220);
  const marks = [mark(m, 'tee', t), mark(m, 'flag', plus(g, 4)), mark(m, 'flag', plus(g, -4))];
  const hm = HM.forHole('barnwell-park', 1, 220, { marks, tee: 'White' });
  assert.ok(hm, 'a tee and a flag are enough');
  assert.ok(dist(hm.hole.line[0], t) < 0.2 && dist(hm.green, g) < 0.2, 'from the tee mark to the mean of the flags');
  assert.deepEqual({ ...hm.fromMarks }, { flags: 2, flagsOf: 2, tees: 1, line: true });
  const green = hm.map.features[hm.hole.green];
  assert.ok(green.est && green.mk && green.h === 1, 'the green is an estimate, from marks, on this hole');
  assert.equal(HM.lieAt(hm.map, hm.green), null, 'never a green lie: he picks');
  const gd = HM.greenDistances(hm, t);
  assert.ok(gd.front === null && gd.back === null && Math.abs(gd.middle - dist(t, g)) < 1e-6, 'middle only');
  // The card still sets the length; the tee mark is a tee box for the card check.
  assert.ok(Math.abs(lineLen(hm.pl) - 220) < 0.5 && hm.check.onTee && !hm.check.flagged);
  const far = HM.forHole('barnwell-park', 1, 280, { marks, tee: 'white' });
  assert.ok(Math.abs(lineLen(far.pl) - 280) < 0.5 && far.check.flagged, 'a card 60 m longer puts the tee off every mark: flagged');
  const kinds = HM.legendKinds(hm, { big: true, par: 4 });
  for (const k of ['greenMarks', 'lineMarks', 'teeMarks']) assert.ok(kinds.includes(k), k);
  for (const k of ['green', 'greenEst', 'tee']) assert.ok(!kinds.includes(k), `no ${k}`);
  assert.match(HM.svg(hm, { big: true, par: 4 }), /hm-green-est/);
  // Built on read: the map itself is untouched, and nothing derived goes back on the marks.
  assert.equal(JSON.stringify(m.features), before); assert.deepEqual(m.holes, []);
  assert.deepEqual(Object.keys(marks[0]).sort(), ['acc', 'at', 'by', 'k', 'lat', 'lng', 'tee']);
  assert.equal(HM.forHole('barnwell-park', 2, 140, { marks }).hole.n, 2, 'marks are per hole: the app passes each hole its own');
});

test('marks have to agree: a stray flag is dropped, two that disagree draw nothing', () => {
  const m = mapOf('barnwell-park'), [t, g] = pairAt(m, 220);
  const tee = mark(m, 'tee', t);
  // Three flags, one marked on the wrong hole: the two that agree set the green.
  const three = HM.forHole('barnwell-park', 1, 220, { marks: [tee, mark(m, 'flag', plus(g, 5)), mark(m, 'flag', plus(g, -5)), mark(m, 'flag', plus(g, 0, 80))] });
  assert.ok(dist(three.green, g) < 0.2); assert.deepEqual([three.fromMarks.flags, three.fromMarks.flagsOf], [2, 3]);
  assert.equal(HM.forHole('barnwell-park', 1, 220, { marks: [tee, mark(m, 'flag', g), mark(m, 'flag', plus(g, 0, 60))] }), null, 'two flags 60 m apart: no way to tell which is right');
  assert.equal(HM.forHole('barnwell-park', 1, 220, { marks: [mark(m, 'flag', g)] }), null, 'a flag without a tee is not a hole');
  assert.equal(HM.forHole('barnwell-park', 1, 220, { marks: [tee] }), null, 'nor a tee without a flag');
  assert.equal(HM.forHole('barnwell-park', 1, 220, { marks: [tee, mark(m, 'flag', g, { acc: 15 })] }), null, 'a fix rougher than ±10 m is not used');
  const away = { ...mark(m, 'flag', g), lat: mark(m, 'flag', g).lat + 0.02 };
  assert.equal(HM.forHole('barnwell-park', 1, 220, { marks: [tee, away] }), null, 'a fix 2 km off the course is not used');
});

test('with tee marks for two tees, the line starts at the tee played, else the one nearest the card', () => {
  const m = mapOf('barnwell-park'), [back, g] = pairAt(m, 220);
  // Red 40 m nearer the green, on the same line.
  const u = [(g[0] - back[0]) / dist(back, g), (g[1] - back[1]) / dist(back, g)], red = [back[0] + u[0] * 40, back[1] + u[1] * 40];
  const marks = [mark(m, 'tee', back), mark(m, 'tee', red, { tee: 'red' }), mark(m, 'flag', g)];
  // The tee played wins even where the other set is nearer the card.
  assert.ok(dist(HM.forHole('barnwell-park', 1, 220, { marks, tee: 'Red' }).hole.line[0], red) < 0.2);
  assert.ok(dist(HM.forHole('barnwell-park', 1, 180, { marks, tee: 'white' }).hole.line[0], back) < 0.2);
  assert.ok(dist(HM.forHole('barnwell-park', 1, 182, { marks, tee: 'blue' }).hole.line[0], red) < 0.2, 'no blue marks: the set nearest the card');
  const hm = HM.forHole('barnwell-park', 1, 220, { marks, tee: 'white' });
  assert.equal(hm.hole.tees.length, 2, 'both are tee boxes for the card check');
});

test('Hunter Valley: 18 OSM lines on a partial boundary, each green estimated on its own pin', () => {
  const m = mapOf('hunter-valley'), src = JSON.parse(readFileSync('course-maps/src/hunter-valley.json', 'utf8'));
  const geo = JSON.parse(readFileSync('course-maps/osm/hunter-valley.geojson', 'utf8')).features;
  assert.equal(src.osm.course, 'way/675566513'); assert.equal(src.card, undefined, 'no card: the course page checks the NAS card');
  assert.deepEqual(m.holes.map(h => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  // 7 and 9 run partly outside OSM's partial boundary; with no course next door they still count.
  const inside = n => { const l = m.byN[n].line, L = lineLen(l); let k = 0, t = 0; for (let s = 0; s <= L; s += 5) { t++; if (HM.geom.inRings(HM.geom.pointAt(l, s), m.boundary)) k++; } return k / t; };
  assert.ok(inside(7) < 0.9 && inside(9) < 0.9 && inside(7) >= src.minInside && inside(9) >= src.minInside);
  const pins = new Map(geo.filter(f => f.properties.golf === 'pin').map(f => [f.properties['@id'], HM.fromLatLng(m, f.geometry.coordinates[1], f.geometry.coordinates[0])]));
  for (const h of m.holes) {
    const g = m.features[h.green];
    assert.ok(g.est && pins.has(g.osm), `hole ${h.n}: no green is mapped, so it's estimated on a pin`);
    assert.ok(dist(h.line.at(-1), pins.get(g.osm)) < 0.2, `hole ${h.n} ends on its own pin`);
    assert.equal(h.tees.length, 1, `hole ${h.n} has its mapped tee point`);
  }
  // 9 and 18 end 28 m apart: two greens, not one shared.
  assert.notEqual(m.byN[9].green, m.byN[18].green);
  assert.ok(dist(m.byN[9].line.at(-1), m.byN[18].line.at(-1)) > 25);
});

test('flag marks move an estimated green on a mapped line; mapped greens ignore marks', () => {
  // A line whose green is only estimated, as at Hurstville; built here on
  // Barnwell's plane so the numbers are hand-checkable.
  const base = JSON.parse(readFileSync('web/course-maps/barnwell-park.json', 'utf8')), [start, end] = pairAt(mapOf('barnwell-park'), 250), ring = [];
  for (let k = 0; k < 24; k++) ring.push([end[0] + 12 * Math.cos(k * Math.PI / 12), end[1] + 12 * Math.sin(k * Math.PI / 12)]);
  HM._put('est-line', { ...base, id: 'est-line', features: base.features.concat([{ k: 'green', est: true, h: 3, r: [ring], osm: 'node/1' }]), holes: [{ n: 3, line: [start, end], green: base.features.length, tees: [] }] });
  const m = HM.get('est-line'), h = m.byN[3];
  const marks = [mark(m, 'flag', plus(end, 9, 3)), mark(m, 'flag', plus(end, 5, -1))];
  const hm = HM.forHole('est-line', 3, 250, { marks });
  assert.ok(dist(hm.green, plus(end, 7, 1)) < 0.2, 'the green moves to the flags');
  assert.ok(dist(hm.hole.line[0], start) < 0.2 && hm.hole.line.length === h.line.length, 'the line is kept, only its end moves');
  assert.deepEqual({ ...hm.fromMarks }, { flags: 2, flagsOf: 2, tees: 0, line: false });
  assert.equal(hm.map.features.filter(f => f.k === 'green' && f.h === 3).length, 1, "one green for the hole, not the pin's and the marks' both");
  assert.ok(HM.legendKinds(hm, { par: 4 }).includes('greenMarks') && !HM.legendKinds(hm, { par: 4 }).includes('lineMarks'));
  assert.ok(dist(HM.forHole('est-line', 3, 250, { marks: [mark(m, 'flag', plus(end, 0, 120))] }).green, end) < 0.2, "flags 120 m away are another hole's: the estimate stays");
  // Randwick's greens are mapped: marks change nothing there.
  const r = mapOf('randwick'), rh = r.byN[7];
  const rm = HM.forHole('randwick', 7, 260, { marks: [mark(r, 'flag', plus(rh.line.at(-1), 8)), mark(r, 'tee', rh.line[0])] });
  assert.equal(rm.hole, rh); assert.equal(rm.fromMarks, null);
});
