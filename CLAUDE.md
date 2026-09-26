# Carry — project context

Handoff from the Claude chat where this was built. Read `SCHEMA.md` next;
it holds every document shape and is the thing to keep current.

---

## What this is

A golf tracker for one person — Zein, a beginner about a year in, playing
public courses around Sydney. It replaces 18Birdies with something that
answers one question: *what is actually costing me strokes, and what
should I practise next?*

Three inputs feed one loop:

1. **Rounds** — logged shot by shot by tapping where the ball finished on
   a hole map, or scorecard-only.
2. **Range sessions** — blocks of one club at one target, with shot-level
   carry and total from a Toptracer-style bay.
3. **Swing videos** — a couple per session, read by Claude against the
   ball data for that club.

Output is a ranked practice list, a gapping ladder, and per-course
history. **Everything analytical is derived at read time. Nothing derived
is ever stored.**

## Current state

v1.0.0. Built as a Claude artifact, ported here without rewriting the app.

- Deployed on TrueNAS SCALE, image published to GHCR as
  `ghcr.io/zeinbenjamin/woods`, container named `carry`.
- Real data in it: 10 Sydney courses with full scorecards, ~6 rounds,
  3 range sessions (~93 tracked shots), a couple of swings.
- The artifact version still exists at
  `https://claude.ai/artifact/2GV6LXfWGTtXzPFjDs2vZM` and remains the
  source of the app code. If you change `web/index.html` here, that fork
  is real — decide deliberately which is canonical.

## Architecture, and why

The app was written against the Claude artifact runtime, which provides
capabilities via `claude.use('db' | 'assets' | 'sample' | 'downloads')`.
Rather than rewrite ~2,000 lines of app code, `web/platform.js` implements that exact
surface against this server. **The app code is unchanged from the
artifact.** Keep it that way unless there's a strong reason not to: it
means fixes port in either direction by copying one file.

```
server/index.js     routes, token auth, static hosting
server/db.js        SQLite: JSON documents + asset metadata
server/anthropic.js the Messages API call — the only place the key exists
web/index.html      the entire app, one file, ~2,250 lines (~2,030 of them JS)
web/platform.js     the shim: artifact capability surface → this API
scripts/import-export.js   loads a "carry-export" JSON, preserving asset ids
deploy/truenas-compose.yml paste-ready for the SCALE Custom App form
```

Storage is SQLite holding JSON documents. Documents are small and always
read whole, so a document store is the right shape — but it's SQLite
underneath, so when strokes gained needs real queries the data is already
relational-ready.

The browser polls `/api/stamps` every 5s and refetches only collections
whose stamp moved. Local writes notify listeners immediately, so the UI
never waits for a poll.

## Invariants worth defending

These are decisions, not accidents. Changing them is fine; doing so by
accident is not.

- **Derived data is never stored.** Stock carry, strike profile, practice
  ranking, calibration — all recomputed on read. The freshness line in
  the UI says so explicitly.
- **Advice never prefills logging.** The club armed for the next shot is
  *what he usually hits from that distance* (his own history), never what
  the app recommends. Otherwise the loop grades its own homework.
- **Video ranks below ball data.** A swing reading is interpretation; ball
  flight is measurement. Swing items only gain weight when the two agree.
  Every analysis is labelled "a reading, not a measurement".
- **Nominal vs measured stays separate.** `nominalCarry`/`nominalTotal`
  are what he believes; measured numbers are derived and never written
  back over them.
- **Unmeasurable means null, not a guess.** Mixed coordinate frames,
  missing artwork, shots that can't be placed — these return `null` and
  the UI says "not measurable". An early bug produced 2,800m shots this
  way.
- **Clubs are retired, never deleted**, so historical shots keep resolving.

## Domain definitions

- **Stock carry** — median carry of non-topped full swings. The planning
  number.
- **Pure carry** — mean carry of pure strikes only. What he hits when he
  catches it.
- **Strike classes**, relative to each club's own 90th-percentile carry:
  `top` (<20m), `runner` (roll% more than 10 points above pure-strike
  roll%), `pure` (≥90% of 90th pct), `short` (everything else).
- **Calibration** — on-course measured distance vs range total, flagged
  "suspect" above the range ceiling + 25%. He can mark a flagged shot real
  (a bladed wedge does run), which keeps it in the numbers.
- **Tee sets** — a course hole carries `tees: {white: 297, blue: 310}`;
  a round records which tee was played and distances resolve through it.

## His golf, because the analytics depend on it

Bag: D (no data yet), 5W, 5i, 7i, 9i, PW (46°), 56° Vokey SM4, 60°, putter.

Measured so far: **5W stock carry 147m** (45 shots), **7i stock carry
110m** against a 128m pure-strike carry (48 shots) — a large gap, and the
7i is ~63% low runners, which is the single clearest signal in the data.
The 5i is unmeasured and sits exactly in the 140–190m band that the
Sydney public courses keep asking for (Randwick has 13 par 3s, Northbridge
9, Bardwell Valley 10). Measuring it is the highest-value next range
session.

Swing history: lateral hip sway and early extension were early faults;
adding hip rotation gained distance but introduced an alternating
hook/shank on irons, thought to be body rotation outrunning hand and arm
timing. This is in the swing-analysis prompt as background.

## Hard-won gotchas

Each of these cost real debugging time. Don't reintroduce them.

- **Never seek a video to exactly t=0.** The seek completes before the
  decoder paints, so the frame is blank. Extraction starts at 0.05s,
  waits for `requestVideoFrameCallback`, samples pixels to detect blank
  frames, and retries. Every stored frame has `t >= 0.05`.
- **One download prompt, not many.** The platform rate-limits repeated
  save prompts — eight frames meant five prompts then silent failure.
  Frames now go out as a single zip (hand-rolled writer, no library).
- **`window.confirm` is blocked** in the artifact sandbox and returns
  false, silently no-oping every destructive action. There's an in-page
  `confirmAsk()` instead. Don't reach for `confirm`.
- **Editing a course must preserve hole fields the form doesn't own** —
  artwork, outline shape, stroke index, tee sets. A previous version
  dropped artwork on any course edit.
- **Contact sheets above ~1400px or in portrait have caused rendering
  failures.** Individual frames at 800–900px are reliable.
- **TrueNAS runs containers as 568:568.** The dataset must be owned by it
  or SQLite can't create `carry.db-wal` — which fails on first *write*,
  not at startup, so it looks like it's working.
- **The SCALE Custom App form cannot build images and has no `.env`.** It
  pulls only, and `${VARIABLES}` silently resolve to empty — including
  `API_TOKEN`, which disables auth rather than erroring. Use
  `deploy/truenas-compose.yml`, which is literal throughout.
- **Express matches routes in registration order.** `DELETE
  /api/:collection/:id` once sat above `DELETE /api/assets/:id` and
  swallowed it with a 404, and the app ignores asset-delete errors, so in
  the whole of v1.0.0 every removed frame, swing video and hole image
  stayed on disk.
  Asset routes now come first; `api.test.js` checks the file is gone.
- **App listens on 1818** (8080 was taken on his box). It's `PORT`-driven
  everywhere including the healthcheck.

## Testing

`npm test` — 87 tests, about 10s (20s on one core). Needs `python3` on the
path: the zip test opens the app's zip output with Python's `zipfile`.

- `api.test.js` (10) — the server alone: auth, documents, assets, import.
- `web.test.js` (6) — the real `web/index.html` in jsdom against a live
  server: writes land in SQLite, uploads become blobs, polling works.
- `ui-*.test.js` (71) — the app's own UI suites, rebuilt here. The
  originals from the artifact sandbox were never recovered, so these are
  new tests covering the same ground, driven through the real forms and
  real taps on the hole map:
  `ui-crud` (clubs, courses, range blocks, rounds), `ui-analytics`
  (strike classes, derived-never-stored, nominal vs measured, recency
  window, calibration, unmeasurable → null), `ui-tees-migrations`,
  `ui-swing` (frame extraction, zip, one download, chat paste, analysis),
  `ui-logging` (armed club, putts, penalties, quick score, first putt).

`test/harness.js` boots a real server on a free port with seeded
documents, loads the app into jsdom, and stubs only what jsdom lacks
(`<dialog>`, SVG CTM as identity so taps land at exact coordinates,
object URLs, `TextEncoder`, `Blob.arrayBuffer`). The swing suite adds a
fake decoder that reproduces the real one's timing: `seeked` fires before
the frame is painted.

Every gotcha above has a test, and each was checked by reintroducing the
bug and watching the test fail (22 mutations, all caught).

Two tests are marked `todo`: known app bugs, recorded rather than fixed
because the fix is in `web/index.html` (see "Current state"). They report
but don't fail the run. Remove the flag when fixing one.

- New round: picking a different course redraws the scorecard but not the
  tee control, so the round saves the first course's tee.
- Re-analysing a swing in the app after a pasted chat reply keeps
  `analysedIn: 'chat'`, so the card credits the new reading to a chat.

Convention used throughout: **verify rather than assert**. Scorecards
were checked against published totals before being stored; the zip writer
was proven by opening its output with a real zip reader; the 568 uid was
tested by actually running as 568 against a 568-owned dataset.

## Roadmap

In rough order of value:

1. **Strokes gained.** First-putt distances are now being captured, which
   was the missing input. Needs a baseline table next. This is the single
   biggest analytical upgrade available.
2. **Pose estimation on swing frames**, server-side. Turns swing analysis
   from a reading into measured angles tracked over time — impossible in
   the artifact, straightforward here. This is the real payoff of the port.
3. **Recency weighting** beyond the current all/365/180/90 window
   selector. Old data actively misleads after a swing change.
4. **Course data from OpenStreetMap.** `golf=hole` ways carry par, length
   and stroke index; the polygons would give true hole shapes instead of
   drawn outlines or hand-placed artwork. Licence is ODbL — attribution
   required, fine for personal use.
5. Session filtering, artwork for the remaining courses, penalty
   attribution reporting.

Deliberately out of scope: multi-user, booking integration, anything that
sends his data anywhere.

## Working agreements from the chat

- Build it and test it, then report — not "here's what you could do".
- Flag uncertainty explicitly rather than smoothing over it (e.g. the
  Bardwell Valley card's units are labelled yards by the source but read
  as metres; that's noted in the course record rather than silently
  resolved).
- Don't invent numbers. Every distance in the database traces to a club
  scorecard, a course GPS app screenshot, or his own logged shots.
- Prefer honest limits over a plausible guess: "not measurable" beats a
  number that looks fine and isn't.
