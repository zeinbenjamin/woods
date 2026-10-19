# Carry — project context

Handoff from the Claude chat where this was built. Read `SCHEMA.md` next;
it holds every document shape and is the thing to keep current.

---

## What this is

A golf tracker built for Zein, a beginner about a year in, playing
public courses around Sydney (since 2.0.0 his friends can sign in too, each
with their own data and the courses shared; see *Sign-in and whose data*). It replaces 18Birdies with something that
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
- `/api/version` is registered **before** the sign-in check (the rest of
  `/api` needs it); it says nothing about the data.
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
server/index.js     routes, static hosting
server/auth.js      Cloudflare Access sign-in: the JWT check, req.user
server/db.js        SQLite: JSON documents + asset metadata
server/anthropic.js the Messages API call — the only place the key exists
web/index.html      the app, one file, ~3,200 lines
web/platform.js     the shim: artifact capability surface → this API
web/holemap.js      course maps: loading, tee rule, lies, the yardage-book drawing
web/course-maps/    built map files, one per course, + index.json (committed)
course-maps/        map sources: src/<id>.json (card, mapping, origin), osm/<id>.geojson
scripts/import-export.js   loads a "carry-export" JSON, preserving asset ids
scripts/course-maps.js     extract a course from an OSM export; build its map file
deploy/truenas-compose.yml paste-ready for the SCALE Custom App form
```

`holemap.js` is a separate file on purpose: two chats work on this repo at
once, and keeping the map code out of `index.html` keeps their changes
apart. `index.html` only calls it at the few places a hole is drawn or
tapped. The build script and the tests load the same file in a `vm`
sandbox, so the tee rule and the lie rules can't drift between the build
report and the app. It's served `no-cache` like the page, and so are the
map files (`.json` under `web/`).

Storage is SQLite holding JSON documents. Documents are small and always
read whole, so a document store is the right shape — but it's SQLite
underneath, so when strokes gained needs real queries the data is already
relational-ready.

The browser polls `/api/stamps` every 5s and refetches only collections
whose stamp moved. Local writes notify listeners immediately, so the UI
never waits for a poll.

## Who works on what

Two Claude chats work on this repo at once, each on its own branch, each
merging to `main` through its own PRs. Ownership is by file, so their
changes don't collide and each knows what it may change.

| | **Hole-maps chat** (`claude/relaxed-einstein-tj8m13`) | **Carry chat** (`claude/gifted-carson-g3y6hd`) |
|---|---|---|
| **Owns** | `web/holemap.js`, `web/course-maps/`, `course-maps/`, `scripts/course-maps.js`, `test/course-maps.test.js`, `test/ui-holemap.test.js`, and the *Course maps* section below | Everything else: the app (`web/index.html`, `web/platform.js`), the server, `imports/` and every course record (pars, lengths, stroke index, tee sets, primary tee, ratings), the course form, handicap, releases tooling, all other tests and docs |
| **Reads, doesn't change** | The course records: the card is what a map is checked against | The map files |

- **Course data belongs to the Carry chat.** When the hole-maps chat finds
  a scorecard problem while checking a map (Bondi's lengths in yards, a
  missing tee set, conflicting stroke indexes), it doesn't edit `imports/`:
  it writes a short note for Zein to paste into the Carry chat, with the
  correct values and where they came from. (Before this split it did fix
  both imports itself: Bondi to metres, Massey Park's red tees.)
- **`web/index.html` belongs to the Carry chat.** The map reaches it at a
  few places: `hmFor`/`withHm`/`usesMap` and the map frame in `holesOf`,
  `toGreen` and `spot`; the tile, logger and hole page drawing; the tap
  handler; `courseMapSection`/`holeCheck` and the link/unlink actions. The
  hole-maps chat changes those only, and asks Zein first for anything new
  in `index.html`.
- **A new course**, in order: (1) the Carry chat adds the course and its
  import, and Zein imports it on the NAS; (2) Zein sends the hole
  screenshots to the hole-maps chat, which builds and checks the map and
  passes any card corrections to the Carry chat as a note; (3) Zein links
  the map in the app.
- **Shared files** (`CHANGELOG.md`, `package.json`, this file): each chat
  edits only its own entry and section. Whichever PR merges second takes
  the next version number; the CI gate enforces it. Before opening a PR,
  merge the latest `main`.

## Sign-in and whose data (2.0.0)

Asked for 2026-10-19: drop `API_TOKEN`, sign in with Cloudflare Access, and
tag data by email so friends can use it ("Friends, shared courses"; the home
address closed: "Cloudflare only").

- **Who:** `server/auth.js` verifies the `Cf-Access-Jwt-Assertion` header
  (or `CF_Authorization` cookie): RS256 against
  `https://<CF_ACCESS_TEAM>/cdn-cgi/access/certs` (cached an hour, refetched
  for an unknown key id at most every 30s), `aud` contains
  `CF_ACCESS_AUD`, `iss` is the team, `exp`/`nbf` with 60s skew, an email.
  `req.user` is that email, lower-cased. The `Cf-Access-Authenticated-User-
  Email` header is never trusted: anyone on the LAN can send it. Keys
  unreachable → 503, never a yes. `DEV_USER` is local development only.
- **Whose:** docs are keyed `(collection, owner, id)`. `courses` are shared
  (owner `''`, `SHARED` in `db.js`) with `updated_by`; clubs, sessions,
  settings are per person, so two people can both have a `7i` and an
  `app` settings doc. Stamps are per person (own + shared). The app is
  unchanged: it still sees "its" four collections.
- **Files:** readable by anyone signed in (course art is shared, ids are
  128-bit), deletable only by the uploader (403 otherwise).
- **Guard:** deleting a course someone else has rounds on is 409 `in_use`;
  the app toasts the server's reason. Rounds keep their own card copy, but
  their course page would vanish.
- **Migration from 1.x** (`migrateTo2`, at startup, once): needs
  `OWNER_EMAIL` if there's any personal data or file, else refuses to start
  having changed nothing; `VACUUM INTO carry-before-2.0.0.db` first; then
  courses → shared, everything else → the owner. That's the major version:
  stored data old code can't read.
- **Known costs:** a friend's swing analysis uses his Anthropic key; an
  import of an old export (`--owner` required) overwrites shared courses
  with its copies.

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
  artwork, outline shape, tee sets. A previous version dropped artwork on
  any course edit. Stroke index is now the form's (1.13.0: the scorecard's
  fourth column, 1..N, each once; a cleared box removes it), because there
  was no other way to add one and Randwick came over without it.
- **Contact sheets above ~1400px or in portrait have caused rendering
  failures.** Individual frames at 800–900px are reliable.
- **TrueNAS runs containers as 568:568.** The dataset must be owned by it
  or SQLite can't create `carry.db-wal` — which fails on first *write*,
  not at startup, so it looks like it's working.
- **The SCALE Custom App form cannot build images and has no `.env`.** It
  pulls only, and `${VARIABLES}` silently resolve to empty (in 1.x that
  silently disabled `API_TOKEN`'s auth). Use `deploy/truenas-compose.yml`,
  which is literal throughout. Its `REPLACE` placeholders count as unset:
  pasted as-is, sign-in is "not configured" and every data request is 503,
  and a placeholder `OWNER_EMAIL` never becomes anyone's data.
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
  app's own origin. Files are `Cache-Control: private` (they're behind
  sign-in).
- **Panels keep their state across redraws** by `id` (`render()` reopens
  them), and the shim doesn't redraw when a poll only brings back our own
  write. Give any new `<details>` an `id`.
- **Being refused says how to sign in** (`askSignIn`, once per page load),
  never the old dead-end "Storage error: unauthorised". The shim fetches
  with `redirect: 'manual'`: an expired Access session comes back as a
  redirect (or a 401 that isn't Carry's JSON) → `signed_out`, "Sign in
  again"; Carry's own 401 → `unauthorised`, "open it through Cloudflare".
  1.x's `?token=` and stored token are dropped, never kept.
- **The server logs writes and errors**, never GETs that succeed, and never
  the query string.
- **The container stops cleanly**: SIGTERM closes the HTTP server and
  SQLite and exits 0, and both compose files set `init: true` so the
  signal reaches node. Before this, a redeploy waited out Docker's 10s
  timeout and killed it.
- **An unscored hole's square is `.sq.unscored`, never `.empty`.** `.empty`
  is the empty-state box (22px padding); a round cut short on 14 holes gave
  its four unscored squares that padding, and the 9-column `1fr` strip ran
  415px past a phone, zooming the page out (1.13.1). The strips also use
  `minmax(0, 1fr)` so a cell can't widen a column.
- **The bottom of the page clears the tab bar by `--safe-b`.** The bar is
  `--nav-h` plus the home-indicator strip (`env(safe-area-inset-bottom)`,
  ~34px on an iPhone); `main` reserved only `--nav-h + 24px`, so the last
  11px of every page sat under the bar ("End round here" cut off, 2.1.1).
  Both now use `--safe-b`, and `regressions.test.js` checks it. The
  `:root` padding doesn't help: `html` is `height: 100%`, so content
  overflows past it.
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
`0.5^(age / DISTANCE_HALF_LIFE)` (60 days), age in **whole local days**
(`daysAgo`), and takes a weighted median / mean. Age to the millisecond made
same-day weights differ in the tenth decimal (a 1.6.1 publish failed on
125.25000000025072); the test runs the calculation with a clock that moves on
every read; `'equal'` is the plain median. `clubStats` also returns `nEff`
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

## Courses list order

`courseSort()` / `sortedCourses()`: Closest (straight-line km from `home`),
Recently added, A–Z; the choice is `settings.courseSort`. Default is Closest
when his location is set and a course has coordinates, else Recently added.
"When added" (`addedAt`) is `course.created`, stamped on new courses, or the
time `uid()` put in an app-made id — only if the id also contains a digit,
because a 12-letter hand-made id like `c_lanecovegcsy` decodes to a
plausible 2022 date otherwise. The cost: about 1 in 50 app-made ids has no
digit and reads as undated (listed last), never misdated. The test checks ids
built from a known time; an assertion on a random `uid()` failed the 1.7.0
publish exactly that 1 time in 50. Unknowns (no coordinates / no date) go last,
A–Z, and the list says so.

## Estimated handicap

`handicap()` (memoised, never stored) replays every round in date order under
the World Handicap System, as Golf Australia applies it, and `overviewHandicap()`
shows it under Current form with the scores behind it.

- **Score differential** = 113 / slope × (adjusted gross − course rating), to a
  tenth. Ratings come from `course.ratings[tee]` (keys lower case), typed from the
  scorecard on the course form (`ratingFields` / `readRatings`, range-checked).
  The form has a row per tee in `ratingTees(c)`: the card's tees, tees already
  rated, and **tees his rounds there were played off** — the round form's tee is
  free text when the card has one tee set, so rounds can name tees the card
  doesn't (1.6.0 offered only card tees, so those could never be rated) — plus
  an "Another tee" row. No rating: the
  round is listed as not counting, and the Overview links the course to fix.
- **Adjusted gross**: net double bogey per hole (par + 2 + strokes received,
  allocated by stroke index), or par + 5 before there is an index. Each round is
  capped with the index he had *before* it, which is why it replays history.
  Without a stroke index a round still counts if no hole's cap depends on one.
  A hole with no score counts as net par — before there is an index, net par
  for the maximum index, 54.0 (it used to reject the round, which left him
  with no index at all).
- **Which rounds**: 14+ holes of 18 is an 18-hole score; 7+ holes of a 9-hole
  card, or 7–13 of 18 with 7 in one nine, is a 9-hole score (the nine with more
  holes played). A card missing a par can't be scored and says so.
- **Why a round doesn't count is always shown** (`#hcpLeft`), with or without
  an index; ratings are matched to the round's tee ignoring case.
- **9-hole scores are paired** in date order into one 18-hole score (ratings
  summed, slopes averaged). That is the WHS method before 2024; the 2024 rules
  use an "expected score" for the other nine instead, whose formula isn't
  public enough to reproduce faithfully. A nine on an 18-hole card uses half the
  18-hole rating, flagged "est. rating", because only 18-hole ratings are typed.
- **Index** = mean of the lowest of the latest 20 (`HCP_TABLE`, with −2/−1/−1
  at 3/4/6 scores), max 54.0. Exceptional score (7+ below the index he had)
  takes 1 (10+: 2) off the latest 20 differentials. With 20+ scores, the soft
  cap halves any rise more than 3 over the lowest index of the prior 365 days,
  and the hard cap stops it at 5 over.
- **Not modelled**: the playing conditions calculation (PCC is 0; it needs
  everyone's scores that day), and the daily review GA runs. It's labelled an
  estimate, not an official GA handicap.

## Course maps

Holes can be drawn from OpenStreetMap instead of the outline or artwork
(1.8.0). The decision behind it: **AI decides nothing about where things
are.** Image generation moved hazards, and pixel colour was deciding lies,
so an illustration drifting would have corrupted distances and lies. Now
shapes come from OSM, the look is a fixed style drawn by code, and the
scorecard sets every length.

- **What's stored:** a course carries only `map: {id, linked}`. The shapes
  are in `web/course-maps/<id>.json`, built by `scripts/course-maps.js` from
  `course-maps/src/<id>.json` + `course-maps/osm/<id>.geojson` and committed.
  A test rebuilds them and fails if the committed files differ.
- **The tee rule:** the tee played sits the card distance
  (`teeMetres(hole, round.tee)`) from the middle of the green along the hole
  line; forward along it if the card is shorter than the line, straight
  back behind the mapped tee if longer. Distances are real metres.
- **The card check** (`mismatch`): a hole is flagged, on the course page and
  the hole's page and never hidden, when the card and the line are over 10%
  apart **and** the tee the card puts there isn't within 15 m (`TEE_NEAR`)
  of one of the hole's mapped tee boxes. OSM lines usually start at the back
  tee: The Coast's run up to 73 m past the yellow card, and the yellow tee
  still lands on a mapped box, so a flag on length alone was noise (1.8.0
  flagged 9 of its 18). A hole's tee boxes (`hole.tees`) are its own mapped
  tees within 20 m of its line in the tee 60% of it, a box the line runs over
  (≤ 3 m, for one box shared by two holes), and any tee a hand mapping names.
  Flagged now: Bardwell 11 (28 m from any box), The Coast 18 (17 m). Randwick
  3 and 5 aren't: the red tee is on the box (3's is 45 m long).
- **Lies** come from the shape under the tap: water, bunker, green, tee or
  fairway (→ fairway), trees (woods, merged crowns, lone trees), mapped
  rough. Anything else is `null` and he picks: rough is never assumed,
  because trees are patchy in OSM (Bankstown, Camden and Pymble show
  none).
- **Estimated fairway:** a par 4/5 with no mapped fairway of its own gets a
  dashed 32 m strip from 120 m out (or 40% of the way) to the green's edge.
  It's decoration only: it never sets a lie.
- **Frames:** a map shot is `{mx, my}` in metres from the map's fixed
  `origin`. Three frames now (map, art, outline), still never mixed on one
  hole: a hole already traced on another frame keeps it for that round.
  The origin never changes once rounds are logged. Unlinking keeps the
  shots; they're "not measurable" until the map is back.
- **Ownership:** a shape belongs to the nearest hole line only if its
  middle is inside the course boundary. With "any vertex inside", a
  neighbour's fairway poking over the fence became Randwick 7's and its
  estimated strip vanished. Features that aren't part of any hole
  (Bardwell's range, putting green) are listed in the source's `ignore`.
- **Trees:** mapped single trees within 14 m of each other, in groups of 3
  or more, merge into one canopy; lone trees stay single. Canopy is drawn
  outline-then-fill, so touching crowns read as one scalloped edge with no
  boolean geometry.
- **Credit:** "Map data © OpenStreetMap contributors" wherever a map is
  drawn (ODbL).
- **Legend** (1.10.0): `HoleMap.legend()` under the map in the logger and on
  the hole page. `legendKinds()` lists only what the hole's view shows (no
  "Water" on a dry hole); swatches use the map's own classes, so dark mode
  follows. Unmapped ground is labelled "you pick the lie", matching the rule.
- **Where the courses stand** (export of 2026-09-27): Randwick has OSM hole
  lines (tier A). Bardwell Valley has shapes but no lines, so its holes come
  from his mapping in the source file. The Coast (1.9.0) has OSM lines for 16
  holes; 4 and 14 are in the source's `addHoles`, proposed from the routing and
  the card and confirmed by him (14 drawn `straight`: the straight distance is
  the card's 321 m, while the route along the fairway zig-zagged to 355). OSM has 11 as a
  par 5; his card says 4, and the card wins. Bondi (1.11.0) is 9 holes, all
  OSM lines, checked against his GPS-app card ("Mens metres": 133, 104, 111,
  138, 257, 101, 150, 118, 123). Those are exactly the published scorecard's
  numbers × 0.9144, so the published card is in **yards**. The course import
  (`imports/bondi-golf-diggers.json`) first held those yards as metres; it now
  holds the metres. OSM agrees with the metres: 81 m off in total against 121,
  and only hole 8 flagged against 6 and 8. The two sources' stroke indexes
  disagree; the import keeps the published order until the club's card settles it.
  Massey Park (1.12.0): 18 OSM lines, checked against his GPS-app **red** card;
  every red tee lands on a mapped box (hole 7 at 15 m, the limit), so nothing is
  flagged. OSM has 5 as a par 4; the card's par 5 (450 m) wins. The app shows
  no red for hole 9, so the source card has `null` there and the import's red
  set skips 9 (it falls back to the blue 156 m via `teeMetres`). The import
  (`imports/massey-park.json`, blue primary) gained the red set; its stroke
  index is Hole19's, which differs from the GPS app's (noted in the import).
  Long Reef (1.14.0): 18 OSM lines, checked against his GPS-app **white** card
  (par 71, 5,035 m). OSM's lines start at the back tees, up to 61 m past the
  whites, and the white tee still lands on a mapped box on 15 holes; flagged:
  4 (25 m from a box), 11 (17 m), 16 (44 m). 15 is the one hole whose card
  (391 m) is longer than its line (364 m). Long Reef's course record isn't in
  `imports/`, so the NAS card wasn't compared here.
  Northbridge (1.15.0): 18 OSM lines, par 64, **no card in the source**. From
  1.15.0 a tier A course is built from OSM alone: the course page's card check
  runs live against the NAS card, so screenshots are asked for only for holes
  it flags, or for courses without hole lines (a tee→green mapping, as at
  Bardwell). Every Northbridge hole has a mapped tee box for that check.
- **GPS, for Play mode** (1.15.0): `HoleMap.projection(origin)` is the one
  projection; the build script uses it too, so a fix lands where the shapes
  were built (a test projects OSM corners and matches the committed map to
  0.08 m). `fromLatLng(map, lat, lng)` → `[x, y]`, `toLatLng(map, p)`,
  `offCourse(map, p)` (metres outside the boundary, 0 inside: ignore a fix
  far off the course), `greenDistances(hm, p)` → `{front, middle, back}`
  along the line from p through the green's middle; front/back `null` where
  the green isn't a mapped shape, never guessed.
  Hurstville (2.2.0): 18 OSM lines, a tee point per hole and pins, but no
  green or tee shapes, and no card in the source. Each green is **estimated**:
  a 12 m circle on the hole's pin (within 30 m of the line's end, else the
  end), `est: true`, drawn dashed as "Estimated green (not mapped)". It never
  sets a lie (a tap there is `null`, he picks) and gives no front/back
  distance, only the middle. A mapped tee *point* (`teept`) counts as a tee
  box for the card check.
  Barnwell Park, Beverley Park and Lane Cove (2.4.0) have only a boundary in
  OSM: their sources are `holes: "marks"`, so each map file is a boundary and a
  fixed origin, and every hole comes from his **GPS marks** (Play's *Mark tee*
  and *Mark flag*, stored raw on the course by the Carry chat's 2.3.0).
  `forHole(id, n, metres, {marks, tee})` builds a hole from them on every read,
  never stored, wherever the file has no line or only an estimated green
  (`hmFor` passes the course hole's marks and the round's tee). Line: the mean
  tee mark for the tee played (else the set nearest the card) to the mean flag
  mark; green: a dashed 12 m estimate there (`est`, `mk`), so no lie and no
  front/back, as at Hurstville. Tee marks are tee points for the card check.
  Marks must **agree**: within 20 m (`MARK_NEAR`) of their set's median, and a
  majority, else the hole isn't drawn (a flag marked on the wrong hole would
  otherwise move the green; he moves holes by hand, so it will happen); rough
  fixes (> ±10 m) and fixes over 30 m off the course are ignored. At
  Hurstville, flags within 40 m of a line's end move its estimated green and
  the line's end; a mapped green (every other course) ignores marks. The
  course page lists holes drawn from marks and holes still waiting. Limit: on
  a hole's first visit nothing is drawn until the flag is marked, so that
  hole's shots that round are on the outline (frames never mix).
  Hunter Valley's only nearby course is unnamed and partial, so
  it keeps its artwork (holes 1–9), and converting its old rounds waits for a map.

## Play mode (2.1.0)

Asked for 2026-10-19 ("built with GPS from the start"): logging during the
round instead of afterwards from 18Birdies. Rounds → *Start round*
(`startPlay`), or *Play: hole n* on today's round page. The view is
`vPlay` under `rounds` with `sub.play`; the hole logger's tap, lie, club,
putt and penalty handlers run unchanged, because the sub still has `hole`.

- **Where he is:** `watchPosition` (high accuracy) runs only while the Play
  view is open (`playLifecycle()` after every render) and stops when he
  leaves; the screen is kept awake where the browser allows. A fix is
  placed with `HoleMap.fromLatLng` (the build's own projection). Older than
  30 s (`GPS_STALE`) it isn't used; more than 150 m outside the boundary
  (`OFF_COURSE`) he's "x km from the course". A new fix redraws only
  `#playLive` and the dot (`playLive()`), never the page, so a tap in
  progress isn't lost.
- **Distances:** front/middle/back from `HoleMap.greenDistances` (straight
  line, labelled so). Hazards (`hazardsAhead`): the hole's own bunkers and
  water whose middle isn't behind him, nearest edge = reach, farthest
  point = carry, side of the straight line to the green; at most 5.
- **Marking:** *Mark my ball here* adds a map shot at the fix through the
  same `addMapShot` as a tap (club = the armed one, his usual, never
  advice; lie from the map), with `gps` = accuracy. Over ±25 m
  (`GPS_ROUGH`) it asks first.
- **A hole is done** (`holeDone`) when it has a score and, if shots were
  marked, its putts: with shots the stored score is a running count, so
  one marked shot isn't a 1. The running total, *Hole n →* and
  *Play: hole n* use it.
- **No signal:** the shim's outbox. A save that can't reach the NAS
  (TypeError, or Cloudflare's 502/504/52x) is kept in `localStorage`
  (`carry.outbox`, latest copy per document), shown as saved, overlaid on
  anything the server returns until sent, and sent on start, on every poll
  and on the browser's `online` event. A newer save that gets through
  drops a waiting older one; a set waits for a send in progress. The status
  line says "n changes saved on this phone, waiting for signal". Limit: no
  service worker, so a closed app can't reopen without signal.
- **GPS marks** (2.3.0, asked by the hole-maps chat and agreed with him):
  on a hole the map can't draw (`wantsMarks`: `hm === null`, or the
  hole's green shape has `est`: the note said `hm.green.est`, but `hm.green`
  is a point and holemap.js flags the shape), the live panel offers *Mark tee* (until the hole has a
  shot, putts or a score) and *Mark flag* (primary once it's scored;
  repeats allowed, the map side averages them). Each adds a raw fix to the
  shared course's `holes[i].marks` (see SCHEMA.md), refused over ±10 m
  (`MARK_ACC`) with "GPS ±18 m: move into the open and try again", or more
  than 3 km from the course's location. Saved through `save()` queued per
  course, so it waits in the outbox without signal like any save. The server
  merges marks on every course save (`mergeCourseMarks` in `db.js`, also used
  by the import script, which keeps both sides), so friends' phones with
  older copies can't drop or resurrect one, and only `by` = you can be
  removed (the hole page, `holeMarksSection`). The map side builds the hole
  from them; `hmFor` will take the course for that (hole-maps chat).
- **Not measured on a real course yet.** Distances are checked against
  hand-worked geometry and the globe (haversine) in `ui-play`, but phone GPS
  under trees and how a phone browser treats Cloudflare's offline errors
  are the first round's test.

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

`npm test` — 267 tests, about 40s.

- `api.test.js` (25) — the server alone: sign-in (forged key, wrong
  audience or team, expired, alg none, no email, the email header alone,
  cookie, clock skew, keys unreachable, not configured, `DEV_USER`),
  whose documents are whose (isolation, shared courses, per-person stamps,
  the course-delete guard, GPS marks surviving other phones' copies and
  refused when rough), assets (uploader-only delete, sign-in for
  files, byte ranges, safe serving), the 1.x migration (refused without an
  owner, converted with a backup, idempotent), import with `--owner`,
  `/api/version`, the stamped page, and `/api/analyse` against a fake
  Anthropic API (`ANTHROPIC_BASE_URL`). `test/access.js` is a stand-in
  Cloudflare: a real RSA key, its certs endpoint, and JWTs signed with it.
- `versioning.test.js` (7) — the changelog format and its agreement with
  `package.json` and the lockfile, the PR gate, the release notes, and
  that publishing runs the tests first.
- `regressions.test.js` (8) — the 1.3.1 review fixes, each reproduced
  before it was fixed: local dates, quick taps, render cost with a season
  of data, panels staying open, an old token link leaving the URL, escaping;
  and 2.1.1's page clearing the tab bar.
- `web.test.js` (6) — the real `web/index.html` in jsdom against a live
  server signed in by `DEV_USER`: writes land in SQLite, uploads become
  blobs, polling works.
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
  sessions), `ui-penalties` (the penalty report), `ui-handicap` (the
  WHS estimate against hand-worked scores: caps, the table, exceptional
  scores, pairing nines, soft and hard caps, 54.0, the ratings form),
  `ui-courses-sort` (closest / recently added / A–Z, defaults, dates from ids),
  `ui-play` (Play mode with a stand-in GPS: picking the course you're at,
  distances against the globe and a hand-worked straight hole, hazards
  ahead and on this hole only, marking by GPS, rough and stale fixes, off
  the course, location blocked, GPS off on leaving, a hole done only with
  its putts, a course with no map, and the outbox: no signal, Cloudflare's
  502, a poll not undoing a waiting save, newer beating older, sending on
  start),
  `ui-marks` (Mark tee / Mark flag on an unmapped hole: the raw fix stored,
  ±10 m refused, flag after scoring, edits keep marks, only your own
  removable),
  `ui-holemap` (linking a map, the card check, taps in metres and lies
  from shapes, the legend showing only what the hole has, outline holes
  staying put, edits keeping the link, unlinking, a boundary-only map drawing
  only the holes with marks).
- `course-maps.test.js` (22) — the committed maps match their sources,
  attribution and fixed origins, Randwick's own lines (not the neighbour's),
  ownership inside the boundary, Bardwell's and The Coast's hand-mapped
  holes, Bondi's metres-vs-yards check, Massey Park's reds and missing hole 9, Long Reef's whites, Northbridge without a card, Hurstville's estimated greens, boundary-only maps and holes from GPS marks (agreement, stray and rough marks, the tee played, moving an estimated green), GPS projection and green front/middle/back, which holes are flagged and why, the tee rule and the tee-box
  check, lies, the view's orientation and tap round trip.
- `housekeeping.test.js` (7) — the sign-in sheets (home address, expired
  session by redirect and by Cloudflare's 401, asked once), "Signed in as"
  and the shared-courses notes, a refused course delete saying why, request
  logging without the query string, a clean SIGTERM exit, the YAML's five
  replace markers.

`test/harness.js` boots a real server on a free port with seeded
documents, loads the page as the server serves it into jsdom, and stubs only what jsdom lacks
(`<dialog>`, SVG CTM as identity so taps land at exact coordinates,
object URLs, `TextEncoder`, `Blob.arrayBuffer`). The swing suite adds a
fake decoder that reproduces the real one's timing: `seeked` fires before
the frame is painted.

Every gotcha above has a test, and each was checked by reintroducing the
bug and watching the test fail (22 mutations for the original suites,
18 for versioning and screenshots, 8 for the practice list, 14 for
1.5.0's distances, penalties and housekeeping, 26 for the handicap,
9 for course maps, 4 for the 1.9.0 tee-box check, 9 for holes from marks, 2 for the legend, 5 for the
stroke index column, 28 for 2.0.0's sign-in and whose-data rules, 23 for Play
mode and the outbox, 15 for GPS marks (14 caught by their own test; a wrong
`tee` field from the app survives it because the server corrects it); all
caught.
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
3. **More course maps** (see *Course maps*). Barnwell Park, Beverley
   Park and Lane Cove are drawn from his GPS marks as he plays them; Hunter Valley
   waits for OSM, then its art rounds convert to approximate map positions.

Done in 1.5.0: recency weighting of club distances, session filtering
(leave out, ball type), the penalty report.

Deliberately out of scope: booking integration, anything that sends his
data anywhere — with one exception he chose on 2026-10-19: **Cloudflare
Tunnel** for off-LAN https (README, *Off the LAN*), because Play mode needs
GPS and a phone only gives GPS to an https page. Access in front, and since
2.0.0 Access *is* the sign-in (`API_TOKEN` is gone). Friends sharing it is
in scope since 2.0.0 (he asked, 2026-10-19); anything beyond "friends on
one NAS" (accounts, roles, invitations in the app) is not: who gets in is
the Access policy.

Play mode shipped in 2.1.0 (see *Play mode*). Next for it, once he's used
it on a course: a service worker so the app itself opens without signal
(today only saves survive no signal; the page needs the network to load).
**Not wanted: working out the hole from GPS** (he decided 2026-10-19). On
public courses the next tee is often beside the last green, so a fix there
puts him on the wrong hole; he moves holes himself (‹ ›, *Hole n →*).

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
