/* ============================================================
   Hole maps from OpenStreetMap
   A course can be linked to a map file (web/course-maps/<id>.json, built
   by scripts/course-maps.js from OSM data and committed to the repo).
   The file holds the course's real shapes in metres on a local plane:
   x east, y north, from a fixed origin. Nothing here is stored in the
   database; the course only records which map it uses (course.map.id).

   What this module owns, and index.html only calls:
     - loading map files (once each), and redrawing when one arrives
     - the tee rule: the tee you played sits the card distance from the
       middle of the green, along the hole line. The shapes decide where;
       the scorecard decides how far.
     - distance to the green along the line, in real metres
     - the lie under a tap: which mapped shape it lands in, or null
       ("pick one") where nothing is mapped. Rough is never assumed.
     - drawing a hole in the yardage-book style, light and dark

   Loaded as a plain script in the page (window.HoleMap). The build script
   and the tests load the same file in a sandbox, so the tee rule and the
   lie rules can't drift between the app and the build report.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- geometry (metres) ---------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lineLen = l => { let s = 0; for (let i = 1; i < l.length; i++) s += dist(l[i - 1], l[i]); return s; };
  // The point s metres along a polyline (clamped to its ends).
  function pointAt(l, s) {
    if (s <= 0) return l[0].slice();
    for (let i = 1; i < l.length; i++) {
      const d = dist(l[i - 1], l[i]);
      if (s <= d) { const k = d ? s / d : 0; return [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k]; }
      s -= d;
    }
    return l[l.length - 1].slice();
  }
  // The part of a polyline from s0 to s1 metres along it.
  function sub(l, s0, s1) {
    const out = [pointAt(l, s0)]; let acc = 0;
    for (let i = 1; i < l.length; i++) { acc += dist(l[i - 1], l[i]); if (acc > s0 && acc < s1) out.push(l[i].slice()); }
    out.push(pointAt(l, s1));
    return out;
  }
  function segDist(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
    return { d: Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t), t };
  }
  function lineDist(p, l) { let m = Infinity; for (let i = 1; i < l.length; i++) m = Math.min(m, segDist(p, l[i - 1], l[i]).d); return m; }
  // Even-odd across all rings, so holes in a polygon (an island in a pond) work.
  function inRings(p, rings) {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function centroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) { const n = ring.length; return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  const featPts = f => f.r ? f.r.flat() : f.l ? f.l : f.c && Array.isArray(f.c[0]) ? f.c.map(c => [c[0], c[1]]) : f.c ? [f.c] : [];

  /* ---------- lat/long <-> map metres ----------
     The one projection everything uses: the build script places every
     shape with it, and Play mode places a GPS fix with it, so the two can't
     disagree. A local plane from the map's fixed origin: x east, y north,
     metres per degree from the WGS84 series at the origin's latitude.
     Within a course (≤ 2 km of the origin) its error is well under 1 m. */
  function projection([lat0, lng0]) {
    const φ = lat0 * Math.PI / 180;
    const my = 111132.954 - 559.822 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
    const mx = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
    const fwd = ([lng, lat]) => [(lng - lng0) * mx, (lat - lat0) * my];
    fwd.inverse = ([x, y]) => ({ lat: lat0 + y / my, lng: lng0 + x / mx });
    return fwd;
  }
  // A GPS fix (degrees) as a point on this map, in metres.
  const fromLatLng = (map, lat, lng) => projection(map.origin)([lng, lat]);
  const toLatLng = (map, p) => projection(map.origin).inverse(p);
  // How far p is outside the course boundary (0 inside), in metres: a fix
  // 2 km away is the car park at home, not a ball in the rough.
  function offCourse(map, p) {
    if (inRings(p, map.boundary)) return 0;
    let m = Infinity;
    for (const r of map.boundary) for (let i = 1; i < r.length; i++) m = Math.min(m, segDist(p, r[i - 1], r[i]).d);
    return m;
  }
  // Front, middle and back of the green from p: where the straight line from p
  // through the middle of the green enters and leaves the mapped green.
  // middle is to the green's centre (the card's point); front/back are null
  // where the green isn't mapped as a shape.
  function greenDistances(hm, p) {
    const g = hm.green, f = hm.map.features[hm.hole.green], middle = dist(p, g);
    if (!f || !f.r || f.est || middle < 1e-6) return { front: null, middle, back: null };
    const ux = (g[0] - p[0]) / middle, uy = (g[1] - p[1]) / middle;
    let front = null, back = null, was = inRings(p, f.r);
    for (let s = 0; s <= middle + 80; s += 0.5) {
      const now = inRings([p[0] + ux * s, p[1] + uy * s], f.r);
      if (now && !was && front == null) front = s;
      if (!now && was && s > 0) back = s;
      if (!now && back != null && s > middle) break;
      was = now;
    }
    if (inRings(p, f.r)) front = 0;
    return { front, middle, back };
  }

  /* ---------- the tee rule ---------- */
  // The line you play: the mapped hole line re-anchored so its start (the
  // tee you played) is `metres` from its end (the middle of the green).
  // Shorter than the mapped line: the tee moves forward along it. Longer:
  // the tee is placed behind the mapped tee, straight back along the first leg.
  function playLine(hole, metres) {
    const l = hole.line, L = lineLen(l);
    if (!(metres > 0)) return l.map(p => p.slice());
    if (metres <= L) return sub(l, L - metres, L);
    const a = l[0], b = l[1], d = dist(a, b) || 1, k = (metres - L) / d;
    return [[a[0] - (b[0] - a[0]) * k, a[1] - (b[1] - a[1]) * k]].concat(l.map(p => p.slice()));
  }
  // How the scorecard and the map agree. OSM lines often start at the back
  // tee, so a card 60 m shorter can still be exactly right: what matters is
  // whether the tee the card puts there lands on a mapped tee box. A hole is
  // flagged (on the course page, never hidden) when the card and the line
  // are over 10% apart AND no mapped tee box of the hole is within 15 m of
  // where the card puts the tee.
  const FLAG_AT = 0.10, TEE_NEAR = 15;
  function teeGap(map, hole, p) {
    let best = Infinity;
    for (const i of hole.tees || []) {
      const f = map.features[i]; if (!f) continue;
      if (f.k === 'teept') { best = Math.min(best, dist(p, f.c)); continue; }
      if (!f.r) continue;
      if (inRings(p, f.r)) return 0;
      for (const r of f.r) for (let k = 1; k < r.length; k++) best = Math.min(best, segDist(p, r[k - 1], r[k]).d);
    }
    return best;
  }
  function mismatch(hole, metres, map) {
    const line = lineLen(hole.line);
    if (!(metres > 0)) return { line, card: null, diff: null, teeGap: null, onTee: false, flagged: false };
    const diff = line - metres, gap = map ? teeGap(map, hole, playLine(hole, metres)[0]) : Infinity;
    const onTee = gap <= TEE_NEAR;
    return { line, card: metres, diff, teeGap: gap, onTee, flagged: Math.abs(diff) / metres > FLAG_AT && !onTee };
  }
  // Metres to the middle of the green from p, along the play line: straight
  // to the next bend ahead of it, then along the line. On the last leg this
  // is the straight distance to the green.
  function toGreen(pl, p) {
    let best = 0, bd = Infinity;
    for (let i = 1; i < pl.length; i++) { const { d } = segDist(p, pl[i - 1], pl[i]); if (d < bd) { bd = d; best = i; } }
    let rest = dist(p, pl[best]);
    for (let i = best + 1; i < pl.length; i++) rest += dist(pl[i - 1], pl[i]);
    return rest;
  }

  /* ---------- the estimated fairway ----------
     A par 4 or 5 whose fairway isn't mapped gets a strip along the line:
     32 m wide, from 120 m out (or 40% of the way, if sooner) to the edge
     of the green. It's drawn dashed and never decides a lie. */
  const STRIP_W = 32, STRIP_FROM = 120;
  function stripFor(map, hole, par, pl) {
    if (!(par >= 4)) return null;
    if (map.features.some(f => f.k === 'fairway' && f.h === hole.n)) return null;
    const L = lineLen(pl), green = map.features[hole.green];
    let s1 = L;
    while (s1 > 0 && green && inRings(pointAt(pl, s1), green.r)) s1 -= 1;
    s1 -= 4;
    const s0 = Math.min(STRIP_FROM, L * 0.4);
    if (s1 - s0 < 30) return null;
    const spine = sub(pl, s0, s1), w = STRIP_W / 2, left = [], right = [];
    for (let i = 0; i < spine.length; i++) {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n;
      left.push([spine[i][0] + nx * w, spine[i][1] + ny * w]); right.push([spine[i][0] - nx * w, spine[i][1] - ny * w]);
    }
    // Round the back end (from the right side, behind the start, to the left), square at the green.
    const s = spine[0], t = spine[1], ang = Math.atan2(t[1] - s[1], t[0] - s[0]), cap = [];
    for (let k = 11; k > 0; k--) { const a = ang + Math.PI / 2 + Math.PI * k / 12; cap.push([s[0] + Math.cos(a) * w, s[1] + Math.sin(a) * w]); }
    return [left.concat(right.reverse(), cap)];
  }

  /* ---------- lies ---------- */
  // Order matters: a bunker inside a fairway outline is a bunker.
  // Tee boxes read as fairway. Anywhere nothing is mapped (including the
  // estimated strip and the rough) is null: the app asks.
  function lieAt(map, p) {
    // An estimated green is a drawing, not a measurement: it never sets a lie.
    const F = map.features, hit = k => F.some(f => f.k === k && f.r && !f.est && inRings(p, f.r));
    if (hit('water')) return 'water';
    if (hit('bunker')) return 'bunker';
    if (hit('green')) return 'green';
    if (hit('tee') || hit('fairway')) return 'fairway';
    if (hit('canopy') || F.some(f => (f.k === 'crowns' && f.c.some(c => dist(p, c) <= c[2])) || (f.k === 'tree' && dist(p, f.c) <= f.rad))) return 'trees';
    if (hit('rough')) return 'rough';
    return null;
  }

  /* ---------- the view: tee at the bottom, green at the top ---------- */
  const VW = 300, VH = 500;
  function viewOf(map, hole, pl) {
    const a = pl[0], g = pl[pl.length - 1], fl = Math.hypot(g[0] - a[0], g[1] - a[1]) || 1;
    const fwd = [(g[0] - a[0]) / fl, (g[1] - a[1]) / fl], right = [fwd[1], -fwd[0]];
    const pts = pl.concat([hole.line[0]]);
    const u = pts.map(p => p[0] * right[0] + p[1] * right[1]), v = pts.map(p => p[0] * fwd[0] + p[1] * fwd[1]);
    let u0 = Math.min(...u) - 40, u1 = Math.max(...u) + 40, v0 = Math.min(...v) - 25, v1 = Math.max(...v) + 30;
    // Fit to the 3:5 tile.
    const w = u1 - u0, h = v1 - v0;
    if (w / h < VW / VH) { const e = (h * VW / VH - w) / 2; u0 -= e; u1 += e; } else { const e = (w * VH / VW - h) / 2; v0 -= e; v1 += e; }
    const s = VH / (v1 - v0), cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const toView = p => [VW / 2 + s * (p[0] * right[0] + p[1] * right[1] - cu), VH / 2 - s * (p[0] * fwd[0] + p[1] * fwd[1] - cv)];
    const toMap = q => { const uu = (q[0] - VW / 2) / s + cu, vv = (VH / 2 - q[1]) / s + cv; return [uu * right[0] + vv * fwd[0], uu * right[1] + vv * fwd[1]]; };
    // SVG matrix(a b c d e f) for toView.
    const m = [s * right[0], -s * fwd[0], s * right[1], -s * fwd[1], VW / 2 - s * cu, VH / 2 + s * cv];
    // The view's corners on the map, to skip shapes that can't be seen.
    const corners = [[0, 0], [VW, 0], [VW, VH], [0, VH]].map(toMap);
    return { s, toView, toMap, m, box: bbox(corners) };
  }

  /* ---------- loading ---------- */
  const files = {};            // id -> map | null (failed) ; missing = not asked yet
  const waiting = {};
  let onLoad = () => {};
  let index = null;
  function prepare(map) {
    for (const f of map.features) f.bb = bbox(featPts(f));
    const byId = {}; for (const h of map.holes) byId[h.n] = h; map.byN = byId;
    return map;
  }
  // The map for `id`, or undefined while it loads (onLoad fires when it
  // arrives), or null if it can't be had.
  function get(id) {
    if (!id) return null;
    if (id in files) return files[id];
    if (!waiting[id]) waiting[id] = fetch('/course-maps/' + encodeURIComponent(id) + '.json')
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(m => { files[id] = m && m.v === 1 ? prepare(m) : null; onLoad(id); });
    return undefined;
  }
  function list() {
    if (index) return index;
    if (!waiting.__index) waiting.__index = fetch('/course-maps/index.json').then(r => r.ok ? r.json() : []).catch(() => [])
      .then(x => { index = Array.isArray(x) ? x : []; onLoad('__index'); });
    return null;
  }

  // Everything a hole needs, for a course hole or a round hole: the map,
  // its entry for this hole, and the play line for the tee in use.
  // opts.marks: the course hole's GPS marks; opts.tee: the tee played.
  function forHole(mapId, n, metres, opts = {}) {
    let map = get(mapId); if (!map) return map;   // undefined while loading, null if not available
    let hole = map.byN[n];
    if ((!hole || (map.features[hole.green] || {}).est) && opts.marks && opts.marks.length) {
      const x = withMarks(map, n, opts.marks, opts.tee, metres); if (x) ({ map, hole } = x);
    }
    if (!hole) return null;
    // A hole played along another's line (Kogarah's "1/16"): that hole's
    // shapes are this one's too, so its fairway, hazards and legend are its own.
    if (hole.share) map = lent(map, hole);
    const pl = playLine(hole, metres);
    return { map, hole, pl, tee: pl[0], green: pl[pl.length - 1], check: mismatch(hole, metres, map), fromMarks: hole.fromMarks || null };
  }

  function lent(map, hole) {
    const c = map.lent || (map.lent = {});
    return c[hole.n] || (c[hole.n] = { ...map, features: map.features.map(f => f.h === hole.share ? { ...f, h: hole.n } : f) });
  }

  /* ---------- holes from GPS marks ----------
     Where OSM has no line for a hole, or only an estimated green, the marks
     made in Play draw it: raw fixes on the course record (holes[i].marks,
     {k: 'tee' | 'flag', lat, lng, acc, tee?}). Built on every read, never
     stored. The green is a dashed estimate on the mean of the flag marks (a
     flag moves day to day, so over rounds they settle near the middle); it
     never sets a lie and gives no front or back. The tee is the mean of the
     tee marks for the tee played, and the card still sets every length.
     A set of marks has to agree: those within MARK_NEAR of the set's median
     count, and if they aren't a majority the hole isn't drawn, because a
     flag marked on the wrong hole would move the green.
     Where the course has mapped greens but no line for the hole (the C
     courses), flags on a mapped green, or within MARK_SNAP of its edge, take
     that green: the line runs to its middle, and it gives a green lie and
     front and back, as on any mapped hole. */
  const MARK_ACC = 10, MARK_NEAR = 20, MARK_OFF = 30, MARK_GREEN_MOVE = 40, MARK_SNAP = 10;
  function snapGreen(features, p) {
    const edge = r => Math.min(...r.map((q, k) => k ? segDist(p, r[k - 1], q).d : Infinity));
    let best = -1, bd = Infinity;
    features.forEach((f, i) => {
      if (f.k !== 'green' || f.est || !f.r) return;
      const d = inRings(p, f.r) ? 0 : edge(f.r[0]);
      if (d <= MARK_SNAP && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function agree(pts) {
    if (!pts.length) return null;
    const med = i => { const v = pts.map(p => p[i]).sort((a, b) => a - b), k = v.length >> 1; return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2; };
    const m = [med(0), med(1)], keep = pts.filter(p => dist(p, m) <= MARK_NEAR);
    if (keep.length * 2 <= pts.length) return null;
    const mean = i => keep.reduce((s, p) => s + p[i], 0) / keep.length;
    return { p: [f1(mean(0)), f1(mean(1))], n: keep.length, of: pts.length };
  }
  // Marks that can be used on this map: real numbers, fine enough, on the course.
  function markSets(map, marks) {
    const ok = (marks || []).filter(m => m && Number.isFinite(m.lat) && Number.isFinite(m.lng) && !(m.acc > MARK_ACC))
      .map(m => ({ m, p: fromLatLng(map, m.lat, m.lng) })).filter(x => offCourse(map, x.p) <= MARK_OFF);
    const sets = {};
    for (const x of ok) if (x.m.k === 'tee') (sets[String(x.m.tee || '').toLowerCase()] = sets[String(x.m.tee || '').toLowerCase()] || []).push(x.p);
    const tees = Object.keys(sets).sort().map(t => ({ tee: t, a: agree(sets[t]) })).filter(t => t.a);
    return { flag: agree(ok.filter(x => x.m.k === 'flag').map(x => x.p)), tees };
  }
  const circle = (c, r) => { const ring = []; for (let k = 0; k < 24; k++) { const a = 2 * Math.PI * k / 24; ring.push([f1(c[0] + r * Math.cos(a)), f1(c[1] + r * Math.sin(a))]); } return [ring]; };
  const marksCache = new WeakMap();
  function withMarks(map, n, marks, tee, metres) {
    let byKey = marksCache.get(marks); if (!byKey) marksCache.set(marks, byKey = new Map());
    const key = [map.id, n, String(tee || '').toLowerCase(), metres].join('|');
    if (!byKey.has(key)) byKey.set(key, buildMarked(map, n, marks, tee, metres));
    return byKey.get(key);
  }
  function buildMarked(map, n, marks, tee, metres) {
    const { flag, tees } = markSets(map, marks), old = map.byN[n];
    if (!flag) return null;
    if (old && dist(flag.p, old.line[old.line.length - 1]) > MARK_GREEN_MOVE) return null;   // the flags are another hole's
    if (!old && !tees.length) return null;
    const features = map.features.slice(), add = f => { f.bb = bbox(featPts(f)); features.push(f); return features.length - 1; };
    const green = { k: 'green', est: true, mk: true, h: n, r: circle(flag.p, 12) }; green.bb = bbox(featPts(green));
    const teeIx = tees.map(t => add({ k: 'teept', mk: true, h: n, c: t.a.p, tee: t.tee }));
    let hole;
    if (old) {
      // An OSM line with an estimated green: the green moves to the flags.
      features[old.green] = green;
      hole = { ...old, line: old.line.slice(0, -1).concat([flag.p]), tees: (old.tees || []).concat(teeIx) };
    } else {
      // No line at all: the tee played (else the set nearest the card) to the flags.
      const want = String(tee || '').toLowerCase();
      const snap = snapGreen(features, flag.p);
      if (snap >= 0) features[snap] = { ...features[snap], h: n };
      const end = snap >= 0 ? centroid(features[snap].r[0]).map(f1) : flag.p;
      const t = tees.find(x => x.tee === want) || tees.slice().sort((a, b) => metres > 0 ? Math.abs(dist(a.a.p, end) - metres) - Math.abs(dist(b.a.p, end) - metres) : 0)[0];
      hole = { n, line: [t.a.p, end], green: snap >= 0 ? snap : add(green), tees: teeIx };
    }
    hole.fromMarks = { flags: flag.n, flagsOf: flag.of, tees: tees.reduce((s, t) => s + t.a.n, 0), line: !old, ...(hole.green !== undefined && !features[hole.green].est ? { snapped: true } : {}) };
    return { map: { ...map, features, byN: { ...map.byN, [n]: hole } }, hole };
  }

  /* ---------- drawing ---------- */
  const f1 = x => Math.round(x * 10) / 10;
  const pathOf = rings => rings.map(r => 'M' + r.map(p => f1(p[0]) + ',' + f1(p[1])).join('L') + 'Z').join('');
  const vis = (f, box) => f.bb && !(f.bb[2] < box[0] || f.bb[0] > box[2] || f.bb[3] < box[1] || f.bb[1] > box[3]);
  // Scalloped canopy edges: small crowns along every wooded outline.
  function scallops(f) {
    if (f._sc) return f._sc;
    const out = [];
    for (const r of f.r.slice(0, 1)) { const L = lineLen(r); const n = Math.max(3, Math.floor(L / 7)); for (let i = 0; i < n; i++) { const p = pointAt(r, L * i / n); out.push([p[0], p[1], 4]); } }
    return (f._sc = out);
  }
  const DEFS = `<defs>
<pattern id="hm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hm-hatch-l"/></pattern>
<pattern id="hm-stip" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="2" r=".55" class="hm-stip-d"/><circle cx="5" cy="5.5" r=".55" class="hm-stip-d"/></pattern>
<pattern id="hm-sand" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx=".75" cy=".75" r=".35" class="hm-sand-d"/><circle cx="2.25" cy="2.25" r=".35" class="hm-sand-d"/></pattern>
<pattern id="hm-wave" width="7" height="3.5" patternUnits="userSpaceOnUse"><path d="M0,1.75 q1.75,-1.5 3.5,0 t3.5,0" class="hm-wave-l"/></pattern>
<pattern id="hm-canh" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><line x1="0" y1="0" x2="0" y2="3" class="hm-canh-l"/></pattern>
</defs>`;

  // hm: forHole(...) result. opts: big, shots [[x,y],...] with pen flags,
  // dots [{p, first}], par, attrs.
  function svg(hm, opts = {}) {
    const { map, hole, pl } = hm, n = hole.n, big = !!opts.big;
    const view = viewOf(map, hole, pl), box = view.box, V = view.toView;
    const own = f => f.h === n, cls = f => own(f) ? '' : ' hm-other';
    const F = map.features.filter(f => vis(f, box));
    let g = `<path class="hm-course" d="${pathOf(map.boundary)}"/><path class="hm-stipple" d="${pathOf(map.boundary)}"/>`;
    for (const f of F) if (f.k === 'rough') g += `<path class="hm-rough${cls(f)}" d="${pathOf(f.r)}"/>`;
    for (const f of F) if (f.k === 'fairway') g += `<path class="hm-fw${cls(f)}" d="${pathOf(f.r)}"/>`;
    const strip = stripFor(map, hole, opts.par, pl);
    if (strip) g += `<path class="hm-fwe" d="${pathOf(strip)}"/>`;
    for (const f of F) if (f.k === 'water') g += `<g class="${cls(f)}"><path class="hm-water" d="${pathOf(f.r)}"/><path class="hm-wave" d="${pathOf(f.r)}"/></g>`;
    // Canopy: outlines first, fills over them, so touching crowns read as
    // one canopy with a single scalloped edge.
    let edge = '', fill = '';
    for (const f of F) {
      if (f.k === 'canopy') { const d = pathOf(f.r); edge += `<path d="${d}"/>`; fill += `<path d="${d}"/>`; for (const c of scallops(f)) { const e = `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${c[2]}"/>`; edge += e; fill += e; } }
      if (f.k === 'crowns') for (const c of f.c) { const e = `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${c[2]}"/>`; edge += e; fill += e; }
    }
    if (fill) g += `<g class="hm-can-edge">${edge}</g><g class="hm-can">${fill}</g><g class="hm-can-h">${fill}</g>`;
    for (const f of F) if (f.k === 'tree') g += `<circle class="hm-tree" cx="${f1(f.c[0])}" cy="${f1(f.c[1])}" r="${f.rad}"/>` + (big ? `<circle class="hm-tree-in" cx="${f1(f.c[0])}" cy="${f1(f.c[1])}" r="${f1(f.rad * 0.45)}"/>` : '');
    for (const f of F) if (f.k === 'path') g += `<polyline class="hm-path${cls(f)}" points="${f.l.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ')}"/>`;
    for (const f of F) if (f.k === 'tee') g += `<path class="hm-tee${cls(f)}" d="${pathOf(f.r)}"/>`;
    for (const f of F) if (f.k === 'teept') { const [x, y] = f.c; g += `<rect class="hm-tee${cls(f)}" x="${f1(x - 3)}" y="${f1(y - 3)}" width="6" height="6"/>`; }
    for (const f of F) if (f.k === 'green') { const own = map.features.indexOf(f) === hole.green;
      g += f.est ? `<path class="hm-green-est${own ? '' : ' hm-other'}" d="${pathOf(f.r)}"/>`
        : (own ? `<path class="hm-collar" d="${pathOf(f.r)}"/>` : '') + `<path class="hm-green${own ? '' : ' hm-other'}" d="${pathOf(f.r)}"/>`; }
    for (const f of F) if (f.k === 'bunker') g += `<g class="${cls(f)}"><path class="hm-bunker" d="${pathOf(f.r)}"/><path class="hm-sandd" d="${pathOf(f.r)}"/></g>`;
    const gc = hm.green;
    if (big) for (const m of [50, 100, 150, 200]) if (m < lineLen(pl) - 25) g += `<circle class="hm-arc" cx="${f1(gc[0])}" cy="${f1(gc[1])}" r="${m}"/>`;
    g += `<polyline class="hm-line" points="${pl.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ')}"/>`;

    // In view units: labels, flag, tee marker, shots. They keep their size
    // whatever the hole's scale.
    const P = p => V(p).map(f1);
    let o = '';
    if (big) for (const m of [50, 100, 150, 200]) {
      if (m >= lineLen(pl) - 25) continue;
      // Label where the arc crosses the play line.
      let s = lineLen(pl); while (s > 0 && dist(pointAt(pl, s), gc) < m) s -= 1;
      const [x, y] = P(pointAt(pl, s));
      o += `<text class="hm-lab" x="${f1(x + 6)}" y="${f1(y - 3)}">${m}</text>`;
    }
    const [tx, ty] = P(hm.tee);
    o += `<circle class="hm-teemark" cx="${tx}" cy="${ty}" r="${big ? 4.5 : 6}"/>`;
    const [fx, fy] = P(gc), fh = big ? 18 : 28;
    o += `<line class="hm-pole" x1="${fx}" y1="${fy}" x2="${fx}" y2="${f1(fy - fh)}"/><path class="hm-cloth" d="M${fx},${f1(fy - fh)} l${big ? 10 : 15},${big ? 3.5 : 5} l-${big ? 10 : 15},${big ? 3.5 : 5}z"/>`;
    const shots = opts.shots || [];
    if (shots.length) {
      const pts = [P(hm.tee)].concat(shots.map(s => P(s.p)));
      o += `<polyline class="hm-trace" points="${pts.map(q => q.join(',')).join(' ')}"/>`;
      o += shots.map((s, i) => `<circle class="hm-ball${s.pen ? ' pen' : ''}" cx="${pts[i + 1][0]}" cy="${pts[i + 1][1]}" r="${big ? 4.5 : 7}"/>`).join('');
    }
    for (const d of opts.dots || []) { const [x, y] = P(d.p); o += `<circle class="hm-dot${d.first ? ' first' : ''}" cx="${x}" cy="${y}" r="${big ? 4 : 7}"/>`; }
    return `<svg class="stencil holemap" viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" ${opts.attrs || ''}>${DEFS}` +
      `<rect class="hm-off" width="${VW}" height="${VH}"/><rect class="hm-offh" width="${VW}" height="${VH}"/>` +
      `<g transform="matrix(${view.m.map(x => +x.toFixed(5)).join(' ')})">${g}</g>${o}</svg>`;
  }
  /* ---------- the legend ----------
     What each mark means, for the hole in view only: a dry hole has no
     "water" entry. Swatches use the map's own classes, so they follow
     light and dark with it. */
  const LEGEND = [
    ['green', 'Green', '<rect class="hm-green" x="3" y="2" width="16" height="10" rx="5"/>'],
    ['greenEst', 'Estimated green (not mapped)', '<rect class="hm-green-est" x="3" y="2" width="16" height="10" rx="5"/>'],
    ['greenMarks', 'Green estimated from your flag marks', '<rect class="hm-green-est" x="3" y="2" width="16" height="10" rx="5"/>'],
    ['lineMarks', 'Hole line from your GPS marks', '<line class="hm-line" x1="1" y1="7" x2="21" y2="7"/>'],
    ['fairway', 'Fairway', '<rect class="hm-fw" x="1" y="3" width="20" height="8" rx="3"/>'],
    ['strip', 'Estimated fairway', '<rect class="hm-fwe" x="1" y="3" width="20" height="8" rx="3"/>'],
    ['tee', 'Tee box', '<rect class="hm-tee" x="6" y="3" width="10" height="8" rx="1"/>'],
    ['teeMarks', 'Your tee marks', '<rect class="hm-tee" x="8" y="4" width="6" height="6"/>'],
    ['bunker', 'Bunker', '<ellipse class="hm-bunker" cx="11" cy="7" rx="8" ry="5"/><ellipse class="hm-sandd" cx="11" cy="7" rx="8" ry="5"/>'],
    ['water', 'Water', '<rect class="hm-water" x="1" y="2" width="20" height="10" rx="4"/><rect class="hm-wave" x="1" y="2" width="20" height="10" rx="4"/>'],
    ['trees', 'Trees', '<g class="hm-can-edge"><circle cx="7" cy="7" r="5"/><circle cx="15" cy="7" r="5"/></g><g class="hm-can"><circle cx="7" cy="7" r="5"/><circle cx="15" cy="7" r="5"/></g><g class="hm-can-h"><circle cx="7" cy="7" r="5"/><circle cx="15" cy="7" r="5"/></g>'],
    ['rough', 'Rough or unmapped (you pick the lie)', '<rect class="hm-course" x="1" y="2" width="20" height="10"/><rect class="hm-stipple" x="1" y="2" width="20" height="10"/>'],
    ['off', 'Off the course', '<rect class="hm-off" x="1" y="2" width="20" height="10"/><rect class="hm-offh" x="1" y="2" width="20" height="10"/><rect class="hm-edge" x="1" y="2" width="20" height="10"/>'],
    ['path', 'Path', '<line class="hm-path" x1="1" y1="7" x2="21" y2="7"/>'],
    ['teemark', 'Your tee', '<circle class="hm-teemark" cx="11" cy="7" r="4.5"/>'],
    ['shot', 'Shot', '<polyline class="hm-trace" points="1,11 11,7"/><circle class="hm-ball" cx="13" cy="6" r="4"/>'],
    ['arc', 'Metres to the green', '<path class="hm-arc" d="M1,12 Q11,0 21,12"/>'],
    ['other', 'Faded: another hole', '<rect class="hm-green hm-other" x="3" y="2" width="16" height="10" rx="5"/>'],
  ];
  // Which entries this hole's view needs. opts as for svg().
  function legendKinds(hm, opts = {}) {
    const { map, hole, pl } = hm, n = hole.n, box = viewOf(map, hole, pl).box;
    const F = map.features.filter(f => vis(f, box)), has = k => F.some(f => f.k === k);
    const out = new Set(['rough', 'off', 'teemark']);
    if (F.some(f => f.k === 'green' && !f.est)) out.add('green');
    if (F.some(f => f.k === 'green' && f.est && !f.mk)) out.add('greenEst');
    if (F.some(f => f.k === 'green' && f.mk)) out.add('greenMarks');
    if (hole.fromMarks && hole.fromMarks.line) out.add('lineMarks');
    if (F.some(f => f.k === 'teept' && !f.mk)) out.add('tee');
    if (F.some(f => f.k === 'teept' && f.mk)) out.add('teeMarks');
    if (has('fairway')) out.add('fairway');
    if (stripFor(map, hole, opts.par, pl)) out.add('strip');
    for (const k of ['tee', 'bunker', 'water', 'path']) if (has(k)) out.add(k);
    if (has('canopy') || has('crowns') || has('tree')) out.add('trees');
    if ((opts.shots || []).length) out.add('shot');
    if (opts.big && lineLen(pl) > 75) out.add('arc');
    if (F.some(f => ['green', 'tee', 'fairway', 'bunker', 'water', 'path'].includes(f.k) && f.h !== n && map.features.indexOf(f) !== hole.green)) out.add('other');
    return LEGEND.map(e => e[0]).filter(k => out.has(k));
  }
  function legend(hm, opts = {}) {
    const want = new Set(legendKinds(hm, opts));
    return `<div class="hm-legend" id="mapLegend"><svg class="holemap" width="0" height="0" aria-hidden="true" style="position:absolute">${DEFS}</svg>` +
      LEGEND.filter(e => want.has(e[0])).map(([k, label, sw]) => `<span data-k="${k}"><svg class="holemap" viewBox="0 0 22 14" aria-hidden="true">${sw}</svg>${label}</span>`).join('') + `</div>`;
  }

  // A tap at view coordinates, as a point on the map.
  function tapToMap(hm, q) { return viewOf(hm.map, hm.hole, hm.pl).toMap(q); }

  /* ---------- artwork taps onto the map ----------
     For converting rounds traced on hole artwork (image pixels). The
     artwork's path is tee → (turn) → green; a tap is read as how far along
     that path it is and how far to one side, both scaled by the hole's
     length over the path's, and laid along the play line for the tee
     played. Approximate by nature: the artwork was drawn by hand. Behind
     the tee or past the green it carries on straight. null when the hole
     or the artwork can't be placed. */
  function fromArt(hm, art, p) {
    if (!hm || !hm.pl || !art || !Array.isArray(art.tee) || !Array.isArray(art.green) || !Array.isArray(p)) return null;
    // Image y runs down; flip it so left and right mean the same on both.
    const up = q => [q[0], -q[1]];
    const path = [art.tee].concat(Array.isArray(art.turn) ? [art.turn] : [], [art.green]).map(up), q = up(p);
    const La = lineLen(path), Lm = lineLen(hm.pl);
    if (!(La > 0) || !(Lm > 0) || !q.every(Number.isFinite)) return null;
    const k = Lm / La;
    // Along and across on the artwork, the end segments extended.
    let best = null;
    for (let i = 1, s = 0; i < path.length; i++) {
      const a = path[i - 1], b = path[i], len = dist(a, b) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      let t = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy;
      if (i > 1) t = Math.max(0, t);
      if (i < path.length - 1) t = Math.min(len, t);
      const side = (q[1] - a[1]) * ux - (q[0] - a[0]) * uy, off = Math.hypot(q[0] - (a[0] + ux * t), q[1] - (a[1] + uy * t));
      if (!best || off < best.off) best = { off, along: s + t, side: Math.sign(side) * off };
      s += len;
    }
    // The same along and across on the play line.
    const s = best.along * k, pl = hm.pl;
    let i = 1, acc = 0;
    while (i < pl.length - 1 && acc + dist(pl[i - 1], pl[i]) < s) { acc += dist(pl[i - 1], pl[i]); i++; }
    const a = pl[i - 1], b = pl[i], len = dist(a, b) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, t = s - acc;
    const x = a[0] + ux * t - uy * best.side * k, y = a[1] + uy * t + ux * best.side * k;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }
  function mapToView(hm, p) { return viewOf(hm.map, hm.hole, hm.pl).toView(p); }

  /* ---------- course icons ----------
     A whole course at list size: its outline, fairways, water and greens,
     north up in a 100-unit square, simplified to under a pixel at 56 px.
     The build writes one per map into icons.json (iconOf), so the Courses
     list never loads a map file; icon() draws it, iconTile() falls back to
     the course's initials where there is no map. Greens are dots (a 25 m
     green is 1-2 px there), an estimated green a hollow one. */
  const ICON = 100, ICON_PAD = 2, ICON_TOL = 0.8;
  const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function simplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [i, j] = st.pop(); let m = -1, md = 0;
      for (let k = i + 1; k < j; k++) { const d = segDist(pts[k], pts[i], pts[j]).d; if (d > md) { md = d; m = k; } }
      if (md > tol) { keep[m] = 1; st.push([i, m], [m, j]); }
    }
    return pts.filter((_, k) => keep[k]);
  }
  const ringArea = r => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  function iconOf(map) {
    const all = map.boundary.flat(); if (!all.length) return null;
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = (ICON - 2 * ICON_PAD) / Math.max(x1 - x0, y1 - y0, 1);
    const ox = (ICON - sc * (x1 - x0)) / 2, oy = (ICON - sc * (y1 - y0)) / 2;
    const v = p => [Math.round(ox + (p[0] - x0) * sc), Math.round(oy + (y1 - p[1]) * sc)];
    const ring = r => { const q = simplify(r.map(v), ICON_TOL).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]); return q.length > 2 && ringArea(q) >= 2 ? 'M' + q.map(p => p.join(' ')).join(' ') + 'Z' : ''; };
    const inside = f => inRings(centroid(f.r[0]), map.boundary);
    const shapes = k => map.features.filter(f => k.includes(f.k) && f.r && !f.est && inside(f)).map(f => f.r.map(ring).join('')).join('');
    const out = { b: map.boundary.map(ring).join('') };
    const fw = shapes(['fairway', 'tee']), w = shapes(['water']);
    if (fw) out.f = fw; if (w) out.w = w;
    const dot = (c, a) => { const p = v(c); return [p[0], p[1], Math.max(1, Math.round(Math.sqrt(a / Math.PI) * sc * 10) / 10)]; };
    const g = map.features.filter(f => f.k === 'green' && f.r && !f.est && inside(f)).map(f => dot(centroid(f.r[0]), ringArea(f.r[0])));
    if (g.length) out.g = g;
    const e = (map.holes || []).filter(h => (map.features[h.green] || {}).est).map(h => v(h.line[h.line.length - 1]));
    if (e.length) out.e = e;
    return out;
  }
  let icons = null;
  function iconSet() {
    if (icons) return icons;
    if (!waiting.__icons) waiting.__icons = fetch('/course-maps/icons.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))
      .then(x => { icons = x && typeof x === 'object' ? x : {}; onLoad('__icons'); });
    return null;
  }
  // The icon for a map id, as an SVG string; null while icons.json loads or when the map has none.
  function icon(id, opts = {}) {
    const set = opts.icons || iconSet(), d = set && set[id]; if (!d) return null;
    const size = opts.size || 56, cid = 'hmi-' + String(id).replace(/[^\w-]/g, '');
    const dots = (a, cls) => (a || []).map(p => `<circle class="${cls}" cx="${p[0]}" cy="${p[1]}" r="${p[2] || 1.3}"/>`).join('');
    return `<svg class="hm-icon" width="${size}" height="${size}" viewBox="0 0 ${ICON} ${ICON}" role="img" aria-label="${esc(opts.title || 'Course map')}"><defs><clipPath id="${cid}"><path d="${d.b}"/></clipPath></defs>` +
      `<path class="i-course" d="${d.b}"/><g clip-path="url(#${cid})">${d.f ? `<path class="i-fw" d="${d.f}"/>` : ''}${d.w ? `<path class="i-water" d="${d.w}"/>` : ''}${dots(d.g, 'i-green')}${dots(d.e, 'i-green i-est')}</g>` +
      `<path class="i-edge" d="${d.b}"/></svg>`;
  }
  // The course's initials in the same tile, for a course with no map (or before icons.json arrives).
  function initials(name) {
    const w = String(name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/).filter(x => x && !/^(golf|club|course|the|country|links|public|resort|and|&)$/i.test(x));
    return (w.slice(0, 2).map(x => x[0]).join('') || '?').toUpperCase();
  }
  function iconTile(id, name, opts = {}) {
    const size = opts.size || 56;
    return icon(id, { ...opts, size, title: name }) ||
      `<svg class="hm-icon hm-icon-none" width="${size}" height="${size}" viewBox="0 0 ${ICON} ${ICON}" role="img" aria-label="${esc(name || 'Course')}"><text x="50" y="52" text-anchor="middle" dominant-baseline="middle">${esc(initials(name))}</text></svg>`;
  }

  /* ---------- style A, light and dark ---------- */
  const LIGHT = '--hm-bg:#efe8d4;--hm-hatch:#c3b894;--hm-rough:#dfe5c6;--hm-stip:#6f8a5a;--hm-ink:#2b3a2c;--hm-fw:#b6cf8e;--hm-fwe:#cddcab;--hm-green:#d7e6b5;--hm-collar:#c4d8a0;--hm-sand:#f1e2b5;--hm-sanddot:#9c8650;--hm-water:#a9cbe0;--hm-wave:#4d7fa3;--hm-can:#8fae78;--hm-canh:#3f5e37;--hm-path:#8d8468;--hm-flag:#b8432b;--hm-ball:#ffffff;--hmi-tile:var(--paper-2, #ECEFE9);--hmi-course:#dfe5c6;--hmi-fw:#b6cf8e;--hmi-green:#eef4da;--hmi-water:#a9cbe0;--hmi-ink:#2b3a2c;';
  const DARK = '--hm-bg:#171b16;--hm-hatch:#2f3529;--hm-rough:#27301f;--hm-stip:#4f6040;--hm-ink:#d8d0b8;--hm-fw:#3f5a31;--hm-fwe:#34482a;--hm-green:#61814a;--hm-collar:#4b6a3a;--hm-sand:#8e7d4f;--hm-sanddot:#d2bd85;--hm-water:#2d5169;--hm-wave:#79a6c6;--hm-can:#2c4429;--hm-canh:#1a2a18;--hm-path:#8f8a78;--hm-flag:#e0674d;--hm-ball:#e9e3d0;--hmi-tile:var(--paper-2, #182119);--hmi-course:#34422b;--hmi-fw:#557a42;--hmi-green:#9cbf7c;--hmi-water:#3d6c8c;--hmi-ink:#c9c2a8;';
  const CSS = `:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
.holemap .hm-off{fill:var(--hm-bg)} .holemap .hm-offh{fill:url(#hm-hatch)} .holemap .hm-hatch-l{stroke:var(--hm-hatch);stroke-width:1}
.holemap .hm-course{fill:var(--hm-rough);stroke:var(--hm-ink);stroke-width:.8;vector-effect:non-scaling-stroke} .holemap .hm-stipple{fill:url(#hm-stip)} .holemap .hm-stip-d{fill:var(--hm-stip)}
.holemap .hm-rough{fill:var(--hm-rough)}
.holemap .hm-fw,.holemap .hm-tee{fill:var(--hm-fw);stroke:var(--hm-ink);stroke-width:1;vector-effect:non-scaling-stroke}
.holemap .hm-fwe{fill:var(--hm-fwe);stroke:var(--hm-ink);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.holemap .hm-water{fill:var(--hm-water);stroke:var(--hm-ink);stroke-width:1;vector-effect:non-scaling-stroke} .holemap .hm-wave{fill:url(#hm-wave)} .holemap .hm-wave-l{fill:none;stroke:var(--hm-wave);stroke-width:.35}
.holemap .hm-can-edge{fill:none;stroke:var(--hm-ink);stroke-width:1.8;vector-effect:non-scaling-stroke} .holemap .hm-can{fill:var(--hm-can)} .holemap .hm-can-h{fill:url(#hm-canh)} .holemap .hm-canh-l{stroke:var(--hm-canh);stroke-width:.45}
.holemap .hm-tree{fill:var(--hm-can);stroke:var(--hm-ink);stroke-width:.8;vector-effect:non-scaling-stroke} .holemap .hm-tree-in{fill:none;stroke:var(--hm-ink);stroke-width:.5;vector-effect:non-scaling-stroke}
.holemap .hm-path{fill:none;stroke:var(--hm-path);stroke-width:1.8;stroke-dasharray:3 2;stroke-linecap:round;vector-effect:non-scaling-stroke}
.holemap .hm-collar{fill:none;stroke:var(--hm-collar);stroke-width:6;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.holemap .hm-green{fill:var(--hm-green);stroke:var(--hm-ink);stroke-width:1.1;vector-effect:non-scaling-stroke}
.holemap .hm-green-est{fill:var(--hm-green);fill-opacity:.55;stroke:var(--hm-ink);stroke-width:1.1;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.holemap .hm-bunker{fill:var(--hm-sand);stroke:var(--hm-ink);stroke-width:1;vector-effect:non-scaling-stroke} .holemap .hm-sandd{fill:url(#hm-sand)} .holemap .hm-sand-d{fill:var(--hm-sanddot)}
.holemap .hm-other{opacity:.5}
.holemap .hm-arc{fill:none;stroke:var(--hm-ink);stroke-width:.8;stroke-dasharray:2 3;opacity:.55;vector-effect:non-scaling-stroke}
.holemap .hm-line{fill:none;stroke:var(--hm-ink);stroke-width:.8;stroke-dasharray:1 3;opacity:.6;vector-effect:non-scaling-stroke}
.holemap .hm-lab{font:700 9.5px var(--body, sans-serif);fill:var(--hm-ink);stroke:var(--hm-bg);stroke-width:3;paint-order:stroke}
.holemap .hm-teemark{fill:var(--hm-ball);stroke:var(--hm-ink);stroke-width:1.2}
.holemap .hm-pole{stroke:var(--hm-ink);stroke-width:1.3} .holemap .hm-cloth{fill:var(--hm-flag)}
.holemap .hm-trace{fill:none;stroke:var(--hm-flag);stroke-width:1.8;stroke-dasharray:3 3}
.holemap .hm-ball{fill:var(--hm-ball);stroke:var(--hm-ink);stroke-width:1.4} .holemap .hm-ball.pen{stroke:var(--hm-flag);stroke-width:2.2}
.holemap .hm-dot{fill:var(--hm-ball);stroke:var(--hm-ink);stroke-width:1;opacity:.9} .holemap .hm-dot.first{fill:#F2C94C}
.hm-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:3px 10px;max-width:340px;margin:8px auto 2px;font-size:11px;line-height:1.3;color:var(--ink-2, #4A5A4F)}
.holemap .hm-edge{fill:none;stroke:var(--hm-ink);stroke-width:.6;opacity:.5}
.hm-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.hm-legend svg{width:22px;height:14px;flex:none;border-radius:2px}
.hm-icon{display:block;flex:none;border-radius:10px;background:var(--hmi-tile)}
.hm-icon .i-course{fill:var(--hmi-course)} .hm-icon .i-edge{fill:none;stroke:var(--hmi-ink);stroke-width:1.1;stroke-linejoin:round}
.hm-icon .i-fw{fill:var(--hmi-fw)} .hm-icon .i-water{fill:var(--hmi-water)}
.hm-icon .i-green{fill:var(--hmi-green);stroke:var(--hmi-ink);stroke-width:.45} .hm-icon .i-est{fill:none;stroke-dasharray:1 .8}
.hm-icon-none text{font:700 34px var(--cond, sans-serif);fill:var(--ink-3, #7E8B82)}`;
  function injectStyle(doc) {
    if (!doc || doc.getElementById('holemap-style')) return;
    const st = doc.createElement('style'); st.id = 'holemap-style'; st.textContent = CSS; doc.head.appendChild(st);
  }
  if (root.document) injectStyle(root.document);

  root.HoleMap = {
    get, list, forHole, svg, legend, legendKinds, tapToMap, iconOf, icon, iconTile, initials, icons: iconSet,
    projection, fromLatLng, toLatLng, offCourse, greenDistances, mapToView, lieAt, toGreen, playLine, mismatch, stripFor, fromArt,
    set onLoad(f) { onLoad = typeof f === 'function' ? f : () => {}; },
    geom: { dist, lineLen, pointAt, sub, segDist, lineDist, inRings, centroid, bbox },
    FLAG_AT, TEE_NEAR, STRIP_W, STRIP_FROM, VW, VH, ICON, MARK_ACC, MARK_NEAR, MARK_OFF, MARK_GREEN_MOVE, MARK_SNAP,
    // Tests put a map in directly; the app always goes through get().
    _put(id, m) { files[id] = m ? prepare(m) : null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
