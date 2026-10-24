# Carry

A golf tracker: rounds logged shot by shot, range sessions, swing video
analysis, and a practice list that ranks what's actually costing you
strokes. Self-hosted — your data stays on your server.

Built as a Claude artifact, ported here without rewriting the app: the
browser code still asks for `db`, `assets`, `sample` and `downloads`
capabilities, and `web/platform.js` serves them from this backend
instead of the artifact runtime.

---

## What's in here

```
deploy/
  truenas-compose.yml   paste-ready for the SCALE Custom App form
server/         API, SQLite storage, Anthropic proxy
  db.js         documents + assets
  anthropic.js  swing analysis (holds the API key, server-side only)
  index.js      routes, auth, static hosting
web/            the app
  index.html    the app, one file
  platform.js   the shim that makes the app work off this server
  holemap.js    course maps: tee rule, lies, the yardage-book drawing
  course-maps/  built map files (from OpenStreetMap, committed)
scripts/
  import-export.js   load a "carry-export" JSON into this server
  course-maps.js     build course maps from OpenStreetMap exports
course-maps/    map sources: per-course notes, cards and OSM extracts
test/           end-to-end tests, including app-through-shim-to-SQLite
SCHEMA.md       every document shape, the invariants, what's derived
```

## Quick start (local)

```bash
cp .env.example .env          # fill in ANTHROPIC_API_KEY
npm install
DATA_DIR=./data DEV_USER=you@example.com node server/index.js
# http://localhost:1818 — DEV_USER signs every request in as that email,
# with no Cloudflare. Local development only; never set it on the NAS.
```

Run the tests with `npm test` — 289 of them, covering the API, the asset
store, auth, the import path, and the real app driving the real server:
CRUD through its forms, shot logging by tapping the hole map, analytics
invariants, the practice list and planner, tee sets and migrations, range
screenshots, versioning, and the swing analyzer.

## Deploying on TrueNAS SCALE

1. **Make a dataset** for the data, e.g. `tank/apps/carry`. The database
   and every uploaded frame and video live there — it's the only thing
   that needs backing up. Snapshot it.

   Give it to the apps user, which is what SCALE runs containers as:

   ```bash
   chown -R 568:568 /mnt/tank/apps/carry
   ```

   The compose file already sets `user: 568:568`. If the container can't
   write, this ownership is almost always why — the symptom is SQLite
   failing to create `carry.db-wal` on the first save.

2. **Get the code onto the box**, either by cloning this repo or by
   pointing the app at the image you've pushed.

3. **Create the app.** Which route depends on how you run containers.

   **Apps → Discover → Custom App (the TrueNAS UI).** This form *pulls*
   images; it cannot build one. Pointing it at a compose file containing
   `build: .` fails, and the error you see is misleading — TrueNAS runs
   `down` to clean up and reports *that* failure instead:

   ```
   [EFAULT] Failed 'down' action for 'carry' app
   ```

   The real error is in `/var/log/app_lifecycle.log`. So publish an image
   first: push this repo to GitHub and the `publish` workflow builds it
   and pushes to `ghcr.io/<you>/carry:latest` on every commit to main.
   Make the package public (Packages → carry → Settings → Change
   visibility), or add registry credentials in the app form. Then paste
   `deploy/truenas-compose.yml` into the form, having replaced the image
   name, the key, the Access values, your email and the dataset path
   (the file marks all five).

   Delete any half-created `carry` app before retrying — a failed install
   leaves one behind, and the name clashes.

   **Dockge, Portainer, or an SSH session.** Build from source directly:

   ```bash
   cp .env.example .env        # set DATA_PATH=/mnt/tank/apps/carry
   docker compose up -d --build
   ```

   For the Custom App form, the equivalent settings are:

   | Setting | Value |
   |---|---|
   | Image | build from this repo, or your pushed image |
   | Port | host `1818` → container `1818` |
   | Storage | host `/mnt/tank/apps/carry` → container `/data` |
   | User / Group ID | `568` / `568` |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `CF_ACCESS_TEAM` | your team domain, `<team>.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | the Carry Access application's AUD tag |
   | `OWNER_EMAIL` | the email you sign in with (see *Sign-in*) |
   | `TZ` | `Australia/Sydney` |

4. **Bring your data over.** Open the artifact, *Bag → Export
   everything* (leave images on), then:

   ```bash
   docker cp carry-export-2026-09-25.json carry:/tmp/
   docker exec carry node scripts/import-export.js /tmp/carry-export-2026-09-25.json --owner you@example.com
   ```

   Asset ids are preserved, so hole artwork and swing frames keep
   resolving without rewriting a single reference. Re-running it is safe.
   `--owner` is whose clubs, rounds and sessions they become; courses are
   shared, and an export's copy of a course replaces the current one.

5. **Open it** at its Cloudflare address (next section) and sign in.
   Add it to the home screen — there's a manifest, so it installs like an
   app. Since 2.0.0 the NAS's own `http://truenas:1818` opens nothing:
   every request has to come through Cloudflare Access.

### Sign-in (2.0.0)

Carry has no passwords of its own. Cloudflare Access signs you in (a
one-time PIN to your email), and stamps every request it lets through
with a signed token. Carry checks that signature against your team's
published keys, the application's audience tag and the expiry, and takes
your email from it. That email is whose data it is:

- **Yours alone:** clubs, rounds, range sessions, swings, settings.
- **Shared:** courses. One Randwick card for everyone; an edit is
  everyone's edit. A course someone else has a round on can't be deleted.
- **Files** (hole art, swing video, screenshots) can be read by anyone
  signed in, and deleted only by whoever uploaded them.

**Adding a friend:** Zero Trust → Access → Applications → Carry → the
policy → add their email. They open the same address and start with an
empty bag and every course.

**Upgrading from 1.x**, once:

1. In the TrueNAS app's YAML, remove `API_TOKEN` and set
   `CF_ACCESS_TEAM` (the `<team>.cloudflareaccess.com` address the Access
   login page is on; also under Zero Trust → Settings), `CF_ACCESS_AUD` (Access → Applications → Carry → *Overview* →
   Application Audience (AUD) Tag) and `OWNER_EMAIL` (the email you sign
   in with).
2. Redeploy. On first start Carry copies the database to
   `carry-before-2.0.0.db` in the dataset, then makes every existing
   club, round and session yours. Without `OWNER_EMAIL` it refuses to
   start and changes nothing; the log says why.
3. Open the Cloudflare address. Bag shows *Signed in as …*.

If the Access session expires the app says so and offers *Sign in again*.
If Cloudflare's keys can't be fetched, Carry refuses everyone (503)
rather than letting anyone in.

### Off the LAN: Cloudflare Tunnel

Needed for Play mode on the course: a phone only gives a page its GPS
position over **https**, and `http://truenas:1818` only works at home. A
tunnel gives Carry an https address without opening a port. Requests pass
through Cloudflare (TLS ends at their edge): that was a deliberate choice.
Since 2.0.0 Access (step 4) is also Carry's sign-in, so it isn't optional.

**Already have a tunnel and `cloudflared` running** (for other apps)?
Then it's two steps and no new container:

- In the tunnel's *Public hostname* tab, add `carry.<your domain>` →
  service **HTTP**, URL `<NAS LAN IP>:1818` (e.g. `192.168.1.20:1818`),
  the same way your other apps are pointed. Carry publishes 1818 on the
  NAS, so your existing `cloudflared` reaches it like any other app. (The
  name `carry:1818` only resolves inside Carry's own compose network.)
- Do step 4 (Access) and step 6 (the phone) below. Skip 1, 2, 3 and 5.

**Starting from nothing:**

1. **A domain on Cloudflare.** The tunnel needs a domain whose DNS
   Cloudflare runs (bought there, or moved there).
2. **Create the tunnel.** Cloudflare dashboard → Zero Trust → Networks →
   Tunnels → *Create a tunnel* → Cloudflared, name it `carry`. Copy the
   token from the install command it shows (the long string after
   `--token`).
3. **Point a hostname at Carry.** In the tunnel's *Public hostname* tab:
   subdomain `carry`, your domain, service **HTTP**, URL `carry:1818`
   (the container's name on the app's own network).
4. **Lock it to you.** Zero Trust → Access → Applications → *Add* →
   Self-hosted, the same hostname, a policy that allows your email (and
   any friend's), login by one-time PIN. Then nobody else reaches even the
   page. Copy the application's AUD tag into `CF_ACCESS_AUD`
   (see *Sign-in*).
5. **Run the tunnel beside Carry.** Edit the app in TrueNAS and add this
   under `services:` in the YAML, next to `carry:`, with your token:

   ```yaml
     cloudflared:
       image: cloudflare/cloudflared:latest
       container_name: carry-tunnel
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: "PASTE_THE_TUNNEL_TOKEN"   # ← from step 2
       depends_on:
         - carry
   ```

6. **On the phone,** open `https://carry.<your domain>`, sign in to
   Access, and add it to the home screen again.

The free plan cuts a request off after 100 seconds; swing analysis takes
about 30. Use the Cloudflare address at home too: the NAS's own address
no longer opens anything.

### Behind a reverse proxy

Since 2.0.0 Carry needs Cloudflare Access's signed token on every
request, so a plain reverse proxy on its own won't get in. If you put one
behind the tunnel, pass the `Cf-Access-Jwt-Assertion` header and cookies
through, and allow `proxy_read_timeout 120s` — swing analysis can take 30
seconds or so.

## Swing analysis

The reason self-hosting is worth it. In the artifact, sending images to
Claude wasn't available, so analysis meant saving frames and pasting them
into a chat. Here the server holds the key and calls the Messages API
directly, so **Analyse** works in the app — it's the only route now; the
chat workaround was removed in 1.3.0.

Cost is trivial: eight 880px frames plus the prompt is roughly 5,000
input tokens, about 1.5 cents a swing at Sonnet pricing. Put a spend cap
on the key anyway — a retry loop is how people get surprise bills.

Model is configurable with `CARRY_MODEL`.

## Play mode

Rounds → **Start round** at the course: it picks the course you're standing
at, you choose the tees and whether you start at 1 or 10. Each hole shows
where you are on the map, the distance to the front, middle and back of the
green, and the hole's bunkers and water ahead (to reach, to carry). Stand at
your ball and tap **Mark my ball here**, or tap the map; add putts and any
penalty, and the running score updates. Courses without a map can still be
scored hole by hole.

GPS needs the https (Cloudflare) address and the phone's permission. With no
signal, saves stay on the phone and go when signal is back (the status line
says how many are waiting); the app itself needs signal to open.

## Range shots from screenshots

On a range session, **From screenshots** takes up to six screenshots or
photos of the bay's shot list. Claude reads them into blocks, one per
club; you check every number beside the images, fix anything, and only
then is it saved. The screenshots are stored with the blocks. Uses the
same server-side key as swing analysis.

## Versions and updates

Tap **Carry** at the top of the app to see the version and build you're
running and what changed in each version. If the server has a newer
build than your phone, the app says so: close it fully and reopen.

Releasing (details in `CLAUDE.md` → Releases): bump with
`npm version <x.y.z> --no-git-tag-version`, add a `## x.y.z — YYYY-MM-DD`
entry with `- ` bullets at the top of `CHANGELOG.md`, and merge. The
publish workflow tags `v<x.y.z>` and publishes
`ghcr.io/zeinbenjamin/woods:<x.y.z>` alongside `:latest`.

On TrueNAS, `:latest` follows main; pin `:<x.y.z>` if you want updates
only when you choose them. `deploy/truenas-compose.yml` sets
`pull_policy: always` so a redeploy actually fetches the new image;
TrueNAS still won't redeploy by itself — update the app to do it.

## Security

- The Anthropic key is only ever on the server. The browser talks to
  `/api/analyse`.
- Every `/api` route and every `/_blob/:id` file needs a valid Cloudflare
  Access token (RS256, checked against the team's keys, audience, issuer
  and expiry). The `Cf-Access-Authenticated-User-Email` header is never
  trusted on its own: anyone who can reach the port could send it.
  `/api/version` and `/healthz` stay open and say nothing about the data.
- Everyone signed in shares one Anthropic key: a friend's swing analysis
  is on your bill. Put a spend cap on the key.
- Courses are shared and editable by everyone signed in; each change
  records who made it (`updated_by`).

## Backups

Everything is in the data directory:

```
/data/carry.db        documents (WAL mode)
/data/assets/         hole artwork, swing frames, videos
```

ZFS snapshots cover it. For a portable copy, use *Export everything* in
the app — one JSON file with the images embedded, which is what
`scripts/import-export.js` reads back.

## Where this is heading

Deferred deliberately, in rough order of value:

- **Strokes gained.** First-putt distances are being captured now, which
  was the missing input. Needs a baseline table next.
- **Pose estimation** on swing frames, server-side, for measured angles
  rather than a reading. Impossible in the artifact; straightforward here.
- **Recency weighting** beyond the current window selector.
- **More course maps.** Randwick and Bardwell Valley are done (1.8.0).
  Coverage of the rest is uneven; see *Course maps* below.
- Session filtering.

## Course maps

Holes can be drawn from OpenStreetMap (map data © OpenStreetMap contributors,
ODbL). Each course has a source in `course-maps/src/<id>.json` (which OSM course,
where the hole lines come from, the card the lengths were checked against, and
a fixed `origin`), an extract of the OSM data in `course-maps/osm/<id>.geojson`,
and the built file the app reads in `web/course-maps/<id>.json`.

Adding a course:

1. Export the area from overpass-turbo.eu (golf features, plus trees and
   woods inside golf courses) as GeoJSON.
2. Write `course-maps/src/<id>.json`. Use `"holes": "osm"` where OSM has hole
   lines (`golf=hole`), plus `addHoles` for any it lacks; otherwise map each
   hole's tees and green by OSM id.
   Pick an `origin` near the middle of the course and never change it once
   rounds are logged on the map.
3. `node scripts/course-maps.js extract <id> export.geojson [trees.geojson]`
4. `node scripts/course-maps.js build` prints every hole against the card
   and flags any more than 10% apart. Commit all three files; a test fails
   if the built file doesn't match its sources.
5. After deploying, open the course in the app and choose *Use this map*.

## Licence

Private project. No licence granted.
