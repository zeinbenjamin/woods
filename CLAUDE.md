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
3. Nothing to bump for the service worker (2.54.0): `web/sw.js` is served by the
   server with the build stamped in, and its page cache is named after the build.

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
server/teetimes.js  reads a course's public MiClub tee-time pages on request
web/index.html      the app, one file, ~3,200 lines
web/platform.js     the shim: artifact capability surface → this API
web/holemap.js      course maps: loading, tee rule, lies, the yardage-book drawing
web/vendor/maplibre/ MapLibre GL 4.7.1: Courses on a map, drawn as a yardage book (loaded when opened)
web/vendor/leaflet/ Leaflet 1.9.4: the same map's fallback without WebGL
web/vendor/mediapipe/ MediaPipe Pose Landmarker (heavy since 2.65.0) and its wasm: the body, measured on swing frames
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
never waits for a poll. **Only what changed** (2.59.0): a collection comes with `t`,
the time of its latest change (`listDocsStamped`), and the poll asks
`/api/<collection>?since=<t>` (`listDocsSince`: documents written at or after it, every
id so a deletion is seen, the new `t`, one read). Before, every save, every shot
marked in Play mode, brought the whole collection back (about 690 KB of sessions with
a season of data), and start-up downloaded everything twice. Write times only go
forward (`now()` in `db.js`, from the database's latest at start), so a clock stepping
back can't hide a write. The shim keeps the server's copy (`server`, `since`), redraws
only when a document really differs or went, and drops a refresh that crossed a save
of its own (`writes`), so an answer from before the save can't put the old copy back.
The service worker passes `?since=` straight to the network and folds a good answer
into the whole copy it keeps (`deltaThrough`), so opening without signal shows what
the page last had; `carryRefetch` asks for the whole collection.

## Who works on what

Two Claude chats work on this repo at once, each on its own branch, each
merging to `main` through its own PRs. Ownership is by file, so their
changes don't collide and each knows what it may change.

| | **Hole-maps chat** (`claude/relaxed-einstein-tj8m13`) | **Carry chat** (`claude/gifted-carson-g3y6hd`) | **Monitor chat** |
|---|---|---|---|
| **Owns** | `web/holemap.js`, `web/course-maps/`, `course-maps/`, `scripts/course-maps.js`, `test/course-maps.test.js`, `test/ui-holemap.test.js`, and the *Course maps* section below | Everything else: the app (`web/index.html`, `web/platform.js`), the server (the monitor's endpoint included), `imports/` and every course record (pars, lengths, stroke index, tee sets, primary tee, ratings), the course form, handicap, releases tooling, all other tests and docs | Nothing in the repo: no commits, branches, PRs or deploys |
| **Reads, doesn't change** | The course records: the card is what a map is checked against | The map files | The running app, through `GET /api/admin/*` only (see *Monitoring*) |

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

## Monitoring (2.14.0)

A third chat watches the deployed Carry: is it up, which build, is data
arriving, what the data says. Its charter (drafted 2026-10-25 in that chat):
it writes nothing, anywhere: no commits, no app data, no deploys, no
Cloudflare or TrueNAS changes. Findings come to this chat (a bug with
evidence) or the hole-maps chat (a map problem seen in real data) as notes
through Zein. It can't see production any other way, and neither can this
chat.

- **The door:** `GET /api/admin/*`, registered before the person check in
  `server/index.js`, guarded by `requireMonitor()` in `server/auth.js`: the
  same JWT verification as a person's token (`verifyToken`: signature, `aud`,
  `iss`, `exp`/`nbf`) but it must be a **service token**: no `email`, and
  `common_name` equal to `CF_ACCESS_MONITOR_ID`. A person's token is 401
  there; the service token is 401 everywhere else (`emailFromToken` still
  refuses "token has no email"). Anything but GET → 405. `CF_ACCESS_MONITOR_ID`
  unset or REPLACE → 503 `monitor_not_configured`; keys unreachable → 503.
  `DEV_USER` reaches it locally, for the tests. Every answer is
  `Cache-Control: no-store`.
- **`/health`:** version, commit, uptime, auth mode, whether an owner is
  configured, database and WAL sizes, free space on `/data` (`statfsSync`),
  stored files count and bytes, the owner's last write, whether the 1.x
  backup exists (`migratedFrom1x`).
- **`/activity`:** for `OWNER_EMAIL` and the shared courses only: counts and
  last write per collection, and the last 200 lines of the owner's own
  logged requests (the lines the container log gets: writes and errors,
  never successful GETs, never the query string) plus 5xx lines with no one
  signed in. A ring buffer in memory (`recent`), wiped on restart.
- **`/data`:** the owner's documents and the shared courses in the
  `carry-export` shape (`scripts/import-export.js` reads it), `assets: {}`
  (no file bytes) and `files` (the owner's asset metadata).
- **Zein's decision (2026-10-25): his data and the shared courses only.**
  Nothing under `/api/admin` reveals a friend's documents, counts, emails or
  request lines; `api.test.js` seeds a friend and checks. `OWNER_EMAIL`
  unset or REPLACE → `activity` and `data` are 503 `owner_not_configured`;
  `ownerEmail()` in `db.js` is the one reading of it.
- **The numbers the app shows are worked out in the browser.** The server
  holds raw documents, so anything the monitor computes from `/data` is its
  own arithmetic, never "what the app shows"; a disagreement comes here as a
  question.
- **Setting it up** (outside this repo): Cloudflare Zero Trust → Access →
  Service Auth → a service token `carry-monitor`; a *Service Auth* policy
  attached to the **existing Carry Access application** (Access policies
  have no path; paths belong to applications, and a second application for
  `/api/admin` would carry its own AUD tag, which `verifyToken` refuses).
  So Cloudflare lets the token reach every path, and Carry refuses it
  outside `/api/admin` because it has no email. The policy is the reusable
  one Bourdain's monitor token is also on, so **Cloudflare admits either
  token; the `common_name === CF_ACCESS_MONITOR_ID` check in
  `monitorFromToken` is what keeps Carry to its own** (`api.test.js`: a
  valid service token with another `common_name` is 401). Its Client ID
  goes into the carry YAML as `CF_ACCESS_MONITOR_ID` (a line for it in
  `deploy/truenas-compose.yml`, empty by default); the monitor session's
  environment gets `carry.elevengrant.com` allowed and the token's id and
  secret as network secrets for `/api/admin/`, GET only. The secret never
  goes into a chat.

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
- **A pasted card fills the form, never the record** (2.9.0, *Paste a
  scorecard* in the course form, `parseCard`/`wireCardPaste`): "n: par /
  metres / si" lines, as the hole-maps chat writes them, read strictly (each
  hole once, par 3–6, every hole present, else "Not filled: …" and nothing
  changes), and "blue tees" in the text sets the form's tee, because the
  form files its lengths under that tee. Other tee sets are named, never
  changed. Saving goes through `saveCourse`, so everything else on the record
  survives. If the save changed a par, rounds there whose own par copy
  differs are offered the card's pars (`offerRoundPars`, asked; scores
  untouched). Made for Hurstville, whose record held a card in OSM's old
  numbering (renumbered after the redesign, hole-maps 2.8.0). An import file
  can't do this: "Import a backup" replaces the whole course and needs its id.
- **Editing a course must preserve hole fields the form doesn't own** —
  artwork, outline shape, tee sets. A previous version dropped artwork on
  any course edit. Stroke index is now the form's (1.13.0: the scorecard's
  fourth column, 1..N, each once; a cleared box removes it), because there
  was no other way to add one and Randwick came over without it.
- **Contact sheets above ~1400px or in portrait have caused rendering
  failures.** Individual frames at 800–900px are reliable. **16 frames a
  swing** (2.18.0, asked through the monitor chat: the downswing is about
  0.25–0.3 s and 8 frames gave it one at most, so no reading could say when
  the wrist angle went): `FRAME_COUNT`, about 0.1 s apart on a 1.5 s trim.
  The trim hint (`trimNote`) shows the gap and warns over `GAP_WARN` (0.15 s).
  Not 24: analysis time, phone video blurs through impact anyway, and the
  image-set limit above.
  **Packed around impact** (2.26.0, the monitor's third item, he asked for it):
  the trim has an *Impact* slider; marked, `frameTimes()` puts `IMPACT_FRAMES`
  (10) of the 16 from `IMPACT_BEFORE` (0.3 s) before the mark to `IMPACT_AFTER`
  (0.1 s) after, about 0.04 s apart, and the other 6 over the rest in
  proportion to its length, still address to finish; unmarked, even as before.
  The mark is stored on the swing as `impact` (SCHEMA.md), the prompt says the
  frames are packed around it and that the mark is by eye, and the card says
  "packed around impact at 1.0 s" instead of a mean gap. A mark outside the
  trim is ignored. **The trim preview stayed black** on some clips: it was
  seeked to exactly 0 (the same gotcha), and iOS doesn't paint a frame of a
  video that has never played. It now never seeks under 0.05 s, is played and
  paused once (muted, inline), and a file the browser can't decode (HEVC
  from Photos outside Safari) says so instead of a blank box. The prompt gets each frame's time, and a
  down-the-line swing is asked the wrist question (`wrist` in the analysis;
  shown under *What Claude saw*). Older swings keep their 8.
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
- **A hole's score on a traced hole is always `holeStrokes()`** (shots +
  putts + the hole's penalty counter + penalties ticked on shots). The round
  form once recomputed it without the shot-tied penalties, so editing a note
  on a round took a stroke off (2.11.1). And **a lie never recorded (`unknown`)
  is neither a hit nor a miss**: on a marks-only course nothing is mapped, so
  counting it as a miss made every drive at Lane Cove a missed fairway.
  **Tee names are matched ignoring case** everywhere (`teeMetres`,
  `ratingOf`, `roundsOffTee`): the round form's tee is free text.
- **Days are local, never UTC.** `today()` builds the date from local
  fields; `toISOString().slice(0, 10)` dated everything before 10am
  Sydney as the day before. Use `localDay()` for any calendar date.
- **Writes to one round go one at a time.** `updateHole` queues per round
  and applies each change to the latest copy; two quick taps used to start
  from the same stale round and the second save dropped the first shot.
- **Derived numbers are memoised per data state** (`memoised()`, keyed on
  the identity of `S.sessions`, `S.clubs`, `S.courses`, `S.settings`, `mapEpoch`
  and, since 2.59.0, `today()`, since recency and freshness count whole local days).
  **2.59.0, measured** (he asked for a performance review; Chromium, 390px, CPU 4x
  slower, a season of 30 traced rounds, 20 Trackman sessions, 45 measured swings):
  `rankedPractice` and `strokesGainedRecent` were rebuilt on every draw (35-70% of the
  Overview, Range and round pages; each shot's `clubFit` scanned every session through
  `rangeBlocksFor`), now memoised, as is `rangeBlocksFor`; a map's holes are kept per
  course object (`hmCached`, a WeakMap, reset by `mapEpoch`; undefined while a file
  loads is never kept), and their drawings per hole and marks (`hmSvg`). Overview 288 →
  ~50 ms a draw, Range 244 → ~20, a round 168 → ~45, a course page 390 → ~160 (the rest
  is the browser building 18 maps). `regressions` counts the rebuilds and `ui-visuals`
  the map asks; both fail on the old code. Results are read, never changed in place:
  keep it so, or the cache serves the change to every later draw. A
  season of data used to cost 2.3s a render (8,600 club-stat recomputes).
  So those arrays must always be *replaced*, never mutated in place, or
  the cache goes stale. A **course map arriving** is a change of data state
  too (`mapEpoch`, bumped by `mapArrived`, the map's `onLoad`): before 2.7.0
  numbers first worked out while a map file was still loading kept its shots
  unmeasurable (out of the practice list, breakdown and approaches) until
  the next save. `ui-visuals` reproduces it.
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
  **Renewed at the top level, since 2.39.1** (he kept seeing the bar). 2.31.2
  loaded `/api/stamps?reauth=…` in a hidden iframe so a still-good Cloudflare
  login could hop back with no page. On an iPhone that can never work: every
  iOS browser is WebKit, which blocks third-party cookies, and inside Carry's
  frame the `cloudflareaccess.com` login cookie is third-party, so the hop
  always stopped at the login page and the bar followed 8 s later. Confirmed
  from here that Cloudflare answers a background request with a 302 to
  `elevengrant.cloudflareaccess.com` (the proxy can't reach that host, so its
  own headers weren't read). Now: one refused poll is a glitch; the second
  saves where he is (`carry.resume` in sessionStorage: tab, sub, scroll, open
  folds) and `signInHop()` does `location.replace` of the page, the trip a
  reopen makes, where the cookie is first-party; back on Carry, `resumed`
  restores the screen once (within 5 min). Never while `#sheet` or
  `#confirmDlg` is open (`busy()`): the bar shows, and the next refused poll
  after it closes makes the trip. At most one trip per `REHOP_GAP` (2 min,
  `carry.rehop`), so a login that won't take shows `#signinBar` with *Sign in
  again* instead of looping; no sessionStorage, no trip. The outbox keeps
  saves across it. Tests swap `window.carryHop` for the navigation. This
  reverses 2.31.2's "never a reload on its own"; the busy guard keeps what
  that rule protected (a half-typed form). If the bar still shows often, the
  Cloudflare login session itself is short: Access → the Carry application
  and its policy's session duration, against Bourdain's.
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
- **A new list's class must not be one the app already uses** (2.56.1, he sent screenshots
  of the Swings page): the pose trend was `ul.trend`, and `.trend` is the Overview's
  scoring chart (`height: 80px`), so every club's list overflowed its 80 px box and drew
  over the timeline. It is `ul.ptrend` now; `ui-pose` checks the computed height. The
  debug sweep checked sideways overflow only, so it missed it; the sweep now also flags
  content past a fixed-height box and siblings drawn over each other (scratchpad, not the
  repo: it needs Chromium and a seeded server).
- **A chart that fills its column can't hold its words in the SVG** (2.57.1, his iPad): the
  *Across the swing* traces were a 240-unit viewBox at `width: 100%`, so on an iPad's
  ~1000 px column every label, red dot and guide box drew about 4x (text near 40 px). The
  lines now stretch (`preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`)
  inside a 64 px `.trbox`, and the words, dots and boxes are spans laid over it by
  percentage. The other text-bearing charts have a `max-width` (`.dplane` 280, `.pattern`
  420, `.ghist` 560 since then). Check a new chart at 1024 and 1366 too, not only 390.
- **Spacing is set by adjacency, not per section** (2.25.1, he sent three
  screenshots of folds against buttons, Delete buttons against text, and the
  bag table cut off): `.folds`, `details.fold`, `.row-actions` and `h2` get
  their gap from what precedes them (`details.sec + .folds`, `.folds +
  .row-actions`, `.row-actions + h2`, …), and a lone `.danger` button row gets
  28px above. The bag is `.bagrow` rows (who / three `.bagnum` numbers / Edit),
  not a table: five columns never fit a phone. Subtitles join their parts
  with `filter(Boolean).join(' · ')`, so an empty suburb or par can't leave a
  stray comma or full stop. A heading with buttons beside it
  (`.spread:has(> h2)`, 2.27.1) carries the heading's margins itself and
  zeroes the h2's: the buttons are taller than the heading, so margins on
  the h2 alone left them touching the text above and below. A fold that follows a whole
  section (`section.sec + details.fold`, 24px, 2.41.1, he sent a screenshot of the
  course page's *Use this map* button on *Course information*'s rule): `.fold`'s
  `margin: 0` also cleared the 30px a `.sec` gets. Check a new
  section at phone width before shipping; the sweep screenshots are how
  these were found.
- **No double-tap zoom, and inputs are 16px** (2.11.2): `html { touch-action:
  manipulation }` stops the double-tap zoom while keeping pinch, and iOS zooms
  into any input under 16px on focus, so the 15px fields zoomed the page.
- **A card is 9, 10, 12 or 18 holes** (`CARD_SIZES`, `cardSize()`, 2.20.0,
  for Moore Park: holes 1–10 of its old layout from 1 July 2026 while a
  12-hole course is built, an interim 12 from 2 November 2026). A card of 10
  or 12 is one whose holes are exactly 1..n; any other count over 9 is an
  18-hole card with gaps, and an empty new course starts at 18. Before this,
  `fullCard` padded a 10-hole course to 18 (eight "missing" holes on the
  course page, 18 rows in every form). The scorecard table (2.20.2) is one table for 9 or 10 holes, two sixes
  for 12, two nines for 18; and today's round offers *Play* only while a
  hole is unfinished. The handicap refuses a 10- or 12-hole
  card with the reason, checked **before** the rating so it never asks for a
  rating it couldn't use (`ui-tenhole`, which loads the real import file).
  The import (`imports/moore-park.json`): the club's course page is the card
  (metres, blue/white men's and red women's), stroke index re-ranked 1–10 from
  the club's 18-hole order, no rating stored (only the old 18 were rated),
  location OSM relation 2253129.
- **The round form fills lengths from the tee picked** (2.20.3, found by the
  monitor chat in `/api/admin/data`: his red-tee Moore Park round stored the
  blue lengths). `roundForm` and the course-change handler use `cardForTee(c,
  tee)` (`holesForTee`), and a delegated `change` on `[name=tee]` re-fills
  each length that still equals the previous tee's card value, leaving typed
  ones (`prevTee` follows the course change, since the tee control is rebuilt
  then). `holesOf` always resolved through `teeMetres(courseHole, r.tee)`, so
  no number shown was wrong; the stored snapshot was. Older form-entered
  rounds off a non-primary tee keep their snapshot: `holesOf` corrects it on
  read, and nothing stored is derived from it.
- **The import picker takes any file** (2.20.1): `accept="application/json,.json"`
  greyed out `imports/moore-park.json` on his iPhone, because a file saved
  from GitHub or Mail there is typed as plain text. The app checks the
  contents itself, so there is no `accept` at all.
- **Import a backup takes many files** (2.38.0, he asked with 77 course
  imports to load one at a time): the picker is `multiple`; every file is
  parsed and checked first, one `confirmAsk` sums courses, sessions and images
  across the good ones and names each skipped file with why (not JSON, not an
  export); then `applyImport` runs per file with "File i of n" progress, and a
  file that fails part-way is named and the sheet stays open. `ui-import-many`
  covers three courses and a stray, and only wrong files refused.
- **The page's scripts carry the build** (2.47.1, the Courses tab stuck on the
  last page, or blank, on his desktop after 2.47.0): with a cached `holemap.js`
  from before 2.46.0, `HoleMap.icons()` threw inside `vCourses`, and `render()`
  had lit the tab before the throw, so the old page stayed and it read as a
  hang. Most likely a cache along the way (Cloudflare's or the browser's) gave
  an old copy despite `no-cache`; not confirmed. Now `index.html` asks for
  `platform.js?v=__APP_BUILD__` and `holemap.js?v=__APP_BUILD__`, and `sendIndex`
  fills `<version>-<commit>`, so each build's scripts have their own address;
  the list guards for an older HoleMap (no pictures, no throw); and `render()`
  catches a view that throws and shows `#viewError` with the message. The
  harness inlines the tags by that pattern and fails if they lose the build.
- **The swing overlays don't rely on `vector-effect`** (2.69.1, his iPad: a swing picture all sand, frame and lines
  hidden). The plane (`.planeSv`, viewBox the frame's aspect × 1), the tracer (`.trShot`) and the skeleton (`.poseSk`)
  drew in a viewBox 1 tall with stroke widths in pixels kept by `non-scaling-stroke`; that browser dropped it, so the
  tracer's 9-unit landing dot was nine frames wide. Reproduced in Chromium by switching the property off. Widths are now
  in the frame's own units (about .0045 for 3 px on a 670 px frame), and the tracer draws in the frame's aspect
  (`trShotSvg`, `tracerInner(…, ar)`, `frameAr`; the video overlay's `data-ar`, updated on `loadedmetadata`) so its dots
  stay round. Checked in Chromium with `vector-effect` forced off everywhere: the card, the skeletons, the playing clip
  draw as before. The hole maps and *Across the swing* keep `vector-effect` (their viewBoxes are large: dropping it
  would thin a line, not cover the picture). Why that iPad dropped it isn't known.
- **App listens on 1818** (8080 was taken on his box). It's `PORT`-driven
  everywhere including the healthcheck.

## Who can play (2.39.0)

He asked, after the tee-times booking audit of 2026-10-29, for the app to show
whether a course is public or private. `access(c)` is `closed` (`c.closed`),
`public` (`bookable === true`), `private` (`bookable === false`) or null (not
known); `accessTag` puts it in the Courses list (since 2.60.0 in the map pins' colours,
`.tag.acc-<access>`: sand public, lavender private, red closed; he asked, and
chose *private* over *members* on both the tags and the map's key), and Course information says it under *Who can play* with
`bookingNote` (how to book) under *Booking*. The form's `access` choice
replaced the "Public booking" checkbox, which stored `false` (private) for
every course saved with access unknown; `accessFields` keeps an unknown one
unset. `ui-access` covers it.

**The booking audit** (2026-10-29): three agents found how the public books
each of the 91 NAS courses, by web search (club sites and miclub.com.au are
blocked from this container, so no booking page was opened here). 38 MiClub
public calendars, 8 GolfNow, 1 each Quick18 (Lane Cove), BRS Golf (Barnwell
Park), golf-booking.com (Hurstville), 2 the club's own; 12 phone or email,
20 members/guests/reciprocal only, 2 walk-up (Bondi, Botany), 1 enquiry form
(The Lakes), 1 closed (Kogarah), 4 unknown. The 77 batch imports carry the
result (`bookable`, `bookingUrl` where the URL itself was seen, `prereg`
where the site says to register, `bookingNote`), each `source` ending
"booking: web search of 2026-10-29 (seen | inferred …, <where>)". The other
10 courses have no import and were left for him to edit in the app; Bexley,
Bondi, Massey Park and Moore Park (stored links already) weren't touched,
since three of those files are behind the NAS (map links, ratings). The
tee-times idea this was for: a MiClub reader would cover 38 of the 51
courses bookable online, GolfNow 8 more; not built.

## Tee times (2.40.0)

He asked (2026-10-29, "similar to myteetimes"): filter tee times by distance,
day, time, holes and players, with booking left to the club's site. The booking
audit (*Who can play*) found 38 of the 51 online-bookable courses on MiClub,
so the reader is MiClub's. `server/teetimes.js`, called by
`GET /api/teetimes/:courseId?date=YYYY-MM-DD[&from=HH:MM&to=HH:MM&holes=9|18&players=n]`
(signed in, before the document routes):

- **The pages** (read 2026-10-30 from Bexley through a page reader; this
  container can't reach MiClub): `ViewPublicCalendar.msp?booking_resource_id=R&selectedDate=D`
  lists each rate (`feeGroupRow`, `data-feeid`, `eighteenHoles`/`nineHole`,
  an `<h3>` name) with a cell per day from D (price, `cell-promotion` for a
  special, `cell-na` and no date when not offered); each offered cell links
  to `ViewPublicTimesheet.msp?bookingResourceId=R&selectedDate=D&feeGroupId=F`,
  whose `row-time` rows carry the time (`<h3>01:04 pm</h3>`), the tee, the
  fees, and a cell per spot, `cell-available` or `cell-taken`. Both public,
  no login. Copies are in `test/fixtures/` (scripts stripped by the reader).
- **Which courses:** `miclubSource(bookingUrl)`: a `*.miclub.com.au` host or
  a path under `/guests/bookings/`; the resource id from the link, else
  3000000 (`guessed`), and a calendar that won't parse under a guess says to
  store the full link. Gordon's and Richmond's `ListBookingEvents.msp` links
  are tried the same way, unverified.
- **Honesty:** a page that isn't a calendar or timesheet is `unreadable`, an
  error or timeout (10 s) is `unreachable`, a non-MiClub link `unsupported`,
  each with a message; never an empty list. Times are filtered here, after
  the read, and only those with a spot free (and enough for `players`) are
  returned, with `listed` saying how many the sheet had.
- **Asking politely:** pages are fetched only when someone searches, at most
  6 rates per course and day, one at a time, with a `Carry/1` user agent;
  each page is kept in memory `TEETIMES_TTL_MS` (5 min; errors 1 min) and a
  fetch in progress is shared. Nothing is stored, and the request to the club
  carries only the date and the rate.
- **Not checked live from Carry itself** (the container is blocked): the
  first search on the NAS is the test. If MiClub refuses a server (bot
  protection, a captcha: the calendar page carries an invisible reCAPTCHA,
  apparently for the login), it shows as unreachable or unreadable.
- **First live run** (2.40.1, his phone on the NAS, 2026-10-30, for Sat 7 Nov):
  Moore Park read end to end (one 12-hole rate, 48 times, free spots right,
  the twilight fee per time after 17:00), so a server is not refused. Two
  fixes: the holes come from the rate's **name** first (MiClub classes every
  non-18 rate `nineHole`; Moore Park's "12-Holes" read as 9), and `holes`
  accepts 9, 10, 12, 18; an empty `rates` always carries a `note`. Bexley was
  right to be empty (every rate "Not Available" that Saturday: "Nothing is
  open to the public on this day"). Massey Park's id 3000000 is the one its
  own *View tee times* button uses, and that calendar has no rates at all
  (registered public members only, it seems): "lists no rates at all… may
  only show after signing up", plus "or the course id Carry assumed" when
  the link had none. `test/fixtures/miclub-calendar-empty.html` is that page.
- **The search screen** (2.41.0, he said go): Courses → *Find a tee time*
  (`#ttOpen`) → `vTeeTimes` (`courses:view=teetimes`, `date` in the sub).
  Seven day chips (`#ttDays`, today first), a time window (two hour selects,
  `select[data-ttpref]`, a delegated `change`), players 1–4, holes Any/9/18
  (a 12-hole rate shows only under Any), and within 5/10/20/40 km or Any
  (only with a `home`; without one every course is searched and `#ttHome`
  says so). The filters are `localStorage` `carry.tt` (a per-phone
  convenience, nothing stored). **Who is searched** (`ttCourses`): not
  `closed`, `bookable !== false`, a link `ttReadable` reads (the server's
  `miclubSource` test), within the radius; others with a link or
  `bookingNote` are folded under *Booked another way*; private/closed and
  courses with no location are counted in `#ttNotes`. **Asking:**
  `ttLifecycle()` after every render asks `/api/teetimes/:id?date=` once per
  course and day (`tt.res`, `TT_PARALLEL` 4 at a time, kept `TT_STALE` 5 min
  in memory), **unfiltered**: `ttFit` applies time, players and holes in the
  page, so a filter change asks no club anything (`ui-teetimes` counts the
  requests); today drops times already gone. Answers redraw at most every
  50 ms (`ttRedraw`). **Showing:** courses with times first by distance, each
  a fold `tt_<id>` ("8 times from 12:16 · from $25") with a row of time chips
  per rate, each chip a link to that rate's timesheet (new tab) with spots
  free, its own price when it differs from the rate's (Bexley's twilight),
  and the tee when it isn't the 1st (Bexley's 10th); then still checking,
  nothing that suits (the server's `note`), couldn't read (with the club's
  page). `#ttStatus` says how many courses have times and the time of the
  **oldest page** behind them: the server's `fetchedAt` is now when its
  oldest page was read, not when it answered, so a cached answer isn't
  passed off as new. **Check again** (`ttRefresh`) sends `fresh=1`, which
  re-reads a club's page only if Carry's copy is over `TEETIMES_FRESH_MS`
  (1 min) old, so taps can't hammer a club. Checked in Chromium at 390 px,
  light and dark: no sideways scroll.
- **His first search** (2.41.2, Sun 1 Nov, 05:00–10:00, 4 players, 18
  holes, 20 km): 2 of 21 courses had times, and 17 rows said "No times left
  that match", which buried them and said nothing. Now the courses with
  nothing (and those that couldn't be read) are one fold, `#ttRest`
  ("Nothing that suits · n courses, m couldn't be read"), under the list, and
  each says the nearest miss (`ttMiss`, from the day's own times, the filters
  relaxed one at a time): no rate for those holes; nothing in the window but
  n times with room outside it, from the first; n in the window without the
  spots; all with fewer spots. Liverpool was "could not be reached": the
  audit's link was `liverpool.miclub.com.au`, which doesn't resolve; the club
  is Oak Point (merged with Kogarah) and books on `oakpoint.miclub.com.au`
  (3000000, seen in search results), so `imports/liverpool.json` carries that.
  *Find a tee time* moved beside *Add course* on the heading's row (and is the heading's one
  button since 2.50.0, *Add course* an icon beside it).
  **TeeNet is no shortcut** (checked 2026-10-30, he asked): MiClub's own
  listing (`clubshare.miclub.com.au/teenet`) shows only clubs that opted in,
  and its full list, served with the page, has three: Huntingdale and
  Keysborough (VIC), The Vines (WA). No NSW club at all, and a search near
  Sydney finds none. Reading each club's own calendar stays the way.
- **GolfNow is not read, on purpose** (2026-10-30). Its facility pages
  fill in times by script, so a reader would call its API, and its Terms of
  Service (golfnow.com.au, effective 12 Jan 2026, s.2) say "You may also not
  use any software robots, spider, crawlers, or other data gathering or
  extraction tools, whether automated or manual, to access, acquire, copy,
  monitor, scrape or aggregate Content", and limit use to "personal and
  non-commercial use". MiClub's public calendars carry no such terms, as far
  as was seen. GolfNow's 7 courses stay under *Booked another way*, linked.
  Put to him before building anything.
- **Gordon and Richmond** (2.41.3): their links are MiClub's
  `/guests/ListBookingEvents.msp` on the club's own domain, which
  `miclubSource` and `ttReadable` didn't recognise; both now take any
  `/guests/<Page>.msp` (`MICLUB_PATH`). Their standard calendars read normally
  (Gordon 187: 18 and 10 holes; Richmond 3000000). **Long Reef, Northbridge
  and The Coast** are MiClub too, but their NAS records (no import file) have
  no `bookingUrl`, so they aren't searched until one is added in the app;
  each calendar reads at `<club>.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000`
  (`longreef`, `northbridge`, `coast`; The Coast shows "Timesheets open 7 days
  prior" further out).
  **The Ridge is phone only** (2026-10-30): the audit filed it under
  GolfNow, but its own page says to call the pro shop, and its MiClub
  calendars (on its domain and `theridge.miclub.com.au`) carry only lesson
  bookings, so no MiClub link: `imports/the-ridge.json` now has the club's
  tee-times page, a phone `bookingNote` and its listed green fees.
- **Filters, two lines and any day** (2.42.0, he asked): the seven day chips
  are followed by *Pick a date* (`#ttPick`, a `type=date` input laid invisibly
  over a chip so the native picker opens), from today to `TT_AHEAD` (365) days;
  `ttDate()` accepts any day in that range, else today. The filters are a label
  over each control in two `.ttline` rows: Time + Players, then Holes + Within
  + Max price; Within became a select (`data-num`), and the new `price` pref
  (`TT_PRICES` 30–100, `carry.tt`) keeps times whose own fee (`ttPrice`: first
  fee, else the rate's price) is at or under it; an unknown price is left out
  under a limit, never guessed in, and `ttMiss` names the cheapest that would
  otherwise suit. Day chips, segment buttons and selects are set like the
  app's buttons (2.43.1, he asked: "consistent with the design of the app", not
  2.42.0's 16px of their own): 500 14px, 38px tall. A select can't be under
  16px or iOS zooms into it, so each is a `.ttsel` label showing the choice,
  with the real 16px select laid invisibly over it, as `#ttPick` is.
  **An open picker isn't redrawn away** (2.43.2, he found *Pick a date* shut a
  second after opening): each answer arriving redrew the page, replacing the
  date box and closing the phone's calendar. Background redraws (answers,
  polls) go through `bgRender()`, which waits while `#ttPick` or a filter
  select has focus (`pickerOpen()`, retried every 250 ms); a change to the day
  already shown (iOS fills in today on opening) is not a new search.
  **The day row keeps its place** (2.44.0, he found it jumped back to the
  start): `render()` keeps `#ttDays`' `scrollLeft` across the rebuild
  (`ttDaysScroll`), and a day picked (`ttSetDay`, which replaced `go()` there so
  the page doesn't jump to the top either) brings the pressed chip into view
  once (`tt.showDay`); other redraws leave the row where he scrolled it. Checked
  in Chromium at 390px (jsdom has no layout). **On a computer** a click on the
  invisible date box selected its typing fields and opened nothing, so a click
  calls `showPicker()` where the browser has it. Measured in Chromium at 390px,
  light and dark: two rows, one size, no sideways scroll.
- **TeeItUp, read at his decision** (2.43.0, 2026-10-30: "build the GolfNow
  reader anyway, since it's for personal and non-commercial use"; told first
  that GolfNow's terms ban automated reading for any use). TeeItUp is GolfNow's
  booking engine for clubs (`<alias>.book.teeitup.com/?course=<GolfNow
  facility id>`, title "GolfNow Booking Engine"); its page is built in the
  browser (a TinyFish run found no times in the HTML), so the reader asks the
  API the page uses: `GET <TEEITUP_API>/v2/tee-times?date=D&facilityIds=ID`
  with `x-be-alias: <alias>` (`TEEITUP_API` defaults to
  `https://phx-api-be-east-1b.kenna.io`). **Seen live** (2.43.2, his NAS,
  Georges River for Sun 1 Nov: 31 eighteen-hole times at $45, 23 nine-hole
  from 2 pm at $32): the answer's shape in `parseTeeitup` (a day per facility
  with `teetimes`, each with `teetime` ISO, `maxPlayers`, `rates[]` with
  `name`, `holes`, `greenFeeWalking`, `allowedPlayers`, `backNine`) is right,
  read defensively: times with an offset moved to Sydney's clock, fees of
  1000+ taken as cents, spots from `allowedPlayers` else `maxPlayers`, which
  is the players still bookable, not the group's size (it equalled the spots
  on every time; 2.43.0 subtracted `bookedPlayers` from it and called it the
  group's size, `of`, now null); a time with neither is left out. An
  answer that doesn't fit is `unreadable` with `sample` (its first 1500
  characters), and an error status keeps its body in `sample`, so the first
  live search says what to change. `test/teeitup.test.js`'s answer is
  hand-made, labelled so, from the times the live Georges River page showed.
  Courses: Georges River 16001, Marrickville 16264, Palm Beach 17230, Avalon
  17227 (imports carry the TeeItUp links, and Georges River's and
  Marrickville's now the NAS's map link too, so a re-import keeps it);
  Bardwell Valley 16578 (no import: set in the app). Wallacia and Woodville:
  no TeeItUp address found (guessed subdomains don't exist), GolfNow links
  kept. The page's `ttReadable` takes a TeeItUp link with its course id.
- **A course's own tee times** (2.45.0, he asked: "tee times for each course
  when you click their course card"): `courseTeeTimes(c)`, the fold
  `#courseTt` under the course page's subtitle, closed by default. The club is
  asked only once it's open (`ctLifecycle()`, from `ttLifecycle()` after every
  render and from a capture-phase `toggle` listener); `ttWant` now returns how
  many it asked for, so the redraw that reopens the fold asks nothing and can't
  loop. Today first; once today's answer has no time left that suits, tomorrow,
  saying so (`ctDate`, his choice), until a day is picked (`S.sub.date`;
  `ttSetDay` keeps a course page a course page). The same day chips and *Pick a
  date* (same ids, so `ttDaysScroll`, `showPicker` and `pickerOpen` apply),
  players only (the search's pref; time, holes and price aren't applied to one
  course), `ttRatesHtml` (split out of `ttCourse`) for the times, *Check again*
  for that day (`ttRefresh` takes a date), and *Other courses this day →* into
  the search. The answers are the search's `tt.res`, so the two agree. A
  course Carry can't read shows its `bookingNote` and link ("members and
  guests" when private); a closed course, or one with no way to book, has no
  fold. `ui-courseteetimes` (4) against the stand-in MiClub.
- **Next:** the other TeeItUp courses' first searches, and a way to store a course's MiClub id when
  its link has none (Massey Park's calendar shows nothing publicly).

## Appearance (2.37.0)

He asked for a toggle: System, Light, Dark. `settings.theme` (SCHEMA.md;
unset or anything unknown = system). `applyTheme(t)` sets or removes
`data-theme` on the root, which the CSS has honoured since 1.0
(`:root[data-theme="dark"]`, `:root:not([data-theme="light"])` under the
media query), and copies it to `localStorage` `carry.theme`, applied at
startup before the first render so the page doesn't open in the wrong mode
and switch when the server answers. `render()` re-applies from settings, so
a choice made on another phone lands on the next poll. `themePicker()` /
`ACTIONS.setTheme` in Settings' *Appearance* section (`#appearance`, after
the bag). `ui-theme` covers the default, each choice, the stored copy, the
server's copy arriving, and nonsense reading as System.

## The hook, the body fold, analyse all (2.69.0)

He sent a screenshot of a hook he traced (ball, peak up and right, landing just left of the peak but right of the ball)
drawn as a fade with a flat cut back at the top, and his own red line over it. `tracerSegs` levelled at the peak heading
toward the landing *as seen from the ball* (`sign(land − ball)`); it now heads where the ball goes *after* the peak
(`sign(land − peak)`, the ball's side only when the two are level), so the rise bulges a little past the peak and
turns over, as his line did. `ui-tracer` checks his taps: past the peak the line only moves left. **The body** is one
quiet fold, `#bodyAll_<id>`, "The body, measured · 16 of 16 frames · 2D · impact as marked · 6 measures", holding the
four positions and every measure (the old *Every measure* fold went into it); the earlier-model notice stays on the card.
**Analyse all** (he asked for the measure-all button back after the model change): `swingsToAnalyse()` (frames and no
reading, no pose or `poseOld`, a reading without `ties` where `poseContext`/`swingShotContext` give something to tie, or
`analysedView` ≠ `view`); the Swings page's `#analyseAll` "Analyse n swings" runs `analyseOne` (the card's Analyse,
split out) for each in turn, `#analyseNote` saying which of n; an error stops it and says after how many. Temporary,
at his word: with none needed it isn't shown. `#measureAll` stays beside it (quiet, also only while needed) for
measuring alone, which costs no reading. `ui-swingsum` (5).

## One row of buttons, the notes at the foot (2.68.0)

He sent three screenshots of the 2.67.0 card: buttons in four places (*Redraw the shot*, *Move the ball*, *Measure
again*, the bottom row), the "hands from n frames" note in the middle, *What Claude saw* under the fix, and asked what
the difference between Analyse and Measure was. **Analyse does both**: `ACTIONS.analyseSwing` measures first
(`measureAndSave`, the trace too) when the swing has no pose or one by an earlier model (`poseOld`), then reads, so the
reading gets `poseContext`; a model that can't run reads without and toasts so. **One row** at the card's foot: *Analyse*,
*Play video*, *Trace/Redraw the shot*, *More…* (`ACTIONS.swingMore`, `#swingMoreList`: tap/move the ball, measure the body
again, trace the hands from the video, change angle, delete; measuring and tracing close the sheet and report on the
card's `pm_`/`tr_`). The sections draw bare (`tracerSection(…, bare)`, `planeSection(…, bare)`, `poseSection({bare})`):
pictures and switches only; no ball means no plane section (tapping it is in More, or the tracer's first tap).
**Quiet folds** at the foot (`swingFolds`, `.qfolds#sf_<id>`, the `qfold` style of the Range list's checks): *What
Claude saw* (`readingSeen`, with the "read from frames… a reading, not a measurement" credit, which left the fix; its
row label says *The fix · a reading*), *How the lines were drawn* (`#drawn_<id>`: `traceNote`, the tracer's note with
when it was traced, the plane's camera when off the line, "the club isn't tracked"), *Every measure*, *Across the
swing*, *Frames*. The Swings card has the same foot, `rc_` ids. `ui-swingsum` (4) covers the row, More and the folds,
and Analyse measuring then reading.

## This swing, in one place (2.67.0)

He found the swing card's parts each talking about their own thing (screenshots of his Georges River 5i and Long Reef
driver: the reading, the tracer with its tiles, the body, the plane, one after another); asked whether they could be
combined, he said build it. **The summary** (`swingSummary`, `#sum_<id>`, `.swsum`, after the header): four rows
(`.sumrow`, `#sumBall_`/`sumBody_`/`sumPlane_`/`sumFix_<id>`), each only when there's something for it: **the ball**
(the tied shot's tiles, `tracerNumbers` now `#shotNums_<id>`, moved here from the tracer since they're the ball's, not
the drawing's, and `swingShotSection`; the label says the traced shape; untied, the *Which shot was this?* question);
**the body** (`n of m outside the guide:` named by `BODY_SHORT`, the measures with a guide, plane ones apart; too few
frames says so); **the plane** (`planeSay`'s first clause, one phrase when the top and coming down agree, a miss in
`.offg`); **the fix** (`swingReading(…, {fold: true})`: the one thing, `analysis.ties` as *How it fits together*, and
why/feel/drill/check in `#how_<id>`, What Claude saw as before). **`ties`** (SCHEMA.md) is asked of new readings only
when there are measures or a tied shot (`poseContext || swingShotContext`), 30 words: which measured positions and the
shot the fix accounts for, and where they disagree. A judgement left to the reading, not matched in code; older
readings get `#tiesHint_<id>` ("Analyse again…"). **One picture:** with both switches on and a plane to draw
(`planeDrawsShot`), the traced flight goes on the plane's address frame (the camera doesn't move, so the taps' 0..1
hold), the crop widened to its peak, `Shot traced by you · Draw` at the bottom, both switches on the plane's row
(`.switches`), *Redraw the shot* beside *Move the ball*; `tracerSection` draws nothing then. Either switch off and the
other draws its own picture as before. **Folded:** every measure (`#bodyAll_<id>`, `poseSection(…, {fold: true})`),
Across the swing and the frames; `poseSection(…, {plane: false})` on the card, which draws the plane itself after the
tracer. The Swings tab's card carries the summary read-only, ids `rc_`. Measured on his data (Chromium, 390px, same
cards before and after): the 30 Oct driver 2,437 → 1,747 px, Long Reef's driver 1,902 → 1,526. `ui-swingsum` (3); 12 mutations caught.

## The shot tracer, by hand (2.66.0)

He asked (2026-10-31, "let's add the shot tracer now"), the traced version of the mockup's boards
(https://claude.ai/artifact/6NRpduNMeXDGSb7bJMxto9); the measured tracer (calibration taps, the bay's peak height) is
later. **Stored:** `swing.tracer = {peak, land, shape?, on}` (SCHEMA.md), 0..1 of the frame, the ball being `swing.ball`
(shared with the swing plane, so a plane's tap is reused). **The sheet** (`ACTIONS.traceShot`): the ball on the address
frame (skipped when set, *Back* still reaches it), then the peak and the landing on the last frame (where the sky is
clear of him), then the shape (`SHOT_SHAPES`, tapped again to take back); *Redraw the shot* starts from what was
stored. **The flight** (`tracerSegs`): two cubic Béziers, out of the ball near straight up, level at the peak heading
the way it finished (`run` from the sideways travel, at least a tenth of the height), steepest at the end. Not
`crSegs`: a spline through three taps made a V at the peak on his 30 Oct driver. `tracerSamples` gives points along it;
`tracerInner` draws all or part (dotted sand on a dark underlay, `vector-effect: non-scaling-stroke`, a round-capped
zero-length stroke for the ball and the landing, so dots stay round in a stretched 0..1 viewBox). **The card**
(`tracerSection`, before the body): its switch, the last frame cropped top to bottom to the flight when the pose gives
the aspect, *Traced by you · Fade*, and `tracerNumbers` when the swing is tied to its shot (`swingShot`): course, went,
finished and left to the green from the hole map; range, the bay's carry, total and side (or "left or right: not
measured here"). Untied with shots in the session, it says to tie it. "A drawing from your taps, not a measurement."
**On the clip** (`traceVideoHtml`, `wireTrace`): an `svg.trShot` over the video beside the plane's `svg.trOv`, either
alone; it flies from `tracerStart` (his impact mark, else the trace's impact cut, else whole) over `TRACER_DRAW` (1.2 s,
less if the clip ends first), whole when paused; with no pose the box takes the video's own aspect on
`loadedmetadata`. **`svg.trShot.trShot`** outranks `.bigmap svg { height: auto }`, which the swing sheet's video sits in
(found in Chromium: the tracer drew square, from the ball's height up). **Switch:** `overlaySwitch('tracer', ...)`, its
own key in `carry.overlays`. The Swings card shows it read-only (`rc_` ids). Checked in Chromium on his 30 Oct driver
(tied to hole 17: 221 m, rough, 229 m left), the card and the playing clip. `ui-tracer` (6); 14 mutations caught.

## The heavy model (2.65.0)

He drew his own hand path over the 3 Aug 7i (2026-10-31), and it disagreed with Carry's on the way back. Checked frame
by frame on his clip (backswing and downswing frames at the same heights, laid over each other, then the three
MediaPipe pose models on the same four frames, `scratchpad/cmp.png`): **lite put his wrists on his trail forearm going
back**, about 70 px from the glove (from behind, against the sky, his hands are on the far side of his body); `full`
was better but missed one; **heavy landed on the glove**. Smoothing can't fix wrong points, so the model was the fix.
Told the cost (31 MB once, about 3x slower here: 230-490 ms a frame on this CPU against lite's 80), he chose heavy.
`POSE_BY` is `mediapipe-0.10.35-heavy`; the lite file is gone from the repo. **Old measurements:** `poseOld(sw)` (a
pose or trace by an earlier MediaPipe model; hand-made test poses aren't) shows `#poseOld_<id>` on the card, and the
Swings page's `#measureAll` takes those too ("Measure n swings with the new model"), so his whole history can be
redone in one go; trends would otherwise mix models. `ui-trace` covers the note and the re-measure (pose old, trace
old). Not testable in jsdom: that the heavy file loads and runs, checked in Chromium on his 7i.
**The hands under heavy** (2.65.1): measured again with heavy, his 7i lost its plane ("not measurable") and its line
broke into 12 pieces. Heavy's per-joint score is *visibility* (is it seen), not whether the position is right, and down
the line the wrists are hidden behind each other and the body: at address lead 0.02, trail 0.41, both under `POSE_VIS`;
92 of 356 traced frames had no wrist over 0.5. The positions were still on the glove. So the hands alone
(`handFrom`, used by `poseMeasures`' `handP`, the trace's `handOf` and `traceData`) take a wrist from `HAND_VIS` (0.3),
and two wrists over `HAND_APART` (0.06 of the frame) apart give the surer one, not the middle (both hands hold the grip,
so one is wrong); every other joint keeps 0.5. His 7i after: the plane back (top inside the V, 65° against 55-67°), 292
traced points in 6 runs, the backswing up behind and the downswing nearer his body, as his own drawing had it; a
zigzag at chest height on the way down is the model in the fastest, blurriest frames. Coming down isn't measured on it:
its 8 old frames have none between the top and impact. `ui-plane` (5) checks the rule and the plane from one wrist.
Also fixed a race in `ui-pose`'s measure-all test (it checked before the page's redraw; the full suite caught it once).

## The hands traced from the video (2.64.0)

He asked (2026-10-31, with two screenshots of pro swing tracers): the swing plane's hand line smooth like those.
Told first what they are (hands, clubhead and ball; the club isn't tracked here) and the issues (phone time, the
clip's own frame rate, blur at impact, swings without video, smoothing that can lie, drawing on the playing video,
storage); he said go. **Traced:** with `sw.video`, `measureAndSave` (and *Trace the hands from the video*,
`ACTIONS.traceSwing`, for swings measured before) runs `traceHands`: about every `TRACK_STEP` (1/60 s) across the
frames' span, at most `TRACK_MAX` (90) seeks, by `videoFrames` (the extraction rules: never at 0, wait until
painted). The frame actually shown is `requestVideoFrameCallback`'s `mediaTime`; **a seek onto the frame already
shown paints nothing, so the browser never calls back** (found on his 30 fps Long Reef clip: each repeat waited the
1.2 s timeout and counted as a frame, 170 s and "50 a second"): no call in 150 ms and the same 16-pixel thumbnail
is a repeat, skipped. The pose model runs on each (`detectCanvas`), and `swing.track` (SCHEMA.md) keeps the two
wrists per point; fewer than `TRACK_MIN` (8) stores nothing. A clip the browser can't decode keeps the frames
(`traceErr`, said on the card). **Drawn** (`traceData`, on every draw): the points' hands (both wrists, or the
sure one), runs broken where neither is sure or points are over 3.5 steps apart, never bridged; each traced point
averaged 1-2-3-2-1 with its neighbours (model jitter, drawing only); the top and impact for the colours from the
trace (hands highest, then lowest), a marked impact kept; `crSegs` (centripetal Catmull-Rom as Béziers: through
every point, no loops where points bunch at the top); `traceInner` colours each Bézier by the part its middle falls
in (`pl-back`, `pl-down`, `pl-thru` after impact, grey). Without a trace, the 16 frames dotted (`.sparse`) with
`#traceNote_<id>` saying it's drawn, not measured. **On the playing clip** (`traceVideoHtml`, `wireTrace`): the
video in a `.trBox` of the pose's aspect with an SVG over it, so the drawing sits on the picture (in the feed the
box is sized by container units in `.reel`); playing, it draws to `currentTime` with the hands as `.pl-head`;
paused, whole (his choice). In the swing's sheet (`playSwing`), the card's *Play video* (`reelPlay`) and the feed;
off with the *Swing plane* switch. Measures still come from the 16 frames. **On his data** (Chromium, the real
model on his two driver clips, H.264): Long Reef 52 frames at about 31 a second (a 30 fps clip), the 30 Oct one 84
at about 47 (a 58 fps clip, 90 seeks); both lost the wrists for about 0.15 s after impact (blur) and broke there.
At his marked impact (30 Oct) the model's wrists sit on his hands at belt height, checked frame by frame against
ffmpeg's frames, so the 36% high is real. **Time:** 70–90 s here, on a container with no GPU (SwiftShader); a
phone's GPU should be much faster, not yet measured: his first trace is the test. `ui-trace` (4): the smoothing,
the trace against a stand-in 30 fps clip and a stand-in model (repeats, a lost and a half-lost stretch), the note,
the colours' cuts, measuring with a video, an undecodable clip, the overlay part and whole, the feed, the switch;
16 mutations caught (three survived at first: a loose bunching check, the wired overlay never played, no one-wrist
stretch; all tightened).
**Slow motion** (2.64.1, his phone screenshot of the 3 Aug 7i: a line of corners): that clip is slow motion, the
swing filling 2 to 12 s of 13 (first read here as an untrimmed clip; a strip of its frames at 2 a second settled it),
so 90 looks across the span gave the downswing about ten, and every rule in seconds was wrong for it. Now nothing is in
seconds: the first look covers the whole span every `TRACK_STEP` or, when longer, `TRACK_MAX` (240) evenly; the
downswing is the hands' fastest drop over a 60th of the points (`swingPhases`), the top the highest raw point walking
back until the hands are 30% of the swing's height below it, impact the same forward; and when the downswing had looks
less often than `TRACK_FINE` (1/50 s) it is filled at `TRACK_STEP` (`TRACK_FILL` 120 more), unless the first look met
the same frame twice (it had every frame already). The colours' cuts in `traceData` come from `swingPhases` too (a
marked impact kept). Two first tries failed on his clip and are not to be repeated: a coarse "biggest drop" finder
(it found the hands coming down after the finish) and a same-wrists dedupe (a still address can repeat). The note no
longer gives a frame rate (the looks are uneven). His 7i (H.264 copy, since Chromium here can't play HEVC): 233 frames,
top at 6.1 s and impact 8.2 s, the backswing, downswing and finish where the clip shows them; the two drivers' cuts
unchanged. `ui-trace` (5): a slow-motion stand-in with the model's wobble, every downswing frame present, the cuts, no
fill on a 30 fps clip.

## The swing plane (2.63.0)

He asked (2026-10-31, with the shot tracer mockup at https://claude.ai/artifact/6NRpduNMeXDGSb7bJMxto9; boards
8–10), and that plane faults feed the practice list. Down the line only, from the stored pose plus one tap:
`swing.ball` (SCHEMA.md), set in the sheet `ACTIONS.planeBall` on the address frame (capped at 58vh tall, the
camera check above it). In `poseMeasures` (dtl): `handP` (both wrists' middle, or the one over `POSE_VIS`; since
this release the top and impact are found that way too, so a hidden wrist no longer loses them), `m.hands`,
`series.handsUp`; `m.shGap` = the shoulders' horizontal gap at address over the torso, `m.inLine` under
`PLANE_INLINE` (0.2, a judgement: about 15° off the line); with a ball and in line, `m.plane = {ball, side,
shaft, shoulder}` (degrees up from the ball, on the golfer's side) and `series.plane` for every frame's hands.
`keys.down` is the frame nearest halfway in time from the top to impact. Measures (`POSE_MEASURES.dtl`):
`planeTop`, `planeDown` (band = the V, `vee` in `POSE_GUIDE`; worded by `planeSay`: inside, under the shaft line
"flatter", over the shoulder line "steeper"; left out of `poseValues` without `m.plane`), `handsImpact` (±10% of
the torso, `sure`: only when `m.impactSure`, impact marked or frames within `IMPACT_SURE` 0.06 s either side; his
unmarked clips are 0.1–0.5 s apart and a driver read 39% high from a follow-through frame, so it says to mark
impact instead). **Drawn** by `planeSection`/`planeSvg` over the address frame, cropped top to bottom to the swing
(`.planeCrop`), the paths with a dark underlay; the *Swing plane* switch (`overlaySwitch`, `ACTIONS.toggleOverlay`,
`localStorage` `carry.overlays`, default on) hides the drawing on this phone, the measures stay. The shot tracer
has its own switch beside it (2.66.0). Off the line: `#planeOff_<id>` says why, nothing drawn. *Across the swing* has
*Hands against the plane* (the V at the top and coming down) and *Hands height*. Plane faults reach the practice
list through `bodyItems` with `BODY_DRILL` entries, and the reading's prompt through `poseContext`. On his data:
Long Reef D (19 Oct) and the 30 Oct D, both inside the V at the top and coming down; the 30 Oct swing (impact
marked) has hands 36% high at impact, with the hips 29% toward the ball. `ui-plane` (4): the angles by hand, a
hidden wrist, steep and off-line swings, the card, switch and sheet, impact not caught, the practice list; 15
mutations caught (one survived at first: both test wrists identical; a hidden-wrist swing added, which found the
key-position bug above).

## Body faults in the practice list (2.62.0)

He asked (2026-10-31, with the shot tracer and swing plane mockup): plane faults and the other body measures should
feed the practice list. `bodyItems()` (in `practiceItems`, after `swingItems`): per club and camera angle, the
reliable, square-on measured swings (`poseMeasures`: `reliable`, `square !== false`) in date order; for each
`POSE_MEASURES` measure with a guide, a finding `body:<club>:<measure>` once it is outside the guide (`off` from
`poseValues`) on at least `BODY_MIN` (3) of the last `BODY_RECENT` (5) and at least half of them. Evidence is each
outside swing at `COST.body` (0.15, a judgement like the other costs); every measured swing is a chance, so it goes
quiet by the same rule as any finding once swings come back inside. **It ranks like a swing reading**: beside a
ball-data finding whose block is the same club it joins that finding as `support` and adds half its weight
(`rankedPracticeUncached`, `leans`), never its own drill; alone it is listed with `kind: 'body'` (`.pcard.k-body`),
a drill from `BODY_DRILL` and "2D, from the frames; the guides are rules of thumb." The host's card says it in one
`.bodysup` line; the finding's page (*The evidence*) lists each swing's value and whether it was outside;
`#rankRules` states the rule from the same constants. On his data: D, 5W and 7i hips toward the ball at impact
(5 of 5 each), D and 5W forward bend lost, 7i head height (4 of 5). Derived on every draw, nothing stored.
`ui-bodyfaults` (3) works hand-made down-the-line joints; 8 mutations caught (one survived at first: every test
swing in a finding was outside, so all chances counting as misses passed; a 3-of-4 club added).

## This swing's own shot (2.56.0)

He asked (2026-10-31, after asking whether it was worth it: the main value is a reading
checked against that very ball, not only the club's averages): `swing.shot` (SCHEMA.md)
ties a swing to the shot it hit, a reference only. Round: `{hole, i}`; `applyHoleUpdate`
runs `retagSwings` in the same write, so a tag follows its shot by identity when an
earlier one is deleted (`indexOf` of the old shot object in the new list), stays when
shots are edited or moved in place, and is removed with its shot (`removeShot`, *Undo*,
*Clear hole*). Range: `{block, i, carry, total}`; `swingShot` takes shot `i` if its
carry and total still match (`sameShot`), else the one shot in the block that does, else
`{gone: true}`, which the card says ("no longer in this session"), never a guess. A
re-paste keeps the tag; nothing is rewritten.
- **What it says** (`swingShotText`, derived on each draw): course, the hole, shot and its
  kind (`SHOT_KIND`, the shot records' rule: a par 3's tee shot is an approach), club,
  from, how far it went (`shotLen`), where it finished, metres left, penalty; range, carry,
  total, side, face and path, smash, strike class (`classify` in the same pool as the block
  page). A course shot logged with another club than the swing says so (`shotClubNote`).
- **Where:** the swing card (`swingShotSection`, `#ws_<id>`: *Which shot was this? →*
  only where the session has shots; *Change*); the sheet (`tagSwingShot`: the swing's club
  first in `#tagShots`, the rest folded in `#tagOther`, *Not tied to a shot*); the reading's
  prompt (`swingShotContext`, "THIS SWING'S OWN SHOT", with the club's range stock total
  beside a course shot, and `ball_data` judged against it first); *filmed* on the hole's
  shot list and the block's shot table (`filmedShots`); *Filmed* (`#goalFilmed`) on a
  finding's page for swings whose shot is in its `recs` (tee misses only, penalties by the
  shot's tick) or, for a strike finding, a tagged low runner or top of that club
  (`goalSwings`); the timeline row and the feed's card (`#reelShot`); *(course)* on pose
  trend points.
- Shots carry no time, so nothing is matched automatically; picking from the club's
  shots is the way. Two swings can share a shot (face-on and down the line together).
- `ui-swingshot` (6): tagging a course and a range swing, the text against the app's own
  geometry and his 5W numbers, the prompt, a tag following a deleted shot and going with
  its own, a re-pasted block, untying, the finding's page, the timeline and card; 16
  mutations caught (one survived at first: no par 3 in the round; added). Checked in
  Chromium at 390px, light and dark: no sideways scroll.

## The body, measured (2.55.0)

He asked (2026-10-31, after the mockup at https://claude.ai/artifact/RXTm3HqHiPQb3Fdd2cnUYK)
for pose estimation before the course overlay. **The model:** MediaPipe Pose
Landmarker, heavy float16 v1 since 2.65.0 (lite before; see *The heavy model*), with `@mediapipe/tasks-vision` 0.10.35 (Apache-2.0),
vendored in `web/vendor/mediapipe/` (17 MB: `vision_bundle.mjs`, the SIMD wasm only,
`pose_landmarker_heavy.task`, 31 MB, so about 42 MB in all; `LICENSE.txt` says where each came from), loaded by
`import()` on first use (`poseModel`: GPU, else CPU) and run in the browser on the
swing's stored frames. No outside host, nothing sent. Without WebAssembly SIMD (iOS
before 16.4) it says so. Checked in Chromium on MediaPipe's own sample photo: 33
joints, the express static server types `.mjs` and `.wasm` right.
- **Stored:** `swing.pose` = `{by, on, aspect, frames: [{asset, t, j: [[x, y, vis] ×
  33] | null}]}` (SCHEMA.md), positions 0..1 of the frame, rounded to 3 places.
  The joints are a measurement of each frame (slow to make on a phone), like the
  frames themselves; every measure is derived on each draw (`poseMeasures`). Matched
  to the swing's frames by asset (`poseFrames`), so a frame removed later drops out.
  The import's remap carries it.
- **Positions:** address the first frame with a body; impact the marked one
  (`sw.impact`), else the hands' lowest point after the top; the top the hands'
  highest before impact (in the first three quarters when unmarked); finish the last.
- **Measures per view** (`POSE_MEASURES`): face-on, along the target line (its
  side read from the lead shoulder at address, so a mirrored clip reads the same):
  hip sway at the top and hips at impact (% of hip width at address), head drift
  to impact (% of shoulder width), the lead arm's angle at the top. Down the line
  (the ball's side read from the nose against the hips at address): hips toward
  the ball at impact (early extension, % of torso length), forward bend lost
  (degrees), head height at impact. Other views: the skeleton, no measures. A
  right-hander is assumed for the lead arm, as everywhere.
- **The guide** (2.57.0, he asked for an "optimal" line on *Across the swing* and the areas
  of concern; told how thin the published data is, he chose guide bands over his own best
  swings): `POSE_GUIDE`, per view and series, a band at the top and at impact
  (`poseBand`; `rel` for forward bend, around its own address value), drawn as dotted boxes
  with a dotted path through their middles; the swing's point red (`tr-off`) and the
  measure "outside the guide" (`poseOff`, `off` on `poseValues`) where it leaves one; the
  reading's prompt is told too. **Across is time** (2.60.1, he found the chart crowded left with "topimpact"
  run together): `poseX` places a frame by its `t`, address to finish (one frame a step if a time is missing or
  out of order), so frames packed around a marked impact no longer take a column each; all four positions are
  dotted on every chart and named once under them (`poseAxis`, `.traxis`), a name too close to the one before
  dropping to a second line. Hips face-on are the one sourced band: Sportsbox AI's tour
  data in Golf Digest (pelvis under ~2 in away at the top, ~5 in toward the target by
  impact), converted over `POSE_HIP_IN` (an assumed 11 in between the model's hip points,
  not his): -18..18% at the top, 32..59% at impact. Head (-15..5% of shoulder width), lead
  arm (150..180°), down-the-line hips (-15..5% of torso), bend (±6° of address) and head
  height (±6%) are rules of thumb; spine tilt has no band. The legend (`#poseGuide_<id>`)
  says which. The long caption went (he found it verbose): the heading says `2D` and where
  impact came from.
- **Changing the angle** (2.57.0, he asked after the -394% clip): *Change angle* on the swing
  card (`swingAngle`, a sheet opening on the current one, `setSwingAngle`). The measures
  follow on the next draw; a reading keeps the angle it was made under in `analysedView`
  (SCHEMA.md; set by `analyseSwing` too) and the card says to analyse again
  (`#angleNote_<id>`) until the angle matches.
- **Honesty:** joints under `POSE_VIS` (0.5) are left out; a swing with a body in
  fewer than `POSE_MIN_SHARE` (¾) of its frames is "too few to rely on" and kept
  out of trends and the reading's prompt. Every place says 2D, from the frames,
  a measurement of where the joints were, not a reading.
- **Where:** the swing card (`poseSection`: *Measure the body*, then four positions
  with the skeleton, the measures, *Across the swing* traces in `#ptr_<id>`, and
  *Measure again*, 2.56.1; no body on any frame says so in `#poseNone_<id>`, found in
  the full debug of 2026-10-31, where it had said a face-on swing needed a face-on view;
  a face-on clip not square on, hip or shoulder width at address under `POSE_SQUARE` (0.2)
  of the torso's length, gets no face-on measures and says so in `#poseSquare_<id>`: his
  phone showed -256% and -394% of hip width, a shift divided by a width near nothing); the
  Swings page (`#measureAll`, and `poseTrendHtml` in each club's fold: since 2.58.0 a
  table, `table.ptrend`, one row a measure: latest value and date, change since the
  first swing, how many swings; he found the date-by-date list too much); the reading's
  prompt (`poseContext`). A measured swing's frame strip folds into `#frames_<id>`
  (*Frames · n*, 2.58.0), since the four positions show the swing.
- `ui-pose` (12) uses a stand-in detector (`window.carryPose`) with hand-made
  joints: face-on and down-the-line values by hand, a mirrored clip, unsure joints,
  a marked impact, a removed frame, the prompt, measure-all and the trends, a model
  that can't run, the import; 13 mutations caught (one survived at first: the trend
  test couldn't tell an unreliable swing was left out; tightened). Real run in
  Chromium (390px, light and dark): four frames stored on the server, measured,
  saved and drawn. Not yet run on his swings: the first real batch is the test.

## Opening without signal (2.54.0)

He asked (2026-10-31) for Play mode's last gap: the app itself opening with no
signal. `web/sw.js`, served by `GET /sw.js` (registered before the static files,
stamped with `__APP_BUILD__` like the page, `no-cache`, so a new build installs a
new worker), registered from the page only where the browser allows (`isSecureContext`:
https through Cloudflare, or localhost; jsdom has none). **Network first for
everything**, the kept copy only when `fetch` throws: so a reachable server always
wins, a sign-in redirect (`opaqueredirect`) passes through untouched and is never
kept, and an error answer goes to the app as an error. Kept: the page under `/`
and its build's scripts in `carry-shell-<build>` (filled at install; a redirect
there fails the install, tried again next load; older builds' shells deleted on
activate), the four data collections in `carry-data`, course maps, libraries and
icons in `carry-files`, as last fetched. Never kept: `/api/stamps`, tee times,
`/api/admin`, `/api/me`, `/_blob/` files, writes, `/sw.js`, other sites (map
tiles). A kept answer carries `x-carry-offline` (when it was kept); the shim's
`noteOffline` fires `carry:offline` once and `carry:online` when the server answers
again, and the status line says "No signal: showing this phone's copy from HH:MM".
On `controllerchange` the page asks for every collection again
(`window.carryRefetch`), so one open with signal is enough to have a copy. Saves
without signal are the outbox's, as before. **Known limits:** the data copy is
per phone, not per person (a friend opening Carry on his phone without signal
would see his copy); swing videos and photos aren't kept. `sw.test.js` (9) runs the
worker in a `vm` against stand-in caches and network, plus the server's stamped copy
and the status line; checked in Chromium against a local server: opened once with
signal, offline reload showed his session and the note, a save waited, back online
it reached the server and the note cleared.

## Back goes where he came from (2.61.0)

He asked (2026-10-31, after a round opened from the Swings tab went back to Rounds): "the back button should
reflect the page the user was previously on, not just the default of origination". Every `go()` notes the page
it leaves in `navStack` (tab, sub, scroll, open folds, the feed's place; at most `NAV_MAX` 30), and `back(tab,
sub, label)` is now `data-act="navBack"`: the last page in the trail that still exists (`navPrev`, skipping a
deleted round, course or block, `navExists`), named by `navLabel`, restored as left; with no trail (a fresh
start, a tab tapped), the page's parent as before. Rules: a **sideways** step, between two pages of one kind
(`navKind`: same tab, view, round, course, block or finding, hole or not, Play or not; a filter such as the
feed's club or a day doesn't count) replaces rather than stacks, so back from hole 7 is the round, not hole 6;
going to a page **already in the trail** returns to it (`navPush` truncates), so a circle can't grow; a **tab**
tapped resets the trail (`go(…, {nav: 'reset'})`); **finishing Play** replaces (`nav: 'replace'`), so the play
page isn't one to come back to; **deleting** (block, session, round, course) returns with `navBack`. Settings has
a back only when opened over a page (the gear); the feed's chevron, the course map's back, and every page's
back go the same way. The trail rides the sign-in trip's resume. `ui-nav` (10) walks the real links (14
mutations caught, one survived at first: the delete test couldn't tell the previous page from the parent;
rewritten). **Audited in Chromium on his data** (a scratchpad crawler, every kind of link from each tab, three
pages deep, through the Swings cards): each page's back names the page left and lands on it.
**The Swings tab's card** (2.61.0, same ask): *Play video* at the top right of `reelCardHtml` (`reelPlay`, the
clip in the card with controls, the feed behind paused; again hides it), and the measured body after the
reading (`poseSection(sw, s, {readOnly: true})`: no measure buttons, ids prefixed `rc_`; unmeasured says where
to measure it).

## Page headings (2.50.0)

He found the tops of Courses, Rounds and Swings crowded on his phone and the
Swings intro wordy. The rule since: **a heading carries one primary button**,
with anything rarer as an icon (`.iconBtn`, 36px, `aria-label` and `title`) or
folded into a sheet, and at most one row under it before the list.
- Courses: `#addCourse` (+ icon, `newCourse`) and `#ttOpen` (primary); the
  `.courseBar` is the sort (*Closest / Newest / A–Z*), the map pin and
  `#homeLink` (*From Home ›*, or *Set location ›*), one row at 390px.
- Rounds: `#addPastRound` (`ACTIONS.addPastRound`, a sheet of two `.choice`
  buttons: *Type it in* → `newRound`, *From screenshots* → `roundsFromImages`)
  and `#playOpen` (*Play*, `startPlay`). The penalty link only when there are
  penalties.
- Swings: `#swingBasis` is `n swings · Mon YYYY – Mon YYYY · all read`
  (`monthLabel`), the caveat is `#swingCaveat`, the page's last element.
Checked in Chromium at 390px, light and dark: one row each, no sideways scroll.

## The Overview

**Five tabs and a gear** (2.27.0, he asked, breaking 2.13.0's four: the
swing feed was too hard to reach): Swings · Range · Overview · Rounds ·
Courses, Overview in the middle as a green pill (`nav.tabs button.home`,
brighter when current). `swings` is a tab (`vSwingsTab`: the history, or
the feed with `sub.view === 'reels'`); the old `range:view=swings` and
`range:view=reels` links are forwarded by `vRange`, which sets `S.tab`.
Before that (2.13.0, he asked whether Courses and Bag
needed to be tabs): Overview · Range · Rounds · Courses on the bar, and
*Settings* (`vSettings`, tab `settings`, the gear `#settingsBtn` in the
header) holding everything set once: the bag (clubs), *Range numbers* (the
window / weighting / ball filters, `rangeFilter()`), location, export and
import, signed in. Courses stays a tab because a course page is history
(holes, shots, rounds, marks), not configuration. *Range vs course*
(`calibrationSection`) is a fold under *The detail* on the Overview with
`calibrationTeaser()` as its one number; the Overview's Gapping shows the
filter as one line (`rangeFilterLine`, `#rangeFilterLine`) that opens
Settings. A saved tab of `bag` opens Settings. The gear is an inline line SVG (2.49.1, he
asked, as the feed's sound icon went in 2.27.0): eight teeth and a hollow
centre in `currentColor`, stroke 1.6, never the ⚙ emoji, which drew as a
cartoon in some fonts.

The home screen (`vOverview`). 2.5.0 reorganised it from a review he
brought (a UI/UX write-up, Release 1 "Reduce the noise": the answer first,
detail one tap down), from 4.6 phone screens to 2.7 with the same numbers:
Current form (three tiles: last score with to par, over par a hole,
handicap; putts/fairways/greens and the handicap's workings in a fold) →
Next practice (the top ranked item as one action: club and target, the
drill, the finding it answers and its evidence, *Plan range session*; the
next two as rows that open the Range list) → Gapping (the range filter
as one line, with the numbers it filters; distance gaps and strike profile
folded) → Scoring trend (bars; best rounds and blow-ups folded) → The
detail (breakdown, approach distances, putting, range vs course, evidence:
each a fold showing its one number) → Recent (three). Folds are `fold(id, …)`, always
with an id so they stay open across redraws. A course page lists its
holes and rounds first and folds booking/fees/ratings/notes into *Course
information*. Each section is built from the existing
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
  (60) days, age in whole local days (`ageDays` = `daysAgo`; to the
  millisecond, two draws disagreed in the tenth decimal and the 2.11.3
  publish failed on it). The costs per kind (tree 0.8, water 1, three-putt 1, …) and
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

**Swing readings are coached as one fix** (2.11.0, he found the card too
long and asked for it the way a top coach would give it): the prompt starts
from the ball flight, picks the one cause that would clean up most of the
ball data, and answers in word-limited fields (`one_thing`, `why`, `feel`,
`drill{name, how}`, `check`, `ball_data`). `swingReading` shows those; the
observations, ball-data sentence and "can't tell" sit in `#seen_<swing id>`.
Older readings keep their text: fix and drill on the card, the rest folded.
`ball_data` decides agreement when present; older readings use the regex.

The chat route for swing analysis (save frames as a zip, copy a prompt,
paste the reply back) was removed in 1.3.0; analyses already saved with
`analysedIn: 'chat'` still show with that label.

## The loop around the loop (2.19.0)

A double-loop review (asked 2026-10-26: "do a review of the app based on
double loop learning", then "let's make the improvements needed"): the
practice loop is single-loop (evidence in, practice out) and nothing in the
app tested its own governing numbers; the second loop lived in the chats.
What moved into the app, all derived on every draw, nothing stored:

- **Is this list right?** (`listReview()`, fold `#listReview` on the Range
  list after *Quiet lately*; since 2.60.0 the three are `qfold`s in `.qfolds#listChecks`,
  the small grey disclosure toggle of *Across the swing* and *What Claude saw*, he asked): for every finding with dated evidence (not
  measure items or video readings), its outcome: `quiet after range work`
  (its club and swing hit at the range after it first appeared,
  `practisedSince(block, firstSeen)`), `quiet without range work`, `faded`
  (unseen over `STALE_AFTER`), `worked on, still showing` (chances hit after
  the range day), `worked on, waiting on the course`, `current, not worked
  on`; strike findings are range evidence themselves, so they are `improving
  at the range` or `still showing at the range` and don't count either way.
  With 4+ findings quiet either way it gives a verdict: as often without as
  with → "what this list ranks may not be what range time fixes… the costs
  are the thing to doubt"; otherwise "consistent with the list pointing at
  the right things; not proof the practice did it". Under 4 it says too few.
- **The rules shown** (`#rankRules` in *How this is ranked*): the costs
  (`COST`, now one constant the items and the text both read: tee into
  water 1, trees 0.8, bunker 0.5, rough 0.3; approach/short 0.5; three-putt
  1; penalty 0.6; strike 0.05), the quiet rule, `STALE_AFTER`, `STRIKE_FLAG`
  and `STRIKE_MIN`. Shown, not editable: editing would move the problem.
- **What the readings couldn't see** (`readingBlindSpots()`, fold
  `#blindSpots`): per camera view, readings with a `cannot_tell` and the
  distinct lines (merged ignoring case and punctuation, newest wording
  kept). Counting those by hand is how the 16-frame change was found.
- **Assumed against measured** (`beliefGap()`, `#beliefGap` under the
  Overview's Gapping ladder): mean of `nominalCarry − stockCarry` over clubs
  with both, "about right" under 2.5 m, and the club furthest off.

Not done from the review: tagging a finding's likely cause (technique vs
decision) so a tee finding can be answered by a club choice rather than a
range block, which changes the planner's shape and wants his call; and
strokes gained (roadmap 1), the baseline that would let the app doubt a
finding against what a player at his level normally does.

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

The filters live in the "Range numbers" section in Settings (2.13.0; 2.5.0 put it in the Overview's Gapping section, which now shows it as one line), shown open, `div#rangeFilter`, since 2.60.0 (he asked: no toggle on a settings page). The Overview's *Also costing you* is a fold (`#alsoCosting`) since 2.60.0 too.

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
Recently added (labelled *Newest* since 2.50.0), A–Z; the choice is `settings.courseSort`. Default is Closest
when his location is set and a course has coordinates, else Recently added.
"When added" (`addedAt`) is `course.created`, stamped on new courses, or the
time `uid()` put in an app-made id — only if the id also contains a digit,
because a 12-letter hand-made id like `c_lanecovegcsy` decodes to a
plausible 2022 date otherwise. The cost: about 1 in 50 app-made ids has no
digit and reads as undated (listed last), never misdated. The test checks ids
built from a known time; an assertion on a random `uid()` failed the 1.7.0
publish exactly that 1 time in 50. Unknowns (no coordinates / no date) go last,
A–Z, and the list says so.

**One row, and the map** (2.44.0, he asked): the sort, *View on a map*
(`#cmOpen`, a pin icon; just the icon since 2.50.0) and
the location link (`#homeLink`, `margin-left: auto`) are one `.courseBar`, which
wraps on a phone with the location on its own line, still on the right.
**The map** (`vCourseMap`, `courses:view=map`): a pin per course with
`lat`/`lng`, coloured by `access(c)` through `CM_COLOUR`/`cmFill` (2.49.1, his
colours, after the first set faded into the yardage-book map: public
`--score-1` sand D7B66D, members `--cm-members` lavender AA96BD (its own token, both
themes; he first picked the eagle green 4E9B76, then this), closed `--score-3` red
C96A6A, not known `--ink-3` grey; legend, GL pins and the Leaflet fallback alike), home as a square, the courses with no location
counted under it (`#cmMissing`); a pin's popup (`cmPopup`) has the name,
suburb, distance, access tag and *Open course*. Leaflet 1.9.4 is vendored in
`web/vendor/leaflet/` (BSD-2, its LICENSE beside it) and loaded only when the
map opens (`cmLoad`). **Tiles are OpenStreetMap's own** (`CM_TILES`,
`tile.openstreetmap.org`, no key; one person's map is light use under its tile
policy, attribution shown): opening the map asks it for the tiles of the area
shown, nothing of his. Dark mode inverts the tile pane (`#cmMap.dark`, set by
`cmTiles` from the theme), never the pins. 2.44.0 used CARTO's basemap, which
answered every tile on his phone with an "API key required" watermark
(2.44.1). This container reaches neither, so tiles have only been seen on the
phone. **The map is one element kept across redraws** (`cm.el`,
put back into the page's `#cmMap` slot by `courseMapLifecycle()` after every
render, `invalidateSize`), so a poll can't reset where he panned or close a pin;
pins redraw only when the courses, home or theme change (`cm.key`). Leaflet
keeps clicks inside a popup to itself, so *Open course* gets its own handler on
`popupopen`. `ui-coursemap` loads the real Leaflet into jsdom (with a
`createSVGRect` stub, which jsdom lacks): the row, the pins and colours, home,
the escaped popup, the same element and zoom after a redraw, a pin opening its
course, and no button without a placed course.
**Drawn as a yardage book** (2.49.0, from the roadmap, he said build it): the
map is MapLibre GL 4.7.1 (vendored in `web/vendor/maplibre/`, BSD-3, 803 KB,
loaded when the map opens, `cmLoadGl`) over **OpenFreeMap**'s vector tiles
(`CM_GL_SRC` `tiles.openfreemap.org/planet`, OpenMapTiles schema, to zoom 14,
fonts at `CM_GLYPHS`, no key; a custom style is allowed as our own JSON; read
from its TileJSON, Positron style and quick start on 2026-10-30 through a page
reader, since this container can't reach it). `cmStyle(v, dark, geo)` builds
the style from the hole maps' `--hm-*` tokens (`v` = `cmVar`): parchment
background with a hatch texture, wood, parks and grass stippled, sand, golf
courses (`landcover` subclass `golf_course`) in `--hm-fw` with an ink edge from
z11, water waved with an inked shore, rivers from z10, roads as thin ink lines
(motorway/trunk from z8, primary/secondary z11, tertiary z13, nothing smaller),
place names only (city to z11, suburbs from z12, Noto Sans, upper case), the
pins (`cm-courses`, a GeoJSON source from `cmGeo()`) on top; no buildings,
boundaries, airports, POIs or road names. The textures (`cmPattern`: hatch,
stipple, wave, drawn on a canvas in the theme's colours at 2x) are added the
moment the map is made: a patterned fill drawn before its image arrives stays
blank on that tile, and a background never asks (`styleimagemissing` came too
late; found in Chromium). Another theme makes the map again where it was
(`cmGlSync`), so its textures are there first; new courses or home go in as
data (`setData`, a `Marker` for home). Pins open `cmPopup` in a MapLibre popup
(themed in CSS) with its own handler for *Open course*. No WebGL
(`cmWebGL()`), or MapLibre failing to load or start: the Leaflet map over
OSM's tiles above, unchanged. Checked in Chromium with WebGL (SwiftShader)
against hand-made OpenMapTiles-shaped tiles (geojson-vt + vt-pbf in the
scratchpad, Playwright standing in for OpenFreeMap): the hatching, waves,
shore, golf fill, roads, pins and the popup, light and dark, 390px, no
sideways scroll; the sample's polygons dropped at some zooms (an artefact of
the sample tool, not the style), so the real tiles on his phone are the test.
`ui-coursemap-gl` checks the style as data and drives the map code against a
stand-in MapLibre; `ui-coursemap` still covers the Leaflet fallback.

**Course pictures** (2.47.0, the hole-maps chat's note after its 2.46.0
`icons.json`): each list row is a `.crow` with `courseIcon(c)` at the left,
`HoleMap.iconTile(id, name, {size: 56})`: the map's picture when the course has
a map link (`c.map.id`), else its initials in the same tile (also while
`icons.json` loads, or for an id it doesn't have). `vCourses` calls
`HoleMap.icons()` to start the file; its arrival fires `onLoad('__icons')`,
which `mapArrived` already redraws on. The tile's colours are the `--hmi-*`
tokens holemap.js injects, light and dark. Checked at 390px both modes: no
sideways scroll. `ui-courseicons` against the real `icons.json`. A larger one
at the top of a course page was offered as optional; not built.

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
- **Team rounds don't score** (2.15.0, after a Lane Cove Ambrose counted as a
  nine seven strokes better than his own): `round.format` (`ambrose`,
  `bestball`, `team`; absent = solo). `isSolo`/`soloRounds()` gate the
  handicap (listed in `#hcpLeft` with the reason), Current form, the trend,
  `shotRecords`, putting, penalties, `courseDemand`, `holePlays` and the
  basis line; the round lists and *Rounds here* keep it, labelled.
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
  Flagged now: Bardwell 11 (28 m from any box), The Coast 18 (17 m), Hurstville 18 (38 m); Bexley none. Randwick
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
  green or tee shapes. Each green is **estimated**: a 12 m circle on the
  hole's pin (within 30 m of the line's end, else the end), `est: true`, drawn
  dashed as "Estimated green (not mapped)". It never sets a lie (a tap there is
  `null`, he picks) and gives no front/back distance, only the middle.
  **OSM numbers its holes from the old start** (2.8.0): its 10–18 are the
  course's 1–9 today, and its 1–9 the 10–18, so the source has `renumber`
  (OSM ref → hole). Played on 2026-10-21 with OSM's numbers, every hole showed
  a different hole. Found from his GPS app's blue card: front nine 260, 134,
  132, 342, 288, 538, 112, 382, 148 against OSM 10–18's 264, 134, 132, 340,
  286, 534, 110, 370, 151, the dogleg on 8 included; back nine 296, 117,
  434, 162, 290, 376, 486, 496, 285 against OSM 1–9's 289, 116, 428, 160,
  279, 372, 479, 491, 323 (par 70, 5,278 m blue). The card is in the source;
  17 tees are on a mapped tee point (≤ 12 m). Flagged: 18, whose blue tee is
  38 m ahead of OSM's. (A first reading took the lines for an old par 70
  layout and 2.8.0's first draft went marks only; the card settled it.) The
  origin and every shape are unchanged, so shots logged on the old numbering
  re-measure on the right hole.
  A mapped tee *point* (`teept`) counts as a tee box for the card check.
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
  Hunter Valley (2.16.0): an export of 2026-10-25 (`aa81a27f`, the first
  since 2026-09-27; overpass-api.de resets from this container and the
  mirrors serve May/July data, so he ran it in overpass turbo) has all 18
  hole lines, remapped since September (way/1544913558–75), with a tee
  point and a pin each but no greens. The course is still OSM's unnamed,
  partial boundary at Lovedale (way/675566513, 39 ha), and 7 and 9 run 11%
  and 15% outside it, so the source sets `minInside: 0.8` (default 0.9, the
  guard against a neighbour's holes; there's none here). No card in the
  source: the course page checks the NAS card. Greens are estimated on the
  pins, as at Hurstville. **Artwork onto the map** (2.17.1):
  `HoleMap.fromArt(hm, art, [x, y])` → `[mx, my]` or `null`. It reads a tap
  as distance along the artwork's tee → (turn) → green path and offset to
  one side (image y flipped, so left is left), scales both by the play
  line's length over the path's (the card, for the tee played), and lays
  them along `hm.pl`; behind the tee and past the green it carries on
  straight. Approximate: the artwork is hand-drawn. For the Carry chat's
  one-off conversion of the 13 Sep Hunter Valley round, which stores the
  result as `mx/my` with the original kept and `approx: true`.
  An estimated green is now never reused by another
  hole: 9 and 18 end 28 m apart, and 18 had taken 9's (only a *mapped* green
  can be shared). Its one artwork round (13 Sep) was moved onto the map on
  2026-10-25 through the Carry chat's 2.17.0 (see *Artwork → map*); he found
  it good enough, approximate as expected.
  The same export added trees and bush at Barnwell Park, Beverley Park and
  Lane Cove (still no hole lines there); origins and boundaries unchanged.
  Bexley (2.21.0, tier A, the most complete yet): OSM has 18 hole lines whose
  pars match `imports/bexley.json` hole for hole (par 64), 20 greens, 35 tee
  boxes, 19 fairways, 22 bunkers, 3 water hazards; no estimates needed.
  Data from overpass.private.coffee, dated 2026-07-15 (overpass-api.de still
  resets from the container; this session's container had lost the September
  uploads), converted from Overpass JSON to GeoJSON with a small script in
  the scratchpad, not the repo. The blue card is in the source; every blue,
  white and red tee lands on a mapped box, nothing flagged (lines 0–14 m
  shorter than the blue card).
  **Tier A batch** (2.28.0, 27 courses): every Sydney course OSM has fully
  mapped (all hole lines, greens mapped) and Carry hadn't, from his overpass
  turbo export of 2026-10-28 (`344015ef`, fresh; the reachable mirrors had
  stopped answering). Found by tiering all 109 courses in greater Sydney
  (scratchpad export, mirror data of 2026-06-01: A 32, A- 10, B 3, B- 4,
  C 19, D 41). Every hole ends on a mapped green; no cards in the sources,
  so each is checked live against the NAS card once the course exists. The
  build now reads a ref's **first number** ("Hole 13", "1;17", "1/10"), and
  skips hole lines listed in the source's `ignore`. Manly: two alternative
  14ths ("14a" 299 m, "14b" 376 m) ignored until a card says which, and 1
  and 17 share a green (OSM's "1;17"). Woollahra: 9 holes played twice
  (1/10 … 9/18), two stray lines 11 and 12 ignored. Moore Park: OSM already
  has the interim course, 1–10 inside the new boundary (the old 11–18 fall
  outside it); against `imports/moore-park.json` blue 3 (382 vs 319 m) and 7
  (190 vs 122) are flagged, red 4 too. No mapped tee box at Stonecutters
  Ridge and Strathfield (every hole), Bonnie Doon 13–14, Georges River 10
  and 16, Lynwood 15. Map names are OSM's, less "(private)". The queue he
  set after this: A- (8), B and B- (7), C (17, marks with flags snapping to
  mapped greens), D (about 30), then a Melbourne tiering.
  **A- batch** (2.30.0, 7 courses): his export of 2026-10-28 (`ebf649b3`).
  Avondale, Brighton Lakes, Kogarah, Mona Vale, NSW, St Michael's, The Lakes,
  18 holes each, every green mapped. Fresher than the tiering's mirror data:
  Brighton Lakes is now one 18-hole relation (the tiering had an 11 and a 7
  on two ways), so one map. Avondale's outline is tagged `golf=tee` in OSM;
  it is the boundary. NSW 5 and 6 (the cliff-top tees, 84% and 30% inside)
  and The Lakes 14 (79%) run past OSM's boundary, so `minInside` is 0.25 and
  0.75 there; every neighbour's line is wholly outside. Kogarah has 15 lines,
  three played twice ("1/16", "2/17", "10/18"): the source's **`share`**
  gives 16, 17 and 18 the line and green of 1, 2 and 10, and `forHole` lends
  them that hole's shapes (`lent`, cached on the map), so the fairway,
  hazards and legend are theirs; the file keeps the shapes on the first
  hole. No mapped tee box: The Lakes 7.
  **B batch** (2.31.0, 7 courses, `ff675c61`): `holes: "osm"` with whatever
  lines OSM has; the rest come from marks (`forHole` builds a hole from marks
  wherever the file has no line, so this needs nothing new). Everglades 18
  lines and Macarthur Grange 1–9 (an 18-hole course), pins but no greens or
  tees: every green estimated, as at Hurstville. Monash: a 2026 remap of 2–18
  (way/1459187880–96) plus older 1, 2 and 8; the older 1 joins the remap, the
  older 2 and 8 are in `ignore`. Chatswood: 1, 2, 4–8, 11, 12 (OSM's numbers,
  no card to settle 11 and 12 against); Cammeray 1–5, 7, 8; Eastlake and Ryde
  Parramatta one line each, but most shapes mapped (40 and 22 greens): they
  are the first that the C batch's flag-snapping would improve. The generic
  map test exempts sources whose `why` starts "Tier B" from 1..N and mapped
  greens; their own test lists each course's holes.
  **C batch** (2.31.0 with the B batch, 16 courses, `978ae857`, fresher than the tiering's
  June mirror data): Bayview, Gordon, Liverpool, Muirfield, North Turramurra
  and Pennant Hills now have all 18 lines in OSM (`holes: "osm"`; greens
  estimated on pins where unmapped: most of Bayview and Muirfield, Gordon 7
  and 18, Liverpool 9). The other ten are `holes: "marks"` over their mapped
  shapes: Cabramatta, Castle Cove, Cronulla (almost nothing mapped), Leonay,
  Macquarie Links (18 lines but no numbers: numbering them would be a guess),
  Marrickville, North Ryde, Roseville, Wakehurst, Warringah. **Flags snap to
  mapped greens** (`snapGreen`, `MARK_SNAP` 10 m): on a hole with no line,
  a flag mean on a mapped green or within 10 m of its edge takes that green
  (line to its middle, the green owned by the hole in the built map,
  `fromMarks.snapped`), so a green lie and front/back; otherwise the dashed
  estimate as before. Bunkers and water stay unowned (faded, and not in Play's
  hazards ahead) on marks holes. Left out of C: Bardwell (mapped), Thornleigh
  (a range), Concord (D).
  **D batch** (2.31.0 too, 30 courses, `e46bab2f`, with the Campbelltown/
  Camden area the first tiering never fetched): Antill Park, Boomerang,
  Camden, Campbelltown, Canterbury (9), Carnarvon, Castle Hill, Cromer,
  Cumberland, Kareela, Killara and Woolooware now have every line
  (Woolooware 5 is 84% inside the outline: `minInside` 0.8, Cronulla next
  door has no lines). The other 18, Concord included, are `holes: "marks"`
  outlines with whatever shapes OSM has (Hawkesbury Waters and Kingdom
  Estate: none). Left out: a second "Lakeside Golf Club Camden" outline
  (way/721778478), 1.3 km from the mapped course, a quarter its size and
  tagged like a road; Riverlands (closed), Dural and Helensburgh (ranges),
  Pittwater Golf Centre, two unnamed outlines, "Stirling Drive". The area
  sweep found no other course. **The queue left:** a Melbourne tiering.
  **Chatswood** (2.43.2): rebuilt by the club as Newgreens Chatswood, 12
  holes, reopened May 2026 (the Carry chat's `imports/chatswood.json`, par
  44, 2,871 m). OSM still has the old 18-hole layout (pars differ on 4, 8,
  11), so the source is `holes: "marks"` with **`shapes: false`**: the
  outline and origin only, no old greens or bunkers setting lies. Rebuild
  from OSM when it has the new holes. **Pairing from the card** (asked
  2026-10-30, to do course by course as he plays them, not as a sweep):
  where OSM has greens and tees but no hole lines, a hole can be paired with
  its tee box and green from the routing and the card's lengths and added
  as a hand mapping (`holes: {...}` or `addHoles`), shown on a contact
  sheet and confirmed by him before it is committed, as The Coast's 4 and
  14 were. Worth it at Eastlake, Ryde Parramatta, Cabramatta, North Ryde,
  Wakehurst, Warringah, Macquarie Links (18 unnumbered lines), Leonay,
  Marrickville, Roseville; Manly's 14 needs only the card's length.
  **Not Eastlake** (checked 2026-10-30): its outline (47 ha, a 2 km crescent)
  holds 46 bunkers and ~130 trees but only 4 greens, 1 tee and 1 fairway; the
  37 greens near it are The Lakes' and Bonnie Doon's. OSM is thin there, so
  its holes come from marks.
  **Course icons** (2.46.0, he asked for covers on the Courses list; a preview
  of 12 at 56 px, light and dark, chose the plain level): the build writes
  `icons.json`, the whole course north up in a 100-unit square (outline,
  fairways and tees, water, greens as dots, estimated greens hollow; trees and
  bunkers left out as speckle at that size), clipped to the outline so a
  neighbour's shapes stay out, simplified (`ICON_TOL` 0.8 units) to about 1.2
  KB a course (120 KB for 100, 44 KB compressed; the test holds it under 1.6
  KB). `HoleMap.icon` / `iconTile` draw it (`--hmi-*`, a step lighter in dark
  mode than the map's own greens, which sank into the tile), with the course's
  initials where there is no map. The Courses list drawing them is the Carry
  chat's (`index.html`).

## The course batch (2026-10-28)

The hole-maps chat's note of 2026-10-28 listed 87 new maps (its tier A, A-,
B, C and D batches). `imports/` now holds a card for 77 of them (`c_<map id>`,
underscored; `c_st_michaels`), built by a scratchpad script from each
source's card table, the map's name from `web/course-maps/index.json` and
its location from the map source's `origin`. Rules kept, so a number is
never invented:

- **Sources, in order of trust:** Golfify (metres, every tee, the stroke
  index; 64 courses), then TheGrint (Lakeside Camden, The Ridge: its cells
  concatenate yards and metres, `369337` = 369 yd / 337 m, read apart; its
  printed totals are yard sums converted and differ by 1–2 m from the
  holes, noted), Hole19 (Glenmore, Avalon, Sefton, Woodville: a text page,
  not a table, one tee set), BlueGolf (Castle Cove: labelled yards but in
  metres, proven against 18Birdies' yards for the same holes). Hole19 was
  the cross-check until it started refusing automated reads: Asquith agrees
  hole for hole; Terrey Hills agrees on par and metres but not the index;
  Castle Hill shows a different card (not reconciled); each file's notes say
  which. Golfify's own ratings are **noted, never stored**, as for Bexley.
- **Primary tee:** the first men's set the source lists; the file says so.
  Golfify names Bankstown's five sets only "Men's"/"Ladies", so they are
  keyed by total (`men 5855`) and its first men's column (a different hole
  order) is left out; Bayview's black and The Lakes' "Blue (T)" are other
  routings, left out; Cromer's blue and Cronulla's ladies' columns are
  300 m on every hole (placeholders), dropped. Camden's white is the rated
  set and hole 9 changes par between tees. A nine's 18-hole index
  (Avalon, Canterbury: odd numbers only) is not stored.
- **No import, with the reason in the test's `NO_CARD` list:** Brighton
  Lakes, Hawkesbury Waters, Kurrajong Hills, Orchard Hills (no readable card
  anywhere), Del Rio (par 29, no card published), Kingdom Estate (listed,
  no card; the club domain is for sale), Fairfield City (18Birdies' card has
  a 937 m hole 2), Shortees and Sylvania Par 3 (cards whose unit can't be
  told). Auburn is Golfify's "Rosnay Golf Club"; Liverpool its "Oak Point".
- Only address, phone and fees are missing against Bexley's fuller record:
  77 clubs' sites weren't visited. The in-app course page's live card check
  against each map is the next test of these numbers; a flagged hole is a
  reason to look at the club's own card.

**Newgreens Chatswood** (2026-10-30, he asked): Chatswood Golf Club was
rebuilt on its own ground as Newgreens Chatswood, 12 holes, reopened May 2026
(an alliance between the club, Pariter and Watermark Living). Not a closed
course plus a new one: `imports/chatswood.json` keeps `c_chatswood` and now
holds the club's March 2026 card (par 44, 2,871 m, one distance column the
card names no colour for, so the tee is `standard`; index 1–12), the MiClub
calendar its *Book a round* button uses (`chatswood.miclub.com.au`, 3000000,
read by tee times), and its visitor fees ($49 Mon–Thu, $59 weekends; twilight
and others in `bookingNote`). Rating: the club says TBC, none stored. The map
file `chatswood` is OSM's old 18-hole layout under its old name;
`imports.test.js` lists the course in `RENAMED` so the name check and the
18-hole check pass, until the hole-maps chat rebuilds the map.

## Artwork → map (2.17.0)

Hunter Valley's rounds were traced on uploaded artwork (holes 1–9) before
OSM had its holes; the hole-maps chat's 2.15.0 map gave it lines. The
conversion is the Carry chat's (it rewrites round documents; the map is
only read through `HoleMap.forHole`). On the course page, `artConvertSection`
lists rounds with holes still on art that the map can draw
(`artRoundsToConvert`: `h.art && h.hm`, every shot `x != null`); *Move them
onto the map* asks, then `artShotToMap` moves each shot: its fraction along
the artwork's tee→(turn)→green line and its offset to the right of travel
(`alongLine`, y down in pixels) become the same fraction along the drawn
hole line `hm.pl` (after the tee rule, so the card's length) and the same
offset in metres (`atFraction`, y up), scaled by `metresPerPx` as artwork
distances always were. The shot becomes `{mx, my, approx: true, art: {x, y}}`
(the hole-maps chat's shape): the pixels are kept, nothing derived is
stored, the lie stays as recorded (Hunter Valley's greens are estimated,
so the map wouldn't give one), and `approx` keeps it out of calibration
(`shotRecords().full` is false for it and for the shot after it) with
"approx." on the shot list and the dot details. The geometry is
`HoleMap.fromArt(hm, art, [x, y])` (hole-maps 2.17.1; the app's own copy
from 2.17.0 went in 2.18.0). Frames never mix: a hole moves whole or not at all. `ui-artconvert`
checks a straight hole and a dogleg by hand and the real Hunter Valley file
end to end. The artwork stays on the course record; unused once every
round there has moved.

## Play mode (2.1.0)

Asked for 2026-10-19 ("built with GPS from the start"): logging during the
round instead of afterwards from 18Birdies. Rounds → *Play* (*Start round* before 2.50.0)
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
  service worker until 2.54.0, so a closed app couldn't reopen without signal (see
  *Opening without signal*).
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
- **Marking the ball on a hole not drawn yet** (2.10.0, asked before his
  first Lane Cove round): where the course has a map file but this hole has
  no line yet (marks-only courses on a first visit, `undrawn(h)`), *Mark my
  ball here* still saves `{mx, my, club, gps}` from the file's fixed origin
  (`playMap()`), no distances shown and no lie guessed (he picks). Those
  shots are not measurable (`spot` needs the hole) until his tee and flag
  marks draw it, then measured from his real tee, nothing stored. This
  replaces the Course maps section's "first visit shots go on the outline".
  The hole logger now refuses an outline or artwork tap on a hole holding
  map shots it can't place (also the case after unlinking a map), so frames
  never mix. A course with no map file is unchanged.
- **Not measured on a real course yet.** Distances are checked against
  hand-worked geometry and the globe (haversine) in `ui-play`, but phone GPS
  under trees and how a phone browser treats Cloudflare's offline errors
  are the first round's test.

## Rounds from screenshots (2.48.0)

He had 31 past rounds in 18Birdies (2026-10-30) and sent two of its summary
screens: date (DD/MM/YYYY), club and course name, course par, tee (sometimes
with its length), a score per hole with each nine's total, gross/net, and other
players below (only his own scores are on the summary). No per-hole par, putts
or fairways there; those are on its full scorecard. So: Rounds → *Add past rounds
from screenshots* (`#roundsFromImages`, `ACTIONS.roundsFromImages`; since 2.50.0 a choice
in the *Add past round* sheet, `#addPastRound`), built like
*Range data from screenshots*, up to `ROUND_IMAGES_MAX` (60).

- **One reading per screenshot** (`readRoundImages`, `ROUND_READ_PARALLEL` 3 at a
  time, "Read n of N"), `roundImagePrompt()`: kind (summary, scorecard, other),
  date as shown, club, course, tee, course par, gross, row totals, player,
  holes (score, and putts/par only where labelled); the first golfer's row only;
  nothing added up or filled in.
- **Cleaning** (`normaliseRoundRead`, no I/O): the date day-first (`roundDateFrom`;
  14/05 proves 18Birdies on his phone is day-first) or ISO, else null and said;
  a future date warned; scores 1–15, else left out and said; the holes against
  the screen's gross and each row total; the course by name (`matchCourse`:
  `plainName` of the club, the course or both against Carry's, exact first,
  else one unique containing match), the tee against the card's (`teeOn`,
  case ignored, else the primary and said), the screen's course par and per-hole
  par against the card's, holes the card lacks.
- **Joining** (`mergeRoundReads`): a scorecard for the same day and matched
  course joins that round (its putts; a score differing between the two is
  warned); otherwise it is a round of its own. "Other" screens and failed
  readings are named under *Left out*. A round Carry already has for that course
  and day (`dupe`) comes unticked; two in the batch alike are warned.
- **Review** (`openRoundReview`): per round the screenshots, course select, date,
  tee, scores as one line per nine (`scoreLines`/`parseScoreLines`: `1-9: 5 5 3
  …`, a dash for a hole not played; a wrong count is refused, never guessed),
  putts when read, a live line (holes, strokes, the screen's total, to par on
  Carry's card), warnings.
- **Saved** as `score_only` rounds whose holes are `holesForTee(c, tee)` (pars
  and metres from Carry's card, never the screenshot) with `strokes` and
  `putts`, and `fromImages` (SCHEMA.md); the round page shows them
  (`roundSourceSection`, `#roundSource`). `sessionAssets` and the import's
  remap now carry a round's `fromImages`, so export, import and delete keep
  the screenshots with it.
- **Not yet run against Claude on his screenshots**: `ui-rounds-images` stubs
  the reply, hand-made from his two screens (Lane Cove 46 over 9, Bexley 123
  with 63/60). The first real batch is the test; a misread shows in review.

## Swing history (2.23.0)

Asked for 2026-10-28 ("a tab specifically for swings showcasing a timeline
/ history… flagging if it was course/range and the date… a synthesised
summary output from the analysis"). Not a fifth tab (2.13.0's four tabs
and a gear stand): a page under Range, `vSwings` (`S.sub.view ===
'swings'`), linked from the Range list above the sessions ("Swing history:
n swings →", only when there are any), the way the penalty report sits
under Rounds. `swingHistory()` is `allSwings()` newest first (session
date, then `addedOn`); `swingWhere` flags `course` (the round's
`courseName`) or `range` (the session's `venue`); `swingFrame` is the
middle stored frame as the thumbnail; each row opens the session or round.
`swingClubSummary(club, swings)`: count, views, first and last date, the
readings' `one_thing` in date order with `ball_data` agreement, the latest
reading's `wrist`, how many agreed and contradicted, and the distinct
`cannot_tell` lines (merged as in `readingBlindSpots`). One line of
judgement per club: the same fix every time "has not been cleared yet"; a
changed fix is "either the swing moved on, or the readings disagree; the
ball data decides". No new reading is made; the page says so. Folds per
club are `swc_<code>`, in bag order (`clubOrder`). `ui-swings` works a
hand-made set: two 7i readings months apart with different fixes, an
unread 5W swing on a round, and the empty state.

**Themes, not the list** (2.33.0, he found reading-by-reading redundant and
asked for trends and progression): `SWING_THEMES` files each fix under the
first theme whose words it uses (wrist, clubface, head and posture, swing
path, setup and grip, tempo, hands and arms, body turn; else other),
specific ones first. `swingThemes(fixes)` counts per theme with first/last
date, ball-data agreement, `latest`, `newest` (first seen in the latest
reading) and `recurring` (2+ over more than 60 days); `swingProgression`
lists each period's themes (years when they span years, else months);
`swingPattern(c)` writes the line: the top theme and whether the latest is
in it, a theme new in the latest reading, themes not seen for 60+ days, and
themes the ball data contradicted as often as agreed. All from the readings'
wording, derived on every draw, nothing stored; the cross-reading stays the
real read across them. The timeline's rows open the swing's card
(`reelCard`), as the feed's caption does, with one link on to the session.
*▶ Watch* (`#reelsOpen`, 2.50.0; was *Watch: n videos*; the count stays in its `aria-label`) sits beside the heading in a `.spread`
(2.45.0, he asked), as Range's, Rounds' and Courses' buttons do.

**A reading across the readings** (2.24.0, he asked for the cross-reading
button): `crossSection(club)` on the club's fold, `crossRead(club)` →
`crossPrompt` (the club's readings as text, oldest first: fix, why, feel,
drill, check, ball-data verdict, wrist, observations, can't-tell, his note,
where filmed; plus `ballContextFor(club)` and the swing-history
background) → `sample.json` with **no images** → word-limited JSON
(`thread`, `moved_on`, `still_there`, `carry_forward`, `confidence`,
`caveat`), clamped on the way in, stored on the club as `crossReading`
with `on` and the `swings` it was read from (SCHEMA.md). Needs `CROSS_MIN`
(2) readings; never made on its own; the card says "a reading of readings,
not a measurement" and counts newer readings since, which makes the
button primary again. `saveClub` now spreads the existing club so the bag
form keeps it (it used to rebuild the document from the fields alone).
`ui-swings` stubs `/api/analyse`: the prompt's contents, no frames sent,
stored and shown, stale after a third reading, a bad reply stores nothing,
the bag form keeps it.

**The feed** (2.25.0, "scroll through the swing videos the same way
Instagram reels works"): `vReels` (`S.sub.view === 'reels'`, optional
`club`), *Watch* on Swing history when any swing has a video. `#reels` is a
fixed, full-screen, black `scroll-snap-type: y mandatory` container above
the tab bar (`z-index: 8`); each `.reel` is `height: 100%`, snap-aligned,
`<video playsinline muted loop>` with `preload` auto for the first two and
none after; the overlay (`.reelInfo`, a `data-go` button) carries the
date, range/course tag, club, angle, note and the reading's `one_thing`,
and "n of N · swipe up" (`.count`). `reelsLifecycle()` runs after every
render like `playLifecycle`: an `IntersectionObserver` on the container
(threshold 0.6) plays the video on screen, pauses the rest and sets the
neighbours' `preload` to auto, so a swipe through ten clips loads tens of
MB, not hundreds; it disconnects when the view goes. Only swings with a
stored video appear, so `VIDEO_MAX` went from 20 to 60 MB (a 15 s
slow-motion clip is about 21 MB). Chips at the top filter by club
(`reelSwings(club)`). Checked in Chromium with a real h264 clip: on open
only the first plays; after scrolling to the third, the first pauses, the
third plays and its neighbour preloads. `ui-swings` drives it with a
stand-in observer (jsdom has none): the rows, order, preload, attributes,
the fix, play/pause on the callback, the club filter, the empty state,
close. **Sound** (2.26.0): the videos start muted so they can autoplay; the
`.reelsSound` button (`reelsSound` action) unmutes them all on the tap iOS
needs, the one on screen being the only one playing, and the flag resets
when the feed closes. **The caption opens the card** (2.26.0, he asked: the
session page was too much): `reelCard` opens a sheet (`reelCardHtml`: date,
where, view, note, `swingReading` or "not read yet") over the feed, and
`reelOpen` closes it and goes to the session or round. **The bar is fixed**
(2.27.0): as a zero-height sticky item its chips overflowed above the
scroll box and were clipped on his phone; now `position: fixed` over the
feed with the safe-area padding, the video centred (even letterbox, no
padding under the chips), and the sound button is an inline SVG
(`soundIcon(on)`), not an emoji. **2.27.2** (he asked): no club chips (`club` in
the link still narrows `reelSwings`); the bar is just a back chevron,
white with a dark drop-shadow edge, no disc; each reel has its own
`.reelsSound` in `.reelBottom` above `.reelInfo` (the toggle updates them
all). **A sheet's bottom strip** (`.sheet-actions`): the row is sticky at
the scrollport's bottom, so it carries the sheet's bottom padding; with the
padding on `.inner`, content scrolled past under Close in that strip (seen
on the feed's card; every sheet had it). **Under the status bar, over the tab bar** (2.29.0, he
asked for Instagram's layout): `apple-mobile-web-app-status-bar-style` is
`black-translucent`, so the page runs under the status bar everywhere; a
fixed `body::before` strip of paper, `env(safe-area-inset-top)` tall, sits
behind the clock on every page and hides under `body.reels` (set by
`reelsLifecycle`), which also hides `.top` and makes `nav.tabs`
translucent with a backdrop blur. `.reels` is `z-index: 4`, under the bar
(5); the caption's bottom padding clears `--nav-h + --safe-b`. Each reel
has a `.reelBg`: the swing's middle frame (`swingFrame`) blurred and
darkened behind the clip, so a clip that doesn't fill the screen has no
black bars; a still, not a second decoding video, so a phone plays one
clip at a time as before. The backdrop is scaled 1.2 to hide its soft edges, so
`.reel` is `overflow: hidden` and `.reels` `overflow-x: hidden` (2.30.1):
unclipped, it widened the feed and his phone scrolled it sideways. **The
status-bar style is read when the app is added to the home screen**: an
installed Carry keeps its opaque bar until it is removed and added again;
the served page has the tag. The caption's gradient must stop at the bar
(2.30.2): `.reelBottom` carries the `--nav-h + --safe-b` padding and
`.reelInfo` only its own, or the bar sits on near-black and reads as a
solid band; the bar is 55% paper in the feed. **The document is pinned under the feed** (2.30.3,
`body.reels { position: fixed; inset: 0 }` and a `scrollTo(0, 0)`): with the
page under the status bar, the root's safe-area padding let the document
scroll by about the two insets, and his phone showed the whole view ~90px
high with bare screen under the bar. That pin changed nothing (2.30.3 on his phone): the
gap measured the status bar's height, which is iOS's own fault with
`black-translucent` in a home-screen app: it shifts the web view up under
the status bar without lengthening it. **So the meta tag is gone (2.31.1)**
and the feed starts below the status bar; the `body::before` strip and
`body.reels` pin are harmless and stay. The only known way to a filled top
is a document that never scrolls (`html, body { overflow: hidden }` with
`main` as the scroller), untried and not testable here; the status-bar
style is read at install, so any change means removing and re-adding the
app. **The tab bar is plain in the feed** (2.31.3, he asked: the same as
everywhere, not translucent): `.reels` ends at `--nav-h + --safe-b`, the
caption carries no bar padding, and the translucent rule is gone. **Tap to toggle sound, a progress bar** (2.32.0, he
asked): a click on `video[data-reel]` (delegated on `#reels` in
`reelsLifecycle`) runs `reelsSound` and `reelFlash` shows `soundIcon` in a
centred disc (`.reelFlash.show`, 700 ms); no corner button. `.reelBar`
under the caption: `reelProgress` on `timeupdate` sets `.reelFill`'s width
and `aria-valuenow`; pointer down/move on the bar seeks (`reelSeek(v,
frac)`, pointer capture, `touch-action: none` so a drag never becomes a
swipe). The "n of N · swipe up" `.count` line is gone. Checked in Chromium
with a real clip: a tap unmutes all and flashes, a pointer at half the bar
seeks to 1.08 of 2 s. **Flush and smooth** (2.32.1, he sent two screenshots of
a gap between caption, bar and tab bar, and found the slide clunky and
per-second): `.reelBar` is the 2px track itself with no padding and an
invisible 28px `::before` strip as the touch target, the caption's bottom
padding is 6px, and the fill is driven by `requestAnimationFrame` while the
clip plays (`timeupdate` fires about 4 Hz, which read as steps). A drag paints
the fill under the finger at once (`reelFill`) and seeks at most once a frame
(`fastSeek` where the browser has it); `reelProgress` leaves the fill alone
while `data-drag` is set, so the clip can't fight the finger. **A clip left
replays from the start** (2.36.0, he asked): the observer's pause branch winds
`currentTime` to 0 and zeroes the fill, so swiping back plays it from the
beginning rather than where it was.

## Strokes gained (2.35.0)

Asked for 2026-10-29, after the monitor chat's "shots saved" replay of his
Bexley round and the choice between the two: strokes gained with a
handicap-level baseline, read-only (he decided: nearest-handicap by default,
no effect on the practice list until a future release).

- **The table** (`SG_PGA`): Broadie's PGA Tour baseline (Every Shot Counts,
  2014), yards → expected strokes to hole out for tee, fairway, rough, sand,
  and feet for the green; the fairway column checked against PinFlag's
  published copy (Oct 2026). Linear between rows (`sgInterp`); beyond a
  column's last row the last row holds (sand stops at 200 yd, rough 320,
  fairway 300: the limits I could vouch for). Trees are the recovery lie:
  rough + 0.5. Water and unknown read as rough (the next shot is from a drop).
- **The level** (`sgLevel`): `settings.sgLevel` pinned in Settings
  (`sgPicker`, `setSgLevel`), else the `SG_LEVELS` entry nearest
  `handicap().index`, else 20. The handicap allowance is PinFlag's written-out
  model, not a measured amateur table: a level-H golfer uses H + 1 strokes
  more than the table's 71, split 65% over 14 long shots (tee, or 100 yards
  out: compared in metres, `>= 91.44`, because 91.44 × 1.09361 lands a hair
  under 100), 20% over 7 short shots, 15% over 30 putts, each a constant per
  shot (`SG_SPLIT`). Measured amateur tables (Shot Scope's) weren't published
  in a form I could cite; swap the model for one when there is.
- **The arithmetic** (`sgHole`, `sgRound`): per traced shot from
  `shotRecords`, `B(start) − B(end) − 1 − penalty`; the last shot ends on the
  green at `firstPutt`, and putting is `B(green, firstPutt) − putts`. No
  first-putt distance: the last shot and the putts are pooled on the shot and
  the hole counted `pooled`. Hole-counter penalties are their own row (`pen`).
  So a hole's rows add to `B(tee, metres) − holeStrokes(h)` exactly, which the
  test checks. A hole needs every shot placeable (its records match its
  shots) and `putts`; otherwise it is in `left`, named on the fold, never
  treated as clean. Categories by the record's `kind` (tee, approach, short,
  recovery) with a bunker start as sand; a par 3's tee shot is an approach.
- **Where:** the round page (`strokesGainedSection`, fold `#strokesGained`
  under *Getting to the green*: the two biggest losses as the teaser, a
  category table worst first, the left-out holes, the limits); the Overview's
  detail (`strokesGainedRecent`, fold `#ovStrokesGained`: per 18 over rounds
  traced on every scored hole, weighted `0.5^(age / PRACTICE_HALF_LIFE)`,
  `SG_MIN_ROUNDS` 3 or it says how many); a practice card (`sgPhrase`, kinds
  tee/approach/short/putting, only when the recent figure is a loss).
- **Honesty:** every fold says it is an estimate against a handicap level, in one
  line since 2.58.0 (`sgLimits`; he found the paragraph of caveats too much):
  distances to the green's middle, lies as recorded, not the Tour's number, not a
  prediction, nothing stored and nothing changed about the plan or the armed club
  all still hold, and are said here rather than on the page. `ui-sg` works a 300-yard par 4 at scratch by hand
  (−0.09 tee, +0.22 approach, −0.37 putting), a par 3 with a shot penalty and
  no first putt (pooled), the level rules, the fold, and that nothing lands
  on the documents.

## Getting to the green (2.22.0)

Asked for 2026-10-28, from the Moore Park scorecard ("a drop down tab
underneath to elaborate on the number of chip shots, sand shots and
putts… a better narrative on the final score"). `toGreenSection(r)`, the
fold `#toGreen` right under the scorecard: a table per scored hole (Long,
Chips, Sand, Putts, Pen. when any, Score), a total row, and `#toGreenStory`,
one paragraph: strokes, how many got the ball to the green, how many were
spent inside `CHIP_FROM` (60 m), and the long shots per hole by par.
`holeBreakdown(h)`: on a traced hole, from the shots (from a bunker lie →
sand; `i > 0` and `from < 60` → chip; else long: the tee shot and anything
from 60 m out, an unplaceable shot included); `putts` is `h.putts`. On a
scores-only hole, `h.putts`, `h.chips`, `h.sand` are his counts (SCHEMA.md),
tapped under `#toGreenEntry` (chip rows, `setHoleCount`; a traced hole
refuses), and long = strokes − putts − chips − sand − `holePens(h)`, only
once putts are in (`known`); the teaser and story use known holes only.
Penalties are counted apart, never as long shots. `holePens` is now one
global (the practice list's local copy went). Nothing derived is stored.
`ui-togreen` works a hand-made round: a traced hole (2 long, 1 sand, 1
chip, 2 putts), two scores-only holes tapped in, one with a penalty, the
over-count refused, the traced hole refusing taps.

## The practice loop (2.6.0)

Release 2 of his UI/UX review ("Connect the journey"): one named objective
from the course to the range and back, without him recreating it.

- **The objective** is a practice item's `key` (`approach`, `tee:D`,
  `strike:7i`, …); its name (`goalName`) is the item's title before the colon,
  so it doesn't change as the counts do. A planned block stores the keys it
  works on (`goals`); blocks from before 2.6.0, or hit without a plan, match
  by club and swing (`blockGoals`).
- **The card is a coach's note** (2.12.0, he found the list too long): what's
  wrong (title), freshness, what to hit (`.do`: the block and its intent, or
  the practice line), one line for a supporting video (`.sup`, clamped to
  two lines), the before/since line, the buttons. `detail`, `range`,
  `advice`, the hole links and the full video reading live on the objective
  page under *The evidence* (`#goalEvidence`). The approach item's `detail`
  is grouped by club, never one entry per shot.
- **Each objective has a page** (`vGoal`, Range with `sub.goal`): what it is
  now, the drill, *Practise this*, the before/since tiles, the range blocks
  that hit its club and swing ("planned for this" where they were), and where
  it showed up, by round, hole and club. A key no longer on the list says so.
- **Practise this** (`practiseGoal`) adds the item's block to the unhit
  planned session (merging into a block for the same club and swing), or
  plans a new one, focus "Practising: <name>"; never twice. Offered on the
  round page, the Range list, the objective page; *Plan range session* still
  plans from everything.
- **Screenshots fill the plan:** a read block for the same club and swing as
  a planned block becomes that block (id, reason, goals kept), so the session
  header (`sessionGoals`) can say "2 of 3 planned blocks hit" / "Plan done".
- **Before and since** (`goalProgress`): the latest range day its club and
  swing were hit since it first appeared, and the item's own dated chances
  either side of it ("Since the range on 9 Oct: 4 of 9 came up short (44%),
  against 9 of 9 (100%) before · emerging"). Worked out on every draw; the
  page says it describes what happened since, **not that the practice
  caused it**. Items without counted chances (strike, measure) only say when
  they were practised.
- **The round page** (`roundFindingsSection`, a fold `#roundFindingsFold` since 2.58.0,
  with *Clubs on the course* as `#roundClubs` after it, both under *Getting to the green*
  and *Strokes gained*; he asked) lists what that round added evidence to: name, how many times, the clubs, the holes (links), *Practise
  this* and *Details*. Tee findings count only the misses.
- **A block against last time** (`compareBlock`): the latest earlier session
  with the same club, full swing, 5+ shots each side, classified in one pool
  so "low runner" means the same in both.

## Visuals (2.7.0)

Release 3 of the review ("Make the data tangible"); the hole stencil itself
is the hole-maps chat's.

- **Where a club's shots land** (`carrySpread`): on each gapping rung, a
  whisker for 8 in 10 (10th–90th percentile of carry) with a block for the
  middle half (25th–75th), tops left out as for stock carry, from 5 shots;
  the rung's line says "middle half 110–130m" ("at 147m" when they're all
  the same). A plain count, like the strike profile.
- **The round as a scorecard** (`scorecard`): a table per nine (Hole, Par,
  Score coloured as the strips, Putts and Pen. only when logged; Out/In, or
  Tot for a 9-hole card), each hole tappable, a key for the colours.
  **The scorer's marks** (2.34.0, he asked for the traditional notation on
  top of the colours): `scoreClass` returns `under eagle` at two or more
  under; `.sc.under`/`.sq.under` are circles, `.eagle` a second ring by
  `box-shadow`, `b1` a plain square (`border-radius: 0`), `b2` and `b3` a
  double square by the same ring; par plain. The 8px mini strips keep only
  the circle/square shapes (no rings: they don't fit). Checked in Chromium.
  **Reds the right way round** (2.34.1, he asked, then corrected the first
  cut): `--score-2` for a double is the lighter orange-red `--flag` used to
  give, `--score-3` for worse a Ferrari red; the dark maroon is gone. Their
  own tokens, since `--flag` is the app's warning colour everywhere else.
  **His palette** (2.36.0): he sent two sets and left the choice; the softer one
  was taken as the match for the paper-and-sand app: `--score-e` eagle
  #4E9B76, `--score-b` birdie #8DBB9D, `--score-1` bogey #D7B66D, `--score-2`
  double #D88A69, `--score-3` worse #C96A6A, par as it was, the same values in
  dark mode. Dark text on birdie and bogey, white on the rest.
  **One palette through the app** (2.36.1, he asked, with the range cards as
  the example): `--flag` (29 uses: card edges, lost-stroke bars, tags, the
  missing tile, danger buttons, penalty markers) is now the same muted red as
  `--score-3`, `--flag-soft` a tint of it, and `--sand-2` (short-game and
  strike cards, the runner segment, bunker fill) the same sand as `--score-1`,
  both modes. `--green` stays the interface green. `--water` (swing cards)
  and the yellow tee dots on the stencil are markers, not the palette, and
  stay. Light-mode text in `--flag` is about 3.3:1 on paper (the old red was
  4.9): acceptable for the few places it carries small text.
  Unscored holes stay empty and the totals say they count the holes scored.
  The strips stay in lists and course history.
- **Round by round** (`goalHistory`) on a finding's page: a column per
  round (its share of that round's chances, last ten), a line for each range
  day that hit its club and swing since it first appeared, date order,
  tooltips and *As a table*. Single series, no legend; only the latest
  column is labelled.
- **Tap a dot** on a course's hole page (map holes): invisible 11px targets
  laid over the map's dots (`#holeMap .hit`, from `mapToView`; the map
  drawing is untouched) show that shot in `#shotInfo`: date, shot number,
  club, from → length, lie, and a link to that round's hole.

## Range data from screenshots

**The bay's other numbers** (2.51.0, he sent his Trackman Golf shot list and
asked to start on shot patterns): each shot can carry `carrySide`, `totalSide`
(metres, minus left: the screen's "6.2L" is -6.2, `sideOf`), `ballSpeed` (mph),
`clubPath`, `faceAngle` (degrees, the bay's sign), all optional
(`SHOT_EXTRAS`); `speed` stays club speed. Read only from labelled columns,
never worked out from another; a number that can't be one (side over 100 m,
path or face over 30°, ball speed outside 10–220 mph) is left out of that shot
and said. The review shows them in a table (`extrasTable`) with a keep box
(`extras_i`); they ride on the shot whose carry and total they were read with
(`keepExtras`, `matchShots`: equal to 0.1 m, in order, each once), so an edited
carry drops them, and the block form keeps them the same way. **Filling in**:
a read block whose shots are mostly (at least half) a hit block's here, same
club and swing (`fillTarget`), adds only what those shots lack (`fillAdds`,
club speed included) and records `filledFrom` (SCHEMA.md); never a second copy.
The note `[data-fill=i]` says so before saving; unmatched read shots are named
and left out; nothing new means the block is skipped. Trackman has no public
API for the consumer app (checked 2026-10-31: CSV only from TPS on a bay's PC;
unofficial tools use a browser login token), so screenshots stay the way in;
a session share link was asked about, not yet seen. `ui-shot-extras` works his
five 5W shots of 2026-10-31. **Not yet**: the shot patterns screens (mockups:
https://claude.ai/artifact/GsWo9jZatcuJoVnqDeV7gh). He first said to leave them until
later, then (2026-10-31) split the build in two: **stage 1, the range (2.52.0, built)**;
**stage 2, the course** (a hole's page and Play mode: a club's pattern laid along the
hole, "3 of 20" by where they'd finish, water and OB on carry, the rest on total; the
armed club never changes) **on the backlog** (he said so 2026-10-31, after stage 1;
see *Roadmap*).

**Shot patterns, stage 1** (2.52.0): `shotPattern(shots, view)` over `{...shot, prof,
w}`: points are (side, carry) or (total side, total) (`patternPoint`, `view` =
`patternView()`, the per-phone `carry.pattern`, switched by `setPatternView`); tops
(`prof === 'top'`) left out and counted, shots without that side counted (`noSide`);
from **`PATTERN_MIN` = 5** (his rule: he warms up with 5 a club; the draft said 10)
a weighted mean and covariance (`spreadOf`, reliability weights, so equal weights are
the sample covariance), the oval at `PATTERN_K` = √(−2 ln 0.2) (8 in 10 for a round
spread, `patternOval`), and wild misses: past `WILD_K` (99 in 100) Mahalanobis,
refit up to 3 times, never below 5 kept; with under ~11 shots none can be told, by
the maths. `wide`/`deep` are the oval's left-right and short-long extents (2·k·sd),
`lean` the mean side. Shown on the block page (`blockPattern`, `#blockPattern`,
below the stats, one session at equal weight, `comparePattern` against the latest
earlier session's block with a pattern) and on the Overview under Gapping
(`patternsFold`, fold `#ovPatterns`: `clubPattern(code, view)`, memoised, over
`fullShots` with `shotWeight`, so the range filter and recency apply; one
`patternSvg` from the tee, `#patternTable`, `#patternFew` for clubs short of 5).
`patternSvg` draws one scale both ways. **One club at a time** (2.54.0, he found every
club's dots too busy): with no club picked the fold draws only the ovals; a row of
`#patternTable` (`tr.patRow`, `setPatternClub`, Enter or Space too, the per-phone
`carry.patternClub`) shows that club's shots with the other ovals faint (`ghost`),
again clears it; clubs short of 5 are rows too ("3 of 5"), so their dots can be
seen. Nothing stored. `ui-patterns` (11): the
oval by hand, tops, sides missing, total, wild misses, weights, his five 5W shots
on the block page, the switch, the comparison, few shots, the fold with recency,
equal weighting and an excluded session, nothing stored; 13 mutations caught.
**Face, path and strike** (2.53.0, he asked: whether the left miss comes from the
face or the path, and smash as a measured check on the 7i runners): `delivery(shots)`
over `{...shot, prof}`: from `DELIVERY_MIN` (5) shots with both `faceAngle` and
`clubPath`, the means, ranges and SDs, face to path (= face − path; minus is closed,
curving left), and `follows`: Pearson r of carry side with face and with path
(`corr`, 5+ shots with a side), worded `closely` (|r| ≥ 0.7), `partly` (≥ 0.4) or
`hardly`; smash = `ballSpeed / speed` (club speed), from 5 shots, and `smashBy` low
runners against pure strikes when each has 2+ (his own pure strikes, never a
published norm). `deliveryLines` writes the sentences, `deliverySvg` the D-plane
style chart (path across, face up, the diagonal face = path; dots sand when they
finished left, blue right). On the block page (`blockDelivery`, `#blockDelivery`,
after the pattern), on the Overview (`deliveryFold`, `#ovDelivery`, `clubDelivery`
over `fullShots`, so the range filter applies; no recency weighting, these are
plain counts), and in `ballContextFor`, so a swing reading gets the measured face
and path. Right-hander's signs as the bay reports them; every place says a
correlation shows what moved together, not what caused it. `ui-delivery` (7) works
his five 5W shots by hand; 12 mutations caught. **In a golfer's words** (2.58.0, he
asked): `faceLabel` (open/closed to the target) and `pathLabel` (in-to-out/out-to-in)
replace left/right everywhere a face or path is said, for a right-hander as the bay
reports it (face minus = closed, path plus = in-to-out); the chart's axes say the same
and keep *curves left/right*. The Overview's fold (`deliveryFold`) is the table only:
face, path, curve, which one the finish followed (`follows`: the stronger |r|, at least
0.4, else "neither"), smash; clubs short of `DELIVERY_MIN` in `#deliveryFew`. The block
page keeps its sentences.

**The block page's source is folded** (2.51.1, he found the screenshots and
"Read from…" lines wasted the card's room, and the shot patterns will want it):
`fromImages` and `filledFrom` show only inside `#blockSource` (*Source screenshots
· n*, closed, styled like *Shot table*, below it, above Delete). Still stored,
exported and deleted with the block; never shown on the card.

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

`npm test` — 509 tests, about 110s.

- `api.test.js` (27) — the server alone: sign-in (forged key, wrong
  audience or team, expired, alg none, no email, the email header alone,
  cookie, clock skew, keys unreachable, not configured, `DEV_USER`),
  the monitor's door (a service token reads `/api/admin`, a person can't,
  the service token reads nothing else, GET only, unset or REPLACE → 503,
  no owner → health only, a seeded friend invisible in every answer and
  absent from the ring buffer, no query strings),
  whose documents are whose (isolation, shared courses, per-person stamps,
  the course-delete guard, GPS marks surviving other phones' copies and
  refused when rough), assets (uploader-only delete, sign-in for
  files, byte ranges, safe serving), the 1.x migration (refused without an
  owner, converted with a backup, idempotent), import with `--owner`,
  `/api/version`, the stamped page, and `/api/analyse` against a fake
  Anthropic API (`ANTHROPIC_BASE_URL`). `test/access.js` is a stand-in
  Cloudflare: a real RSA key, its certs endpoint, and JWTs signed with it.
- `ui-teetimes.test.js` (12) — the search screen against a stand-in MiClub
  serving Bexley's pages: which courses are asked (near, public, readable),
  a course's rates and time chips linking to the club's timesheet, why a
  course shows nothing and the order, filters working without asking any
  club again (and kept on the phone), distance, another day and *Check
  again*, no home location, today at a fixed 13:30 hiding 13:04, the price
  limit by each time's own fee, one size and two lines, and a day 40 days out.
- `ui-courseteetimes.test.js` (4) — a course page's Tee times fold: no club
  asked until it's opened, today then tomorrow once today's times have gone, a
  day picked staying on the course page, players, a redraw asking nothing new,
  an unreadable course's booking note, no fold for a closed course.
- `teeitup.test.js` (4) — the TeeItUp reader on a hand-made answer (see
  *Tee times*): links, Sydney times, cents, spots, the route asking with the
  alias, unreadable and refused answers keeping a sample.
- `teetimes.test.js` (9) — the MiClub reader against Bexley's real calendar
  and timesheet (`test/fixtures/`), which links are MiClub, the filters, and
  the route against a stand-in MiClub: rates, times, the cache expiring,
  unsupported, unreachable, a bad date, sign-in.
- `versioning.test.js` (7) — the changelog format and its agreement with
  `package.json` and the lockfile, the PR gate, the release notes, and
  that publishing runs the tests first.
- `review.test.js` (8) — the 2.11.1 end-to-end review, each bug reproduced
  before its fix: the round form dropping shot-tied penalties from a traced
  hole's score, the practice list ignoring them, a round's tee matched to the
  card's sets by case, an unrecorded lie counted as a miss, a missing hole on a
  round's grid opening a course edit for the round's id, a course's best
  mixing nines and eighteens, a script-scheme booking link, an unscored round
  shown as 0 +0.
- `regressions.test.js` (8) — the 1.3.1 review fixes, each reproduced
  before it was fixed: local dates, quick taps, render cost with a season
  of data, panels staying open, an old token link leaving the URL, escaping;
  and 2.1.1's page clearing the tab bar.
- `web.test.js` (6) — the real `web/index.html` in jsdom against a live
  server signed in by `DEV_USER`: writes land in SQLite, uploads become
  blobs, polling works.
- `ui-nav.test.js` (10) — back goes where he came from: each way into a round, session, block, finding,
  course, Settings and the feed; hole to hole sideways; a circle; a tab afresh; a deleted page skipped; folds
  restored; deleting returns; the Swings card's Play video and read-only body.
- `ui-trace.test.js` (6) — the hands traced from the video: the smoothing, a stand-in 30 fps clip and model,
  a slow-motion clip, swings measured by the earlier model, repeats and lost stretches, the colours' cuts, an undecodable clip, the overlay on the playing clip and the feed.
- `ui-swingsum.test.js` (5) — the swing card's summary: the four rows from hand-made joints, a tied shot and a
  reading with `ties`, an older reading's hint, the plane's misses, the one picture and either switch off, the prompt
  asking `ties` only with something to tie, the Swings card read-only.
- `ui-tracer.test.js` (7) — the shot tracer: the overlays in the frame's own units (no `vector-effect`), the three taps and the shape, the ball skipped when set and taken
  back, the flight's shape, the tied shot's numbers (course and range), its own switch, the playing clip.
- `ui-plane.test.js` (5) — the swing plane: the V and the hands by hand, a hidden wrist, steep and off-line
  swings, the card, the switch, tapping the ball, impact not caught, plane faults in the practice list, the hands
  under heavy (a hidden wrist from 0.3, two that disagree).
- `ui-bodyfaults.test.js` (3) — the measured body in the practice list: a finding from most recent swings,
  unreliable swings left out, joining a ball finding as support or standing alone, the card, the page, the rules.
- `ui-swingshot.test.js` (6) — a swing tied to the shot it hit: course and range, tags
  following their shot, the prompt, filmed marks, the finding's page.
- `ui-pose.test.js` (17) — the body, measured (the guide and changing the angle since 2.57.0): a stand-in detector with hand-made
  joints, face-on and down-the-line measures by hand, mirrored clips, unsure joints,
  trends, the reading's prompt, a model that can't run, the import.
- `sw.test.js` (9) — opening without signal: the service worker against stand-in
  caches and network (install, activate, the page, data, what is never kept, course
  maps), the server's stamped copy, the status line and the shim's notice.
- `ui-delivery.test.js` (7) — face, path and strike: his five 5W shots by hand,
  smash against his own pure strikes, few shots, the block section, the Overview fold,
  the swing reading's context, nothing stored.
- `ui-patterns.test.js` (10) — shot patterns at the range (see *Range data from
  screenshots*): the oval by hand, tops, wild misses, weights, the block page with his
  five 5W shots, Carry/Total, the comparison, the Overview fold, nothing stored.
- `ui-shot-extras.test.js` (10) — the bay's other numbers: his Trackman screen read
  as signed metres, mph and degrees; yards and implausible numbers; kept on their
  shot through edits; existing shots filled in by carry and total, never added
  twice; re-linked on import; shared screenshots kept until the last block goes.
- `ui-*.test.js` (~100) — the app's own UI suites, rebuilt here. The
  originals from the artifact sandbox were never recovered, so these are
  new tests covering the same ground, driven through the real forms and
  real taps on the hole map:
  `ui-crud` (clubs, courses, range blocks, rounds), `ui-analytics`
  (strike classes, derived-never-stored, nominal vs measured, recency
  window, calibration, unmeasurable → null), `ui-tees-migrations`,
  `ui-swing` (frame extraction, 16 frames and the trim hint, analysis with
  each frame's time and the wrist question down the line, the coached card,
  video below ball data),
  `ui-practice` (recency weighting, freshness, quiet items, the planner),
  `ui-logging` (armed club, putts, penalties, quick score, first putt),
  `ui-overview` (the hierarchy, what is folded and the number each fold
  shows, and every number against a hand-worked scenario, nothing shown
  without data, the course page's folded information),
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
  `ui-loop` (the practice loop on a hand-worked scenario: a round's
  findings, Practise this, screenshots filling the plan, before/since on the
  objective page, Range list and Overview, the block against last time),
  `ui-visuals` (the spread, the scorecard and the dot details against
  hand-worked numbers, and the map-arrival cache bug),
  `ui-card` (pasting the hole-maps chat's Hurstville note into the course
  form: strict reading, the tee it names, everything else kept, round pars
  offered only when a par changed),
  `ui-undrawn` (GPS shots on a hole not drawn yet: saved raw, not
  measurable, then measured from the marked tee once drawn; the logger
  refusing a second frame; no-map courses unchanged),
  `ui-artconvert` (artwork → map: a straight hole and a dogleg by hand, the
  real Hunter Valley file end to end, distances from the map after),
  `ui-doubleloop` (the app checking its own list: each finding's outcome,
  the fold and its verdict thresholds, the readings' blind spots by view,
  the rules from the same constants, assumed against measured),
  `ui-tenhole` (a 10-hole card: the Moore Park import against the club's
  card, card sizes, the forms, a round scored as ten, the handicap's reason,
  the round form filling the picked tee's lengths),
  `ui-swings` (Swing history: the timeline newest first flagged range or
  course, the per-club summary from the readings, the empty state, the
  cross-reading button end to end against a stubbed analysis call, the
  video feed with a stand-in observer),
  `ui-import-many` (Import a backup with many files: one question, a stray
  named and skipped, only wrong files refused),
  `ui-courseicons` (a linked course's picture in the list, initials otherwise),
  `ui-rounds-images` (rounds from 18Birdies screenshots: day-first dates, the
  course and tee matched, totals checked, a scorecard joining its summary, the
  review, pars from Carry's card, the screenshots kept, a duplicate unticked),
  `ui-coursemap-gl` (the yardage-book map: the style as data, the map code
  against a stand-in MapLibre, kept across redraws, rebuilt for a theme),
  `ui-coursemap` (Courses on a map: the one row, pins by who can play, home,
  the map kept across a redraw, a pin opening its course),
  `ui-theme` (Appearance: System, Light, Dark; the root attribute, the
  stored copy, a setting from another phone),
  `ui-sg` (strokes gained: the table and allowance by hand, a hole adding
  up to expected minus strokes, pooling without a first putt, the level
  rules, the fold, nothing stored),
  `ui-togreen` (Getting to the green: a traced hole from its shots,
  scores-only holes tapped in, the table, teaser and story, the over-count
  and a traced hole refused),
  `ui-format` (a team round: not a handicap score and the reason shown,
  out of form, trend, course history and evidence, listed and labelled; set
  and cleared on the round form),
  `ui-marks` (Mark tee / Mark flag on an unmapped hole: the raw fix stored,
  ±10 m refused, flag after scoring, edits keep marks, only your own
  removable),
  `ui-holemap` (linking a map, the card check, taps in metres and lies
  from shapes, the legend showing only what the hole has, outline holes
  staying put, edits keeping the link, unlinking, a boundary-only map drawing
  only the holes with marks).
- `course-maps.test.js` (32) — the committed maps match their sources,
  attribution and fixed origins, Randwick's own lines (not the neighbour's),
  ownership inside the boundary, Bardwell's and The Coast's hand-mapped
  holes, Bondi's metres-vs-yards check, Massey Park's reds and missing hole 9, Long Reef's whites, Northbridge without a card, Hurstville's estimated greens and renumbered nines, Hunter Valley on a partial boundary with its own green per pin, Bexley's three tee sets all on boxes, the tier-A batch (mapped greens, ref numbers, Manly's 14, Woollahra's nine, Moore Park's ten), the A- batch (partial boundaries, Avondale's outline, Kogarah's shared lines), the B batch (the lines OSM has, Monash's older lines, holes from marks on a partial map), the C batch (lines or marks, flags snapping to mapped greens), the D batch, artwork taps onto the map, boundary-only maps and holes from GPS marks (agreement, stray and rough marks, the tee played, moving an estimated green), GPS projection and green front/middle/back, which holes are flagged and why, the tee rule and the tee-box
  check, lies, the view's orientation and tap round trip.
- `imports.test.js` (5) — every file in `imports/` is a one-course
  carry-export whose card adds up (holes 1..n, pars, `metres` mirroring the
  primary tee, each stroke index once, a Sydney location, a source); every
  course map has an import, is on the NAS already, or is on the test's
  no-card list (see *The course batch*); the batch's notes state each tee's
  total and the holes add to it, ratings are noted and never stored; Bexley
  (2026-10-28: 18 holes, par 64, 4,097 m blue; Hole19 and TheGrint agree
  hole by hole and with GolfNSW's total; white and red from TheGrint's
  metres; no rating stored; the club's own PDF card is on a host this
  container can't reach, so it is noted as unchecked).
- `housekeeping.test.js` (7) — the sign-in sheets (home address, expired
  session by redirect and by Cloudflare's 401, asked once), "Signed in as"
  and the shared-courses notes, a refused course delete saying why, request
  logging without the query string, a clean SIGTERM exit, the YAML's five
  replace markers.

`test/harness.js` boots a real server on a free port with seeded
documents, and **stops a page in a safe order** (2.39.1's CI run failed in
`ui-courses-sort` on it): hide the page so the shim stops polling, stop the
server, let in-flight requests settle for 300 ms while the page still exists,
then close it. Closing first let a save's answer redraw into a closed page
from an action's promise, which nothing catches; `housekeeping` holds a save
open across `stop()` and fails on the old order. It loads the page as the
server serves it into jsdom, and stubs only what jsdom lacks
(`<dialog>`, SVG CTM as identity so taps land at exact coordinates,
object URLs, `TextEncoder`, `Blob.arrayBuffer`). The swing suite adds a
fake decoder that reproduces the real one's timing: `seeked` fires before
the frame is painted.

Every gotcha above has a test, and each was checked by reintroducing the
bug and watching the test fail (22 mutations for the original suites,
18 for versioning and screenshots, 8 for the practice list, 14 for
1.5.0's distances, penalties and housekeeping, 26 for the handicap,
9 for course maps, 4 for the 1.9.0 tee-box check, 9 for holes from marks, 1 for Hurstville's renumbering, 2 for Hunter Valley, 2 for the tier-A batch, 2 for the A- batch, 1 for the B batch, 5 for flag snapping, 3 for course icons, 5 for `fromArt` (also run against the Carry chat's ui-artconvert), 2 for the legend, 5 for the
stroke index column, 28 for 2.0.0's sign-in and whose-data rules, 23 for Play
mode and the outbox, 15 for GPS marks (14 caught by their own test; a wrong
`tee` field from the app survives it because the server corrects it), 9 for 2.5.0's
Overview (one survived at first: a missing heading passed a "comes before"
check; the test now requires it), 12 for 2.6.0's practice loop (two survived
at first because the scenario had no tee misses and one earlier 5W session;
both added), 13 for 2.7.0's visuals (two survived at first: no topped
shot and no shot-tied penalty in the data; both added), 7 for 2.9.0's
card paste (one survived at first: no round left that differed; added), 6 for
2.10.0's undrawn holes (one survived at first: the greyed button off the
course; added); all
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

1. **Strokes gained** shipped in 2.35.0 against a published table (see
   *Strokes gained*). Next: a measured amateur baseline in place of the
   modelled handicap allowance, and letting the practice list use it (he
   asked for read-only first).
2. **Pose estimation on swing frames** shipped in 2.55.0 (see *The body,
   measured*); its faults feed the practice list (2.62.0) and the swing plane is drawn from it (2.63.0). He wanted it **before** stage 2 of the shot patterns (2026-10-31),
   mockup first: https://claude.ai/artifact/RXTm3HqHiPQb3Fdd2cnUYK
   (a skeleton on each frame, a chart per measure across the 16 frames, faults
   session by session; one camera is 2D, so face-on measures sway and head
   drift, down-the-line early extension, neither turn in degrees or the club).
   Built as the mockup proposed (MediaPipe in the browser, the joints stored on
   the swing). Next, at his word: the practice list using a measured fault, and
   a club detector for wrist hinge and shaft lean.
3. **More course maps** (see *Course maps*). Barnwell Park, Beverley
   Park and Lane Cove are drawn from his GPS marks as he plays them. Hunter
   Valley has its map (hole-maps 2.16.0) and its art rounds move onto it
   from the course page (2.17.0, *Artwork → map*).

4. **Courses on a map in the yardage-book style** shipped in 2.49.0 on
   OpenFreeMap (see *Courses list order*). Next, if he wants the map to ask no
   outside host: a Sydney PMTiles file on the NAS (Protomaps, ~100–300 MB)
   behind the same style.

5. **Shot patterns on the course** (stage 2 of the dispersion work; stage 1, the
   range, shipped in 2.52.0, see *Range data from screenshots*). On the backlog at
   his word (2026-10-31): a club's pattern laid along a hole on its page and in Play
   mode from the GPS ball, counted "3 of 20" by where they'd finish under the map's
   lie rules (water and OB on carry, the rest on total), other clubs one tap away,
   the armed club never changed. Later, a course pattern from logged approaches set
   against the range one. Mockups: https://claude.ai/artifact/GsWo9jZatcuJoVnqDeV7gh.

Done in 1.5.0: recency weighting of club distances, session filtering
(leave out, ball type), the penalty report.

Deliberately out of scope: booking (searching tee times is in, 2.40.0: see
*Tee times*; the booking stays on the club's site), anything that sends his
data anywhere — with one exception he chose on 2026-10-19: **Cloudflare
Tunnel** for off-LAN https (README, *Off the LAN*), because Play mode needs
GPS and a phone only gives GPS to an https page. Access in front, and since
2.0.0 Access *is* the sign-in (`API_TOKEN` is gone). Friends sharing it is
in scope since 2.0.0 (he asked, 2026-10-19); anything beyond "friends on
one NAS" (accounts, roles, invitations in the app) is not: who gets in is
the Access policy.

Play mode shipped in 2.1.0 (see *Play mode*); it opens without signal since
2.54.0 (*Opening without signal*).
**Not wanted: working out the hole from GPS** (he decided 2026-10-19). On
public courses the next tee is often beside the last green, so a fix there
puts him on the wrong hole; he moves holes himself (‹ ›, *Hole n →*).

## Working agreements from the chat

- Build it and test it, then report — not "here's what you could do".
- The Carry chat opens its own PR after each push (asked 2026-10-28); he
  merges and deploys.
- Flag uncertainty explicitly rather than smoothing over it (e.g. the
  Bardwell Valley card's units are labelled yards by the source but read
  as metres; that's noted in the course record rather than silently
  resolved).
- Don't invent numbers. Every distance in the database traces to a club
  scorecard, a course GPS app screenshot, or his own logged shots.
- Prefer honest limits over a plausible guess: "not measurable" beats a
  number that looks fine and isn't.
