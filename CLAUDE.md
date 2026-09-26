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

The running version is in `package.json` and `CHANGELOG.md`; the app
shows it next to the title (see Releases). Built as a Claude artifact, ported here without
rewriting the app.

- Deployed on TrueNAS SCALE, image published to GHCR as
  `ghcr.io/zeinbenjamin/woods`, container named `carry`.
- Real data in it: 10 Sydney courses with full scorecards, ~6 rounds,
  3 range sessions (~93 tracked shots), a couple of swings.
- **This repo is the source of truth for all app code.** Merges to
  `main` publish the image; the NAS redeploys from it. The original
  artifact (`https://claude.ai/artifact/2GV6LXfWGTtXzPFjDs2vZM`) is a
  frozen historical copy: changes are not ported back to it, and data
  entered there does not reach the NAS.

## Releases

Carry follows the versioning kit from Bourdain, so both apps release the
same way.

Every change that ships to the app gets a new version. Docs-only changes don't.

1. Bump the version with `npm version <x.y.z> --no-git-tag-version`. This
   updates `package.json` and `package-lock.json` together (the image
   builds with `npm ci`, so never bump by hand).
   - **Patch** (1.3.0 → 1.3.1): fixes, no new behaviour.
   - **Minor** (1.3.0 → 1.4.0): new features or changed behaviour.
   - **Major** (1.x → 2.0.0): a change to stored data that old data doesn't
     fit, so it needs a migration (in Carry: a `SCHEMA_VERSION` bump with a
     `migrate*` step). Size doesn't make a major; data does.
2. Add an entry at the top of `CHANGELOG.md`: `## x.y.z — YYYY-MM-DD` followed by
   `- ` bullets. The server parses exactly that format for the in-app history.
   Write the bullets for the user, not for a developer: what's different when
   using the app.
3. There's no service worker, so there's no cache name to bump.

How the version reaches the device: the server reads the version from
`package.json`, the commit from `APP_COMMIT` (set by the Actions build;
`dev` locally), and stamps both into the `app-version` / `app-commit` meta
tags as it serves `index.html`. The app compares its own tags with
`/api/version`. On startup (and on returning to the foreground, at most
every 10 minutes) it toasts when the server has a newer build, and tapping
the title shows the same plus the whole history. Serve `index.html` only
through `sendIndex`, never as a plain static file, or the placeholders
reach the device unfilled. `index.html`, `platform.js` and the manifest
must stay `Cache-Control: no-cache`.

Where Carry differs from the kit, deliberately:
- `/api/version` is registered **before** the token check (the rest of
  `/api` needs the token); it says nothing about the data.
- `platform.js` is revalidated like the page: it's a separate file the
  page depends on, and must never lag it.
- No SPA fallback: Carry has no URL routes, so unknown paths stay 404.
- The update check also runs when the app comes back to the foreground,
  because a home-screen app can stay open for days without "starting up".
- Changelog headings must be a real `x.y.z` version (the kit accepts any
  word); a heading the app can't parse fails CI.

Automation on top of the kit:
- **Publishing runs the tests first**, so a merge that broke them never
  produces an image or a tag. (Requiring the test check before merging is
  a GitHub branch-protection setting on `main`, outside this repo.)
- **CI gate** (`scripts/check-version.js`): a PR that changes anything in
  the image (`web/`, `server/`, `scripts/`, `Dockerfile`) fails unless the
  version went up and `CHANGELOG.md` opens with that version's entry.
- **On merge to main** the publish workflow pushes `:latest` and
  `:sha-<short>`, and for a new version also `:<version>`, the git tag
  `v<version>`, and a GitHub release whose notes are that entry's bullets.
  Version tags are written once, never moved. (v1.1.0 was released this
  way; there is no v1.0.0 tag.)
- **Checking a deploy without the app:** `sudo docker inspect carry
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.
- **`pull_policy: always`** is set in `deploy/truenas-compose.yml`; without
  it a redeploy silently restarts the old image.

## Architecture, and why

The app was written against the Claude artifact runtime, which provides
capabilities via `claude.use('db' | 'assets' | 'sample' | 'downloads')`.
Rather than rewrite ~2,000 lines of app code, `web/platform.js` implements that exact
surface against this server. The app code started as an exact copy of
the artifact; it now evolves here. The shim still makes the capability
surface the seam between app and server — keep new server features
behind it (or behind plain `fetch` to `/api`) rather than scattering
server knowledge through the app.

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
  A reading about a club that already has a ball-data item joins that item
  as support rather than being listed on its own. Every analysis is
  labelled "a reading, not a measurement".
- **Old evidence fades; absence has to be earned.** The practice list is
  weighted toward recent evidence, and an item only goes quiet after
  enough clean chances that, at its old rate, it would probably have shown
  up. Not playing a club is not evidence it's fixed.
- **Nominal vs measured stays separate.** `nominalCarry`/`nominalTotal`
  are what he believes; measured numbers are derived and never written
  back over them.
- **Unmeasurable means null, not a guess.** Mixed coordinate frames,
  missing artwork, shots that can't be placed — these return `null` and
  the UI says "not measurable". An early bug produced 2,800m shots this
  way.
- **Clubs are retired, never deleted**, so historical shots keep resolving.

## Domain definitions

- **Stock carry** — median carry of non-topped full swings, weighted by
  recency (see below). The planning number.
- **Pure carry** — mean carry of pure strikes only, same weighting. What he
  hits when he catches it.
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
- **Days are local, never UTC.** `today()` builds the date from local
  fields; `toISOString().slice(0, 10)` dated everything before 10am
  Sydney as the day before. Use `localDay()` for any calendar date.
- **Writes to one round go one at a time.** `updateHole` queues per round
  and applies each change to the latest copy; two quick taps used to start
  from the same stale round and the second save dropped the first shot.
- **Derived numbers are memoised per data state** (`memoised()`, keyed on
  the identity of `S.sessions`, `S.clubs`, `S.courses`, `S.settings`). A
  season of data used to cost 2.3s a render (8,600 club-stat recomputes).
  So those arrays must always be *replaced*, never mutated in place, or
  the cache goes stale.
- **Stored files stream with byte ranges** (`res.sendFile`), which a
  phone's video player needs, and only photo/video types are served
  inline; anything else is an attachment, all with `nosniff` and a
  sandboxing CSP. An uploaded SVG used to be served as a live page on the
  app's own origin, where the token lives.
- **Panels keep their state across redraws** by `id` (`render()` reopens
  them), and the shim doesn't redraw when a poll only brings back our own
  write. Give any new `<details>` an `id`.
- **A wrong or missing token asks for it.** A 401 from the API or the poll
  opens a token sheet (`askToken`) instead of the old dead-end "Storage
  error: unauthorised"; the token is stored in `localStorage`.
- **The server logs writes and errors**, never GETs that succeed, and never
  the query string (the token can be in it).
- **The container stops cleanly**: SIGTERM closes the HTTP server and
  SQLite and exits 0, and both compose files set `init: true` so the
  signal reaches node. Before this, a redeploy waited out Docker's 10s
  timeout and killed it.
- **App listens on 1818** (8080 was taken on his box). It's `PORT`-driven
  everywhere including the healthcheck.

## The Overview

The home screen (`vOverview`), in the order he asked for: Current form →
What to work on → Gapping (with gap health, strike profile folded) →
Scoring trend → Where your game is being tested → Approach distances →
Putting → Evidence → Recent. Each section is built from the existing
derived numbers (`roundStats`, `rankedPractice`, `clubStats`,
`shotRecords`, `courseDemand`, `puttingStats`, `confidence`) and only
appears when there's data for it. Rules that keep it honest:

- Averages across rounds are **per hole** (with a labelled per-18
  figure): 9- and 18-hole rounds can't be averaged as rounds.
- Penalties, fairways and greens show only when the rounds recorded them;
  a scorecard-only round shows score and to par, nothing invented.
- Gap flags compare with his **own** median gap (under a third, or over
  twice) plus any club carrying no further than the next one down.
  Descriptive, never "change clubs".
- "Where your game is being tested" is counts of missed targets, labelled
  as not strokes gained.

## What to practise: weighting and freshness

`practiceItems()` builds the candidates; each carries dated evidence
(`ev: {date, cost}`) and, where they can be counted, every chance it had
to happen (`chances: {date, hit}`). `assessPractice()` and
`rankedPractice()` turn that into the list, on every draw; nothing is
stored.

- **Weight** = sum of evidence cost, halved every `PRACTICE_HALF_LIFE`
  (60) days. The costs per kind (tree 0.8, water 1, three-putt 1, …) and
  the half-life are judgements, not measurements; tune them deliberately.
- **Quiet** when the clean chances since it was last seen reach
  `ceil(ln 0.2 / ln(1 − rate))` (at least 3) — the point where, at its
  old rate, it would have shown up 80% of the time — or when it was last
  seen over `STALE_AFTER` (180) days ago. Quiet items are listed apart,
  with the reason, and never planned.
- **Practised** when a range block for its club and swing was hit on or
  after the day it was last seen. It stays, at half weight, until the
  course confirms it.
- **Strike** items come from range data: a club with at least 35%
  (`STRIKE_FLAG`) low runners or tops over 10+ full swings. Status
  compares the latest session with the ones before; it goes quiet as
  "improving" when the latest is under the flag and at most 60% of the
  earlier rate.
- **Swing readings:** only the latest per club and camera angle counts.
- **Unmeasured clubs** in the bag are always listed to measure (fixed
  weight 0.3).
- **The plan** (`planBlocks`) takes current items in ranked order: up to
  five blocks, one per club and swing, merged reasons, each block
  carrying `reason`. It replaces an unhit planned session (after asking)
  rather than adding another; off-range practice (putting) goes in the
  session notes.

The chat route for swing analysis (save frames as a zip, copy a prompt,
paste the reply back) was removed in 1.3.0; analyses already saved with
`analysedIn: 'chat'` still show with that label.

## How club distances are counted

Every range-derived number (`clubStats`, `carryRef`, `totalRef`, the
gapping ladder, calibration ceilings) goes through the same gate:
`countsForNumbers(s)` — a range session counts unless it's `excluded` by
hand, outside the date `window`, or its `ballType` doesn't match the
`balls` filter (a session with no ball type counts only under "all"). A
left-out session's own page still shows its shots (`shotsWithSession`).

Within that, `weighting: 'recent'` (the default) gives each shot weight
`0.5^(age / DISTANCE_HALF_LIFE)` (60 days) and takes a weighted median /
mean; `'equal'` is the plain median. `clubStats` also returns `nEff`
= (Σw)²/Σw², so the Overview can say "5 shots · counts like 4 recent".
The strike profile stays a plain count, because it describes what
happened, not what to plan on. `weightedMean` scales weights against the
largest one so equal weights give exactly the plain mean — without that,
same-day shots came out as 125.25000000000001.

The filters live in the "Range numbers" panel at the top of the Overview.

## Penalty report

Rounds → *Penalty report* (`penaltyReport()` / `vPenalties()`): penalty
strokes on traced holes, split into those tied to a shot (the shot's
"cost a penalty" tick) and those added with the hole's counter, whose
cause isn't known and is said so. Broken down by club (with how often the
club was used on traced holes, so a count reads as a rate), by kind of
shot and by where the ball went; holes ranked, and one is "a repeat" only
when penalties came in more than one round. Scorecard-only rounds are left
out and counted, never treated as clean.

## Range data from screenshots

Range shots come from screenshots of the bay's shot list, not typing:
Range → a session → *From screenshots*. Claude reads them into blocks
(prompt: `shotImagePrompt`), `normaliseShotRead` cleans the reading, and a
review sheet shows every number beside the images. Nothing is stored
until he saves; then the screenshots are kept with the blocks as
`fromImages`, so each number traces back to what the bay showed. Rules
the reader follows, each pinned by a test: yards are converted only when
the screen says yards; unclear readings, implausible shots, missing
totals and total < carry become warnings, never silent fixes; a club that
isn't clearly one of his is left for him to pick.

**Not yet verified against real screenshots.** The tests stub Claude's
reply. The prompt has not been run against actual Toptracer / Inrange
screens; the first real session is the test, and a screenshot kept as a
fixture would let the reading be pinned.

## Testing

`npm test` — 177 tests, about 18s (50s on one core).

- `api.test.js` (16) — the server alone: auth, documents, assets (byte
  ranges, safe serving), import, `/api/version`, the stamped and
  revalidated page, the empty-token warning, and `/api/analyse`
  against a fake Anthropic API (`ANTHROPIC_BASE_URL`).
- `versioning.test.js` (7) — the changelog format and its agreement with
  `package.json` and the lockfile, the PR gate, the release notes, and
  that publishing runs the tests first.
- `regressions.test.js` (7) — the 1.3.1 review fixes, each reproduced
  before it was fixed: local dates, quick taps, render cost with a season
  of data, panels staying open, the token leaving the URL, escaping.
- `web.test.js` (6) — the real `web/index.html` in jsdom against a live
  server: writes land in SQLite, uploads become blobs, polling works.
- `ui-*.test.js` (~100) — the app's own UI suites, rebuilt here. The
  originals from the artifact sandbox were never recovered, so these are
  new tests covering the same ground, driven through the real forms and
  real taps on the hole map:
  `ui-crud` (clubs, courses, range blocks, rounds), `ui-analytics`
  (strike classes, derived-never-stored, nominal vs measured, recency
  window, calibration, unmeasurable → null), `ui-tees-migrations`,
  `ui-swing` (frame extraction, analysis, video below ball data),
  `ui-practice` (recency weighting, freshness, quiet items, the planner),
  `ui-logging` (armed club, putts, penalties, quick score, first putt),
  `ui-overview` (section order and every number against a hand-worked
  scenario, nothing shown without data),
  `ui-range-images` (screenshots → review → blocks, units, warnings,
  export/import/delete of the screenshots), `ui-version` (the stamped
  label, the version sheet, behind-the-server detection),
  `ui-distances` (recency weighting, nEff, ball filter, left-out
  sessions), `ui-penalties` (the penalty report).
- `housekeeping.test.js` (4) — the token prompt, request logging without
  the query string, a clean SIGTERM exit, the YAML's replace markers.

`test/harness.js` boots a real server on a free port with seeded
documents, loads the page as the server serves it into jsdom, and stubs only what jsdom lacks
(`<dialog>`, SVG CTM as identity so taps land at exact coordinates,
object URLs, `TextEncoder`, `Blob.arrayBuffer`). The swing suite adds a
fake decoder that reproduces the real one's timing: `seeked` fires before
the frame is painted.

Every gotcha above has a test, and each was checked by reintroducing the
bug and watching the test fail (22 mutations for the original suites,
18 for versioning and screenshots, 8 for the practice list, 14 for
1.5.0's distances, penalties and housekeeping; all caught.
The two zip/download ones retired with the chat route in 1.3.0).

Two bugs found while rebuilding the suites are fixed and pinned by
regression tests: the New round tee control not following a course
change, and in-app re-analysis keeping a stale `analysedIn: 'chat'`.

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
3. **Course data from OpenStreetMap.** `golf=hole` ways carry par, length
   and stroke index; the polygons would give true hole shapes instead of
   drawn outlines or hand-placed artwork. Licence is ODbL — attribution
   required, fine for personal use.
4. Artwork for the remaining courses.

Done in 1.5.0: recency weighting of club distances, session filtering
(leave out, ball type), the penalty report.

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
