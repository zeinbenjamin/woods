# Carry — data schema

Version **2**. Every stored document carries `v`; the page migrates on load
and writes the upgraded shape back (`migrateCourse`, `migrateSession`).
Migrations must be idempotent — they run against documents that are already
current.

Four collections: `clubs`, `courses`, `sessions`, `settings`.

**Whose (2.0.0):** every document belongs to an email (the Cloudflare
Access sign-in), stored beside it, never inside it. `courses` are shared:
one copy for everyone signed in, owner `''`, with `updated_by` recording the
last editor. `clubs`, `sessions` and `settings` are each person's own, so
ids are unique per person (two people can each have `clubs/7i` and
`settings/app`). The documents' shapes are unchanged; the app never sees an
owner. Assets carry their uploader, who alone can delete them.
Distances are **metres** throughout. Dates are `YYYY-MM-DD` strings (local
days, not timestamps — a round belongs to a calendar day).

---

## clubs/{code}

The bag. Clubs are never deleted, only retired, so historical shots keep
resolving.

```jsonc
{
  "code": "7i",              // primary key, also the id
  "name": "7 Iron",
  "category": "driver|wood|hybrid|iron|wedge|putter",
  "loft": 46,                // optional
  "order": 5,                // display order
  "nominalCarry": 110,       // what the golfer believes, carry
  "nominalTotal": 135,       // what the golfer believes, total
  "crossReading": {          // 2.24.0: Claude's reading across this club's swing readings, made on
    "on": "2026-10-28",      // request from Swing history (never on its own); `swings` are the
    "swings": ["sw_…"],      // swing ids it was read from, so newer readings can be counted;
    "thread": "…", "moved_on": "…", "still_there": "…", "carry_forward": "…",
    "confidence": "medium", "caveat": "…"   // word-limited, text only (no frames were sent)
  },
  "retired": false,
  "notes": "…"
}
```

**Invariant:** `nominalCarry` and `nominalTotal` are beliefs, never measured
values. Measured numbers are derived from shots and never written back.

---

## courses/{id}

```jsonc
{
  "id": "c_huntervalley",
  "v": 2,
  "name": "Hunter Valley Golf Club",
  "suburb": "Lovedale", "state": "NSW", "address": "…", "phone": "…",
  "website": "…", "bookingUrl": "…",
  "lat": -32.7795, "lng": 151.418,   // for distance-from-home only
  "bookable": true, "prereg": false, "walkable": true,
                                     // bookable: true public (anyone can book), false private
                                     // (members and guests), absent not known (2.39.0: never read as private)
  "closed": true,                    // optional (2.39.0): the course has shut; neither public nor private
  "bookingNote": "Register as a public member first.",  // optional (2.39.0): how to book, one line
  "feeWeekday": 45, "feeWeekend": 55,
  "created": 1790000000000,          // ms, set when added in the app (1.7.0 on); older app-made
                                     // ids carry the time too (uid), hand-made ids don't
  "tee": "white",                    // primary tee: which set `metres` mirrors
  "ratings": {                       // for the handicap estimate, typed from the scorecard
    "white": { "cr": 69.5, "slope": 121 }   // course (scratch) rating and slope, per tee (key lower case,
                                            // matched to a round's tee ignoring case);
  },                                 // a 9-hole card carries 9-hole ratings
  "notes": "…", "source": "club scorecard PDF",
  "map": { "id": "randwick", "linked": "2026-09-28" },  // optional: drawn from web/course-maps/<id>.json
  "holes": [
    {
      "n": 1,                        // 1..18, contiguous, no gaps
      "par": 4,
      "metres": 297,                 // mirror of tees[course.tee]
      "tees": { "white": 297, "blue": 310 },
      "si": 6,                       // stroke index 1..18, unique across the card
      "shape": {                     // drawn outline, when there's no artwork
        "bend": 0.4, "bendAt": 0.55,
        "hazards": [{ "kind": "bunker|water", "t": 0.5, "side": -1 }]
      },
      "art": {                       // uploaded hole artwork
        "asset": "<asset id>", "w": 540, "h": 900,
        "tee": [185, 830], "green": [195, 125],
        "turn": [350, 470],          // optional dogleg point
        "gr": 30                     // green radius, image px
      },
      "marks": [                     // 2.3.0: raw GPS fixes from Play mode, any player
        { "k": "tee", "lat": -33.8741, "lng": 151.1202, "acc": 4.2,
          "at": "2026-10-19T00:12:03.000Z", "by": "zein@example.com", "tee": "white" },
        { "k": "flag", "lat": -33.8766, "lng": 151.1202, "acc": 3,
          "at": "2026-10-19T00:19:40.000Z", "by": "friend@example.com" }
      ]
    }
  ]
}
```

**Invariants**

- Holes are contiguous from 1. A gap is a bug — the UI refuses to save a hole
  without a par for exactly this reason.
- `metres` always equals `tees[tee]` when both exist. Readers should prefer
  `teeMetres(hole, tee)`.
- `art` coordinates are **image pixels**, meaningless without that image.
- `marks` (2.3.0) are raw fixes, never adjusted or averaged: `k` tee or flag,
  `lat`/`lng` degrees, `acc` the phone's stated accuracy in metres (10 or
  better, or the server refuses it), `at` an ISO time, `by` the email of who
  marked it (set by the server), `tee` on a tee mark only (the round's tee,
  lower case like `ratings` keys). Offered in Play only where the map can't
  draw the hole (no map, or an estimated green). The course maps build a hole
  line from them at read time; nothing derived is stored. Missing when a hole
  has none (never an empty list).
- The server merges `marks` on every course save (`mergeCourseMarks`):
  someone else's stored marks always stay, your own stay only if your copy
  still has them (that's how one is removed), and a mark not yet stored is
  added only as yours. So an old copy on a friend's phone can neither drop a
  mark nor bring back one its owner removed. Removing a hole from the card
  removes its marks.
- Editing a course must preserve every hole field the form doesn't own
  (`art`, `shape`, `tees`), and the course's `map`. The form owns `par`,
  `metres` (for its tee) and, since 1.13.0, `si`: 1..N, each value once.
- `map` stores only which map file the course uses. The shapes live in the
  file (see *Course maps* below), never in the database.

### Course maps (`web/course-maps/<id>.json`)

Built by `scripts/course-maps.js` from OpenStreetMap data and committed; not a
database document. Metres on a local plane: x east, y north, from `origin`.

```jsonc
{
  "v": 1, "id": "randwick", "name": "Randwick Golf Club",
  "osm": { "course": "relation/5702325", "name": "Randwick Golf Course", "exported": "2026-09-27" },
  "attribution": "© OpenStreetMap contributors", "licence": "ODbL-1.0",
  "origin": [-33.97271, 151.25582],     // fixed forever: map shots are stored in this plane
  "holesFrom": "OpenStreetMap hole lines",
  "boundary": [[[x, y], …]],            // rings
  "features": [
    { "k": "green|tee|fairway|bunker|water|rough|canopy", "r": [[[x, y], …]], "h": 7, "osm": "way/…" },
    { "k": "path", "l": [[x, y], …], "h": 7, "osm": "…" },
    { "k": "crowns", "c": [[x, y, radius], …], "h": null, "osm": "…" },   // merged mapped trees
    { "k": "tree", "c": [x, y], "rad": 5.5, "h": 7, "osm": "…" },          // a lone tree
    { "k": "teept", "c": [x, y], "h": 7, "osm": "node/…" },                // a tee mapped as a point (2.2.0)
    { "k": "green", "est": true, "r": [[[x, y], …]], "h": 7, "osm": "node/…" } // estimated: a 12 m circle on the pin
  ],                                    // h: the hole it belongs to; null = none (drawn faded)
  "holes": [{ "n": 7, "line": [[x, y], …], "green": 58, "tees": [77] }]
}                                       // line: mapped tee → middle of the green; green/tees index features
                                        // tees: the hole's mapped tee boxes (on its line, or named by hand)
```

- `share` (2.30.0, optional on a hole): the number of another hole whose line
  it plays (Kogarah's OSM "1/16": hole 16 has `"share": 1`). Same `line` and
  `green`; the shapes stay `h` of the first hole in the file, and
  `HoleMap.forHole` lends them to the sharing hole, so its fairway, hazards and
  legend are its own.
- `holes` is empty on a boundary-only map (`holesFrom: "your GPS marks"`:
  Barnwell Park, Beverley Park, Lane Cove). Its file exists so the course has a
  fixed `origin` before anything is logged there.
- **Holes from marks** (2.4.0) are never in the file: `HoleMap.forHole(id, n,
  metres, {marks, tee})` builds them on every read from the course hole's
  `marks`, where the file has no line for the hole or only an estimated green.
  Line: mean of the tee marks for the tee played (else the set nearest the
  card) → mean of the flag marks; green: an estimated 12 m circle there
  (`est`, `mk`). Marks used: `acc` ≤ 10, within 30 m of the boundary, and in
  agreement (within 20 m of their set's median, a majority, else nothing is
  drawn). On an OSM line with an estimated green, flags within 40 m of the
  line's end move the green and the line's end there. A mapped green ignores
  marks. Where there is no line but the flags' mean is on a mapped green or
  within 10 m of its edge (`MARK_SNAP`, 2.31.0), the hole takes that green:
  the line runs to its middle, it is `h` = this hole in the built map, and
  `fromMarks.snapped` is true (a green lie, front and back).
- The **tee rule**: the tee a round was played from sits `teeMetres(hole, tee)`
  from the end of `line`, along it (forward of the mapped tee if the card is
  shorter, straight back behind it if longer). Worked out on every draw.
- A hole is flagged on the course page (never hidden) when the card and the mapped line
  are more than 10% apart and the tee the card puts there is more than 15 m from every
  one of the hole's `tees`.
- Sources (`course-maps/src/<id>.json`): `holes` is `"osm"` (OSM hole lines) or a
  per-hole mapping `{ tees: [osm id | {id, half: "nearest"}], green, via?, straight? }`;
  `addHoles` adds hand-mapped holes where `"osm"` has gaps; `holesFrom` is the phrase
  the course page shows; `ignore` lists features that aren't part of any hole.

---

## sessions/{id}

One collection, two shapes, discriminated by `type`. Both may carry `swings`.

### type: "round"

```jsonc
{
  "id": "r_20260914_hv", "v": 2, "type": "round",
  "date": "2026-09-14",
  "courseId": "c_huntervalley", "courseName": "Hunter Valley Golf Club",
  "tee": "white",                    // which set distances resolve through
  "detail": "score_only|shot_level",
  "format": "ambrose|bestball|team",   // 2.15.0; absent = solo stroke play. A team
                                        // round is listed and labelled, and left out of
                                        // the handicap, averages and evidence
  "notes": "…",
  "holes": [
    {
      "n": 1, "par": 4, "metres": 297,   // snapshot at logging time
      "strokes": 7,                       // derived when shots exist
      "manualStrokes": 7,                 // typed score, kept if shots are cleared
      "putts": 3,
      "chips": 1, "sand": 0,             // 2.21.0: his counts on a scores-only hole (Getting to the
                                          // green); on a traced hole they come from the shots and
                                          // are never stored
      "firstPutt": 8,                     // metres — can never be backfilled
      "firstPuttEstimated": true,         // set when derived from an approach tap on the
                                          // green; cleared when the distance is typed
      "penalties": 1,                     // unattributed
      "shots": [ /* see below */ ]
    }
  ]
}
```

**Shots** exist in one of three coordinate frames, never mixed within a hole:

```jsonc
// art frame — tapped on hole artwork, image pixels
{ "x": 313.2, "y": 455.8, "club": "5W", "lie": "rough",
  "penalty": false, "verified": false }

// map frame, moved there from the art frame (2.17.0): approx keeps it out of calibration; art keeps the pixels
{ "mx": -24.1, "my": -140.3, "club": "5W", "lie": "rough", "approx": true, "art": { "x": 313.2, "y": 455.8 } }

// outline frame — tapped on the drawn stencil
{ "t": 0.55, "u": 0.2, "club": "5W", "lie": "rough" }

// map frame — tapped on a course map, metres on the map's plane
{ "mx": -24.1, "my": -140.3, "club": "7i", "lie": "bunker" }

// map frame, marked by GPS in Play mode (2.1.0): gps is the fix's accuracy, ± metres
{ "mx": 12.4, "my": 88.0, "club": "5W", "lie": "fairway", "gps": 6 }
```

- On a map, `lie` is set from the shape under the tap, and left out where nothing
  is mapped (he picks it). A map shot on a course without its map is not measurable.
- `gps` (2.1.0) is present only on a shot marked with "Mark my ball here": the
  phone's stated accuracy when it was marked. A tapped shot, or one moved by a
  tap, has none. Nothing else about Play mode is stored: a round played live is
  an ordinary round.

- `t` runs 0 at the tee to 1 at the green; `u` is lateral, -1..1 across the rough.
- `verified: true` means a flagged long shot was confirmed real, not a mis-tap.
- `penalty: true` attaches a penalty stroke to the shot that caused it.
- **Hole score** = shots + putts + unattributed penalties + attached penalties
  (`holeStrokes`).

### type: "range"

```jsonc
{
  "id": "s_20260715", "v": 2, "type": "range",
  "date": "2026-07-15", "venue": "…", "focus": "…",
  "ballType": "range|premium|own", "source": "toptracer|inrange|trackman|manual",
  "planned": false,                  // generated from the practice list
  "excluded": false,                 // left out of club numbers by hand; its own page still shows it
  "blocks": [
    {
      "id": "b_…", "seq": 1, "club": "7i",
      "swing": "full|part|chip",
      "target": 130,
      "drill": "…", "intent": "…", "outcome": "…",
      "plan": true,                  // planned, not yet hit
      "reason": "7i strike: …",      // planned blocks: the practice item(s) behind it
      "goals": ["strike:7i"],        // 2.6.0: those items' keys, so the block stays linked to the
                                     // finding after its title's numbers change. Kept when the
                                     // block is hit (screenshots fill the planned block)
      "summary": { "n": 20, "avgCarry": 46, "avgTotal": 51,
                   "fromPinCarry": 11.5, "fromPinTotal": 9.6, "hitsC": 4 },
      "shots": [ { "carry": 147.5, "total": 178.2, "speed": 82.2,
                   "hitC": false, "hitT": true } ],
      "fromImages": {                // only when the shots were read from screenshots
        "assets": ["<asset id>"],    // the screenshots themselves, kept as evidence
        "readOn": "2026-09-26",
        "units": "m|yd|unknown",     // what the screen said
        "converted": false           // true when yards were converted to metres
      }
    }
  ]
}
```

**Invariants**

- A block has `shots`, or a `summary`, or `plan: true`. Never nothing.
- Where `shots` exist they are the truth; `summary` only carries the bay's
  own from-pin figures, which can't be derived from carry alone.
- A session with no blocks and one or more `swings` is valid — a video-only session.

### swings (either type)

```jsonc
{
  "id": "sw_…",
  "view": "dtl|face|other",          // changes how the analysis reads them
  "club": "7i", "note": "…",
  "addedOn": "2026-09-24", "duration": 6.4,
  "frames": [ { "asset": "<id>", "t": 0.05 } ],   // never t: 0 — see below; 16 since 2.18.0 (8 before), even across the trim, or packed around `impact`
  "impact": 1.02,                     // 2.26.0: where he marked the club meeting the ball, s from the clip's start; null or absent = not marked, frames even
  "video": "<asset id>|null",        // null when over the 60 MB cap (20 before 2.25.0)
  "analysis": { /* free-form; see keys below */ },
  "analysedOn": "2026-09-24",
  "analysedIn": "chat"               // on older analyses pasted back from a chat
                                     // (that route was removed in 1.3.0)
}
```

`analysis` keys: `one_thing` (the fix), and since 2.11.0 `why`, `feel`,
`check`, `drill{name, how}` and `ball_data` (`agrees` | `contradicts` |
`unclear`, which decides agreement when present); `observations[{what,
evidence, confidence}]` (at most three since 2.11.0), `matches_ball_data`,
`cannot_tell[]`; since 2.18.0, on down-the-line readings only, `wrist{top:
cupped|flat|bowed|cannot tell, lead_arm_parallel: held|opening|released|cannot
tell, frames}`. Older readings may have `positions[]`, `drill{name, why}`,
and `notes` + `parsed: false` when prose was pasted instead of JSON.

**Frame `t` is never 0.** Seeking a video to exactly zero yields an
undecoded, blank frame; extraction starts at 0.05s and drops frames that
still come back blank.

---

## settings/app

```jsonc
{
  "id": "app",
  "home": { "label": "Home", "lat": -33.89, "lng": 151.19 },
  "window": "all|365|180|90",        // recency window on range-derived numbers
  "weighting": "recent|equal",       // default recent: a shot counts half after DISTANCE_HALF_LIFE (60) days
  "balls": "all|range|better",       // which ball types count; better = premium + own. No ballType counts only under all
  "courseSort": "near|recent|az",    // Courses list order; unset = near when home and a course have coordinates, else recent
  "theme": "system|light|dark",   // 2.37.0: appearance; unset = system (the phone's setting)
  "sgLevel": "auto|0|5|10|15|20|25|30" // 2.35.0: the strokes-gained reference; unset or auto = nearest the estimated handicap
}
```

---

## Derived, never stored

Everything analytical is recomputed on read. There is no cached copy, and
nothing below should ever be written to a document:

| Derived | From |
|---|---|
| stock carry, pure carry, roll | `fullShots(club)` + `classify()` |
| strike profile (pure/runner/short/top) | carry and roll vs the club's own 90th percentile |
| round score, FIR, GIR, approach distances | `holes[].shots` + `holes[].strokes` |
| practice list ranking | shot records, swing analyses |
| calibration (course vs range) | `shotRecords()` vs `totalRef()` |
| putting stats | `putts` + `firstPutt` |

## Assets

Images live outside these documents and are referenced by id
(`/_blob/<id>`): hole artwork, swing frames, swing video, range screenshots. An export embeds
them as data URLs; an import re-uploads and rewrites every reference. A
document that references a missing asset renders as a gap, never as an error.
Any signed-in person can read any asset (course artwork is shared); only its
uploader can delete it.
