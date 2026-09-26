# Carry — data schema

Version **2**. Every stored document carries `v`; the page migrates on load
and writes the upgraded shape back (`migrateCourse`, `migrateSession`).
Migrations must be idempotent — they run against documents that are already
current.

Four collections: `clubs`, `courses`, `sessions`, `settings`.
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
  "feeWeekday": 45, "feeWeekend": 55,
  "tee": "white",                    // primary tee: which set `metres` mirrors
  "notes": "…", "source": "club scorecard PDF",
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
      }
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
- Editing a course must preserve every hole field the form doesn't own
  (`art`, `shape`, `si`, `tees`).

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
  "notes": "…",
  "holes": [
    {
      "n": 1, "par": 4, "metres": 297,   // snapshot at logging time
      "strokes": 7,                       // derived when shots exist
      "manualStrokes": 7,                 // typed score, kept if shots are cleared
      "putts": 3,
      "firstPutt": 8,                     // metres — can never be backfilled
      "firstPuttEstimated": true,         // set when derived from an approach tap on the
                                          // green; cleared when the distance is typed
      "penalties": 1,                     // unattributed
      "shots": [ /* see below */ ]
    }
  ]
}
```

**Shots** exist in one of two coordinate frames, never mixed within a hole:

```jsonc
// art frame — tapped on hole artwork, image pixels
{ "x": 313.2, "y": 455.8, "club": "5W", "lie": "rough",
  "penalty": false, "verified": false }

// outline frame — tapped on the drawn stencil
{ "t": 0.55, "u": 0.2, "club": "5W", "lie": "rough" }
```

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
  "blocks": [
    {
      "id": "b_…", "seq": 1, "club": "7i",
      "swing": "full|part|chip",
      "target": 130,
      "drill": "…", "intent": "…", "outcome": "…",
      "plan": true,                  // planned, not yet hit
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
  "frames": [ { "asset": "<id>", "t": 0.05 } ],   // never t: 0 — see below
  "video": "<asset id>|null",        // null when over the 20 MB asset cap
  "analysis": { /* free-form; see keys below */ },
  "analysedOn": "2026-09-24",
  "analysedIn": "chat"               // set when pasted back from a chat
}
```

`analysis` keys: `positions[]`, `observations[{what, evidence, confidence}]`,
`matches_ball_data`, `cannot_tell[]`, `drill{name, why}`, `one_thing`, and
`notes` + `parsed: false` when prose was pasted instead of JSON.

**Frame `t` is never 0.** Seeking a video to exactly zero yields an
undecoded, blank frame; extraction starts at 0.05s and drops frames that
still come back blank.

---

## settings/app

```jsonc
{
  "id": "app",
  "home": { "label": "Home", "lat": -33.89, "lng": 151.19 },
  "window": "all|365|180|90"         // recency window on range-derived numbers
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
