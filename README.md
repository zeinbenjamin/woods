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
  index.html    the whole thing, one file
  platform.js   the shim that makes the app work off this server
scripts/
  import-export.js   load a "carry-export" JSON into this server
test/           end-to-end tests, including app-through-shim-to-SQLite
SCHEMA.md       every document shape, the invariants, what's derived
```

## Quick start (local)

```bash
cp .env.example .env          # fill in ANTHROPIC_API_KEY and API_TOKEN
npm install
DATA_DIR=./data node server/index.js
# http://localhost:1818
```

Run the tests with `npm test` — 133 of them, covering the API, the asset
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
   name, the token, the key and the dataset path.

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
   | `API_TOKEN` | `openssl rand -hex 24` |
   | `TZ` | `Australia/Sydney` |

4. **Bring your data over.** Open the artifact, *Bag → Export
   everything* (leave images on), then:

   ```bash
   docker cp carry-export-2026-09-25.json carry:/tmp/
   docker exec carry node scripts/import-export.js /tmp/carry-export-2026-09-25.json
   ```

   Asset ids are preserved, so hole artwork and swing frames keep
   resolving without rewriting a single reference. Re-running it is safe.

5. **Open it** at `http://truenas:1818/?token=YOUR_API_TOKEN`. The token
   is stored in the browser, so that's once per device. Add it to the
   home screen — there's a manifest, so it installs like an app.
   Open it without the token (or with a wrong one) and the app asks for
   it.

### Behind a reverse proxy

Put it behind Traefik/NPM with TLS if you want it off the LAN. The app is
a single page plus a JSON API, so nothing special is needed beyond
`proxy_read_timeout 120s` — swing analysis can take 30 seconds or so.

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
- `API_TOKEN` guards every `/api` route. `/_blob/:id` is deliberately
  open so `<img src>` works; ids are 128-bit random.
- There's no multi-user concept. One token, one bag, one set of data.
  Don't expose it publicly without putting real auth in front.

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
- **Course data from OpenStreetMap** — `golf=hole` ways carry par, length
  and stroke index, and the polygons would give true hole shapes instead
  of drawn outlines.
- Session filtering, artwork for the remaining courses.

## Licence

Private project. No licence granted.
