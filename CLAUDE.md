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
server/teetimes.js  reads a course's public MiClub tee-time pages on request
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
  the identity of `S.sessions`, `S.clubs`, `S.courses`, `S.settings`). A
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
- **App listens on 1818** (8080 was taken on his box). It's `PORT`-driven
  everywhere including the healthcheck.

## Who can play (2.39.0)

He asked, after the tee-times booking audit of 2026-10-29, for the app to show
whether a course is public or private. `access(c)` is `closed` (`c.closed`),
`public` (`bookable === true`), `private` (`bookable === false`) or null (not
known); `accessTag` puts it in the Courses list (green public, plain private,
red closed), and Course information says it under *Who can play* with
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
  *Find a tee time* moved beside *Add course* on the heading's row.
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
  already shown (iOS fills in today on opening) is not a new search. Measured in Chromium at 390px,
  light and dark: two rows, one size, no sideways scroll.
- **TeeItUp, read at his decision** (2.43.0, 2026-10-30: "build the GolfNow
  reader anyway, since it's for personal and non-commercial use"; told first
  that GolfNow's terms ban automated reading for any use). TeeItUp is GolfNow's
  booking engine for clubs (`<alias>.book.teeitup.com/?course=<GolfNow
  facility id>`, title "GolfNow Booking Engine"); its page is built in the
  browser (a TinyFish run found no times in the HTML), so the reader asks the
  API the page uses: `GET <TEEITUP_API>/v2/tee-times?date=D&facilityIds=ID`
  with `x-be-alias: <alias>` (`TEEITUP_API` defaults to
  `https://phx-api-be-east-1b.kenna.io`). **Not yet seen live**: the answer's
  shape in `parseTeeitup` (a day per facility with `teetimes`, each with
  `teetime` ISO, `maxPlayers`/`bookedPlayers`, `rates[]` with `name`, `holes`,
  `greenFeeWalking`, `allowedPlayers`, `backNine`) is the one TeeItUp is known
  to use, read defensively: times with an offset moved to Sydney's clock, fees
  of 1000+ taken as cents, spots from `allowedPlayers` else max − booked. An
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
- **Next:** the first live TeeItUp search, and a way to store a course's MiClub id when
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
Settings. A saved tab of `bag` opens Settings.

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
  list after *Quiet lately*): for every finding with dated evidence (not
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

The filters live in the "Range numbers" panel in Settings (2.13.0; 2.5.0 put it in the Overview's Gapping section, which now shows it as one line).

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
- **Honesty:** every fold says it is an estimate against a published table,
  distances to the green's middle, lies as recorded, not the Tour's number,
  not a prediction, nothing stored, and that it changes nothing about the plan
  or the armed club. `ui-sg` works a 300-yard par 4 at scratch by hand
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
- **The round page** (`roundFindingsSection`) lists what that round added
  evidence to: name, how many times, the clubs, the holes (links), *Practise
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

`npm test` — 389 tests, about 45s.

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
- `ui-teetimes.test.js` (11) — the search screen against a stand-in MiClub
  serving Bexley's pages: which courses are asked (near, public, readable),
  a course's rates and time chips linking to the club's timesheet, why a
  course shows nothing and the order, filters working without asking any
  club again (and kept on the phone), distance, another day and *Check
  again*, no home location, today at a fixed 13:30 hiding 13:04, the price
  limit by each time's own fee, one size and two lines, and a day 40 days out.
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
- `course-maps.test.js` (31) — the committed maps match their sources,
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
9 for course maps, 4 for the 1.9.0 tee-box check, 9 for holes from marks, 1 for Hurstville's renumbering, 2 for Hunter Valley, 2 for the tier-A batch, 2 for the A- batch, 1 for the B batch, 5 for flag snapping, 5 for `fromArt` (also run against the Carry chat's ui-artconvert), 2 for the legend, 5 for the
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
2. **Pose estimation on swing frames**, server-side. Turns swing analysis
   from a reading into measured angles tracked over time — impossible in
   the artifact, straightforward here. This is the real payoff of the port.
3. **More course maps** (see *Course maps*). Barnwell Park, Beverley
   Park and Lane Cove are drawn from his GPS marks as he plays them. Hunter
   Valley has its map (hole-maps 2.16.0) and its art rounds move onto it
   from the course page (2.17.0, *Artwork → map*).

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

Play mode shipped in 2.1.0 (see *Play mode*). Next for it, once he's used
it on a course: a service worker so the app itself opens without signal
(today only saves survive no signal; the page needs the network to load).
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
