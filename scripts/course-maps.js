#!/usr/bin/env node
// Course maps from OpenStreetMap, built offline and committed.
//
//   node scripts/course-maps.js extract <id> <export.geojson> [more.geojson ...]
//       Cuts one course (and everything within 80 m of it) out of an
//       Overpass export into course-maps/osm/<id>.geojson. Run once per
//       course, or again after a fresh export.
//
//   node scripts/course-maps.js build [id ...]
//       Builds web/course-maps/<id>.json (and index.json) from
//       course-maps/src/<id>.json + course-maps/osm/<id>.geojson, and prints
//       each hole against the scorecard in the source. Output is
//       deterministic: building twice gives identical files, and a test
//       checks the committed files match what the sources build.
//
// The source file (course-maps/src/<id>.json) says which OSM course this
// is, where the hole lines come from, and the card the lengths were
// checked against:
//   holes: "osm"                 golf=hole ways inside the course, numbered by ref
//   holes: { "1": { tees: [osm id | {id, half: "nearest"}], green: osm id, via?: fairway id } }
//                                for courses OSM has no hole lines for
//   origin: [lat, lng]           the fixed zero of the course's metre plane.
//                                Never change it once rounds are logged on the
//                                map: shots are stored in these metres.
//
// Data © OpenStreetMap contributors, ODbL 1.0. The app shows the credit
// wherever a map is drawn.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'course-maps', 'src'), OSM = join(ROOT, 'course-maps', 'osm');
// COURSE_MAPS_OUT lets the test build somewhere else and compare with what's committed.
const OUT = process.env.COURSE_MAPS_OUT || join(ROOT, 'web', 'course-maps');

// The app's own geometry and tee rule, so the report says what the app will show.
const sandbox = {};
vm.runInNewContext(readFileSync(join(ROOT, 'web', 'holemap.js'), 'utf8'), sandbox);
const HM = sandbox.HoleMap;
const { dist, lineLen, pointAt, inRings, centroid, lineDist, segDist } = HM.geom;

const r1 = x => Math.round(x * 10) / 10;
const idOf = f => f.properties && (f.properties['@id'] || f.id);

/* ---------- projection: a local plane in metres ---------- */
function projector([lat0, lng0]) {
  const φ = lat0 * Math.PI / 180;
  const my = 111132.954 - 559.822 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
  const mx = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
  return ([lng, lat]) => [r1((lng - lng0) * mx), r1((lat - lat0) * my)];
}
const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const linesOf = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

/* ---------- extract ---------- */
function extract(id, exports) {
  const src = JSON.parse(readFileSync(join(SRC, id + '.json'), 'utf8'));
  const all = exports.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).features);
  const course = all.find(f => idOf(f) === src.osm.course);
  if (!course) throw new Error(`${src.osm.course} not found in the export`);
  const ring = polysOf(course.geometry).flat(1).flat(1);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 0.0008;   // about 80 m
  const near = f => { const pts = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.?\d*/g).map(Number); for (let i = 0; i < pts.length; i += 2) if (pts[i] >= x0 - pad && pts[i] <= x1 + pad && pts[i + 1] >= y0 - pad && pts[i + 1] <= y1 + pad) return true; return false; };
  const keep = ['@id', 'golf', 'natural', 'landuse', 'leisure', 'ref', 'par', 'name'];
  const wanted = f => { const p = f.properties || {}; return p.golf || ['wood', 'scrub', 'tree', 'tree_row'].includes(p.natural) || p.landuse === 'forest'; };
  const seen = new Set(), out = [];
  for (const f of all) {
    const fid = idOf(f); if (seen.has(fid)) continue;
    if (fid !== src.osm.course && !(wanted(f) && near(f))) continue;
    seen.add(fid);
    const round = c => Array.isArray(c[0]) ? c.map(round) : [+c[0].toFixed(7), +c[1].toFixed(7)];
    out.push({ type: 'Feature', properties: Object.fromEntries(keep.filter(k => f.properties[k] != null).map(k => [k, f.properties[k]])), geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } });
  }
  out.sort((a, b) => idOf(a) < idOf(b) ? -1 : 1);
  if (!existsSync(OSM)) mkdirSync(OSM, { recursive: true });
  writeFileSync(join(OSM, id + '.geojson'), JSON.stringify({ type: 'FeatureCollection', note: `Extract of OpenStreetMap data for ${src.osm.name}. © OpenStreetMap contributors, ODbL 1.0.`, features: out }) + '\n');
  console.log(`${id}: ${out.length} features → course-maps/osm/${id}.geojson`);
}

/* ---------- build helpers ---------- */
// A fairway's centreline: slice across its long axis every 6 m and join
// the middles of the widest piece.
function spine(ring) {
  const c = centroid(ring);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) { sxx += (x - c[0]) ** 2; syy += (y - c[1]) ** 2; sxy += (x - c[0]) * (y - c[1]); }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = [Math.cos(a), Math.sin(a)], nx = [-ax[1], ax[0]];
  const along = p => (p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1], across = p => (p[0] - c[0]) * nx[0] + (p[1] - c[1]) * nx[1];
  const us = ring.map(along), lo = Math.min(...us), hi = Math.max(...us), mids = [];
  for (let u = lo + 4; u < hi - 3; u += 6) {
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ua = along(ring[j]), ub = along(ring[i]);
      if ((ua > u) !== (ub > u)) { const t = (u - ua) / (ub - ua); xs.push(across(ring[j]) + (across(ring[i]) - across(ring[j])) * t); }
    }
    xs.sort((p, q) => p - q);
    let best = null; for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
    if (best) { const v = (best[0] + best[1]) / 2; mids.push([r1(c[0] + ax[0] * u + nx[0] * v), r1(c[1] + ax[1] * u + nx[1] * v)]); }
  }
  return simplify(mids, 4);
}
function simplify(pts, tol) {   // Douglas–Peucker
  if (pts.length < 3) return pts;
  let k = -1, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]).d; if (d > dmax) { dmax = d; k = i; } }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, k + 1), tol).slice(0, -1).concat(simplify(pts.slice(k), tol));
}
// Split a polygon along its long axis and keep one side (for one tee box
// shared by two holes).
function halves(ring) {
  const c = centroid(ring);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) { sxx += (x - c[0]) ** 2; syy += (y - c[1]) ** 2; sxy += (x - c[0]) * (y - c[1]); }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), n = [-Math.sin(a), Math.cos(a)];
  const side = sgn => {   // Sutherland–Hodgman against one half-plane
    const inside = p => sgn * ((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1]) >= 0, out = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], ip = inside(p), iq = inside(q);
      if (ip) out.push(p);
      if (ip !== iq) { const dp = (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1], dq = (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1], t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  return [side(1), side(-1)];
}
// Share of a line that lies inside the course, sampled every 5 m.
function insideShare(l, rings) {
  const L = lineLen(l); let n = 0, k = 0;
  for (let s = 0; s <= L; s += 5) { n++; if (inRings(pointAt(l, s), rings)) k++; }
  return n ? k / n : 0;
}
const treeRadius = id => 4.5 + ([...String(id)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 3);

/* ---------- build ---------- */
function build(id) {
  const src = JSON.parse(readFileSync(join(SRC, id + '.json'), 'utf8'));
  const geo = JSON.parse(readFileSync(join(OSM, id + '.geojson'), 'utf8')).features;
  const course = geo.find(f => idOf(f) === src.osm.course);
  if (!course) throw new Error(`${id}: course ${src.osm.course} missing from the extract`);
  if (!src.origin) throw new Error(`${id}: the source needs a fixed origin [lat, lng]`);
  const P = projector(src.origin);
  const ringsOf = poly => poly.map(r => r.map(P));
  const boundary = polysOf(course.geometry).flatMap(ringsOf);
  const ignore = src.ignore || {};

  // Shapes.
  const KIND = { green: 'green', tee: 'tee', fairway: 'fairway', bunker: 'bunker', water_hazard: 'water', lateral_water_hazard: 'water', rough: 'rough' };
  const features = [], byOsm = {};
  const push = (f, osm) => { f.osm = osm; features.push(f); (byOsm[osm] = byOsm[osm] || []).push(features.length - 1); };
  const treePts = [];
  for (const f of geo) {
    const p = f.properties, fid = idOf(f), g = f.geometry;
    if (fid === src.osm.course) continue;
    if (KIND[p.golf]) { for (const poly of polysOf(g)) push({ k: KIND[p.golf], r: ringsOf(poly) }, fid); continue; }
    if (p.golf === 'cartpath' || p.golf === 'path') { for (const l of linesOf(g)) push({ k: 'path', l: l.map(P) }, fid); continue; }
    if (['wood', 'scrub'].includes(p.natural) || p.landuse === 'forest') { for (const poly of polysOf(g)) push({ k: 'canopy', r: ringsOf(poly) }, fid); continue; }
    if (p.natural === 'tree_row') { for (const l of linesOf(g)) { const pl = l.map(P), L = lineLen(pl), c = []; for (let s = 0; s <= L; s += 6) { const q = pointAt(pl, s); c.push([r1(q[0]), r1(q[1]), 4.5]); } push({ k: 'crowns', c }, fid); } continue; }
    if (p.natural === 'tree' && g.type === 'Point') treePts.push({ p: P(g.coordinates), fid });
  }
  // Mapped single trees: 3 or more standing within 14 m of each other merge
  // into one canopy (crowns that touch); the rest stay single trees.
  const parent = treePts.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < treePts.length; i++) for (let j = i + 1; j < treePts.length; j++) if (dist(treePts[i].p, treePts[j].p) <= 14) parent[find(i)] = find(j);
  const groups = {}; treePts.forEach((t, i) => (groups[find(i)] = groups[find(i)] || []).push(t));
  for (const grp of Object.values(groups).sort((a, b) => a[0].fid < b[0].fid ? -1 : 1)) {
    if (grp.length >= 3) push({ k: 'crowns', c: grp.map(t => [t.p[0], t.p[1], 7.2]) }, grp[0].fid);
    else for (const t of grp) push({ k: 'tree', c: t.p, rad: treeRadius(t.fid) }, t.fid);
  }
  const rep = f => f.r ? centroid(f.r[0]) : f.l ? pointAt(f.l, lineLen(f.l) / 2) : Array.isArray(f.c[0]) ? f.c[0] : f.c;
  const pts = f => f.r ? f.r[0] : f.l ? f.l : Array.isArray(f.c[0]) ? f.c : [f.c];

  // Hole lines.
  const cardBy = Object.fromEntries((src.card?.holes || []).map(h => [h[0], { par: h[1], metres: h[2] }]));
  const greenOf = (osm) => { const ix = byOsm[osm]; if (!ix) throw new Error(`${id}: green ${osm} not in the extract`); return ix[0]; };
  const holes = [];
  if (src.holes === 'osm') {
    const seen = {};
    for (const f of geo) {
      if (f.properties.golf !== 'hole' || f.geometry.type !== 'LineString') continue;
      const l = f.geometry.coordinates.map(P), n = parseInt(f.properties.ref, 10);
      if (!(n > 0) || insideShare(l, boundary) < 0.9) continue;   // another course's hole next door
      if (seen[n]) throw new Error(`${id}: two hole lines numbered ${n}`);
      seen[n] = true;
      const end = l[l.length - 1];
      const gi = features.findIndex(x => x.k === 'green' && inRings(end, x.r)) >= 0 ? features.findIndex(x => x.k === 'green' && inRings(end, x.r))
        : features.reduce((b, x, i) => x.k === 'green' && (b < 0 || dist(centroid(x.r[0]), end) < dist(centroid(features[b].r[0]), end)) ? i : b, -1);
      const gc = centroid(features[gi].r[0]).map(r1);
      // End the line at the middle of the green: the card measures to it.
      const line = l.slice(0, -1).concat([gc]);
      holes.push({ n, line, green: gi, osmLine: idOf(f) });
    }
  } else {
    for (const [ns, m] of Object.entries(src.holes)) {
      const n = Number(ns), gi = greenOf(m.green), gr = features[gi], gc = centroid(gr.r[0]).map(r1);
      const card = cardBy[n] || {};
      const teeSpots = m.tees.map(t => {
        if (typeof t === 'string') { const ix = byOsm[t]; if (!ix) throw new Error(`${id}: tee ${t} not in the extract`); return { osm: t, p: centroid(features[ix[0]].r[0]) }; }
        const ix = byOsm[t.id]; if (!ix) throw new Error(`${id}: tee ${t.id} not in the extract`);
        const [h1, h2] = halves(features[ix[0]].r[0]).map(centroid);
        return { osm: t.id, p: dist(h1, gc) <= dist(h2, gc) ? h1 : h2, half: true };
      });
      const lineFrom = tp => {
        let fw = null;
        if (m.via) { const ix = byOsm[m.via]; if (!ix) throw new Error(`${id}: fairway ${m.via} not in the extract`); fw = features[ix[0]]; }
        else if (card.par >= 4) {
          // The fairway that runs into this green and starts within reach of the tee.
          let best = null;
          for (const f of features) {
            if (f.k !== 'fairway') continue;
            let sp = spine(f.r[0]); if (sp.length < 2 || lineLen(sp) < 40) continue;
            if (dist(sp[0], gc) < dist(sp[sp.length - 1], gc)) sp = sp.slice().reverse();
            if (dist(sp[sp.length - 1], gc) > 45 || dist(sp[0], tp) > 230) continue;
            const l = [tp].concat(sp, [gc]);
            if (lineLen(l) > 1.35 * dist(tp, gc)) continue;
            if (!best || lineLen(l) < lineLen(best)) best = l;
          }
          if (best) return best.map(p => p.map(r1));
        }
        if (fw) { let sp = spine(fw.r[0]); if (dist(sp[0], gc) < dist(sp[sp.length - 1], gc)) sp = sp.slice().reverse(); return [tp].concat(sp, [gc]).map(p => p.map(r1)); }
        return [tp, gc].map(p => p.map(r1));
      };
      // With several tee boxes, the line starts at the one closest to the card.
      const cands = teeSpots.map(t => ({ t, line: lineFrom(t.p) }));
      const pick = card.metres ? cands.reduce((a, b) => Math.abs(lineLen(b.line) - card.metres) < Math.abs(lineLen(a.line) - card.metres) ? b : a) : cands[0];
      holes.push({ n, line: pick.line, green: gi, teeFrom: pick.t.osm + (pick.t.half ? ' (half)' : '') });
    }
  }
  holes.sort((a, b) => a.n - b.n);

  // Which hole each shape belongs to: the nearest hole line, for shapes
  // inside the course. The rest (and anything the source says isn't part of
  // a hole) belong to none and are drawn faded.
  // A shape belongs to this course when its middle is inside the boundary
  // (a neighbour's fairway that pokes over the fence doesn't count).
  const inside = f => inRings(rep(f), boundary);
  features.forEach((f, i) => {
    if (ignore[f.osm] || !inside(f)) { f.h = null; return; }
    const own = holes.find(h => h.green === i); if (own) { f.h = own.n; return; }
    let best = null, bd = Infinity;
    for (const h of holes) { const d = Math.min(...pts(f).map(p => lineDist(p, h.line))); if (d < bd) { bd = d; best = h.n; } }
    f.h = best;
  });
  for (const h of holes) h.tees = features.map((f, i) => f.k === 'tee' && f.h === h.n && dist(centroid(f.r[0]), h.line[0]) < 40 ? i : -1).filter(i => i >= 0);

  const out = {
    v: 1, id, name: src.name,
    osm: src.osm, attribution: '© OpenStreetMap contributors', licence: 'ODbL-1.0',
    origin: src.origin, holesFrom: src.holes === 'osm' ? 'OpenStreetMap hole lines' : (src.holesSource || 'mapped by hand'),
    boundary,
    features: features.map(({ osm, ...f }) => ({ ...f, osm })),
    holes: holes.map(h => ({ n: h.n, line: h.line, green: h.green, tees: h.tees })),
  };
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, id + '.json'), JSON.stringify(out) + '\n');

  // The report: every hole against the card, as the app will flag it.
  const rows = holes.map(h => {
    const c = cardBy[h.n] || {}, mm = HM.mismatch(h, c.metres);
    return { n: h.n, par: c.par ?? '', card: c.metres ?? '', line: Math.round(mm.line), diff: mm.diff == null ? '' : Math.round(mm.diff), flagged: mm.flagged };
  });
  console.log(`\n${src.name} (${id}): ${holes.length} holes, ${features.length} shapes → web/course-maps/${id}.json`);
  console.log(`card: ${src.card ? src.card.tee + ' tees' : 'none'}`);
  for (const r of rows) console.log(`  ${String(r.n).padStart(2)}  par ${r.par}  card ${String(r.card).padStart(3)}  line ${String(r.line).padStart(3)}  ${r.diff === '' ? '' : (r.diff >= 0 ? '+' : '') + r.diff}${r.flagged ? '  ⚑ over 10%' : ''}`);
  return { id, name: src.name, osmName: src.osm.name, holes: holes.length };
}

function writeIndex() {
  const ids = readdirSync(SRC).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  const idx = ids.filter(id => existsSync(join(OUT, id + '.json'))).map(id => {
    const m = JSON.parse(readFileSync(join(OUT, id + '.json'), 'utf8'));
    return { id, name: m.name, osmName: m.osm.name, holes: m.holes.length };
  });
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(idx, null, 1) + '\n');
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'extract') { const [id, ...files] = args; if (!id || !files.length) throw new Error('usage: extract <id> <export.geojson> ...'); extract(id, files); }
else if (cmd === 'build') { const ids = args.length ? args : readdirSync(SRC).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort(); for (const id of ids) build(id); writeIndex(); }
else { console.log('usage: node scripts/course-maps.js extract <id> <export.geojson> ... | build [id ...]'); process.exit(cmd ? 1 : 0); }
