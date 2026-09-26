# Changelog

Every release of Carry, newest first. The version is `package.json`'s; the
app shows it in the header, and the image is published as
`ghcr.io/zeinbenjamin/woods:<version>`. How releases are cut is in
`CLAUDE.md` → Versioning.

## [Unreleased]

## [1.1.0] - 2026-09-26

### Added
- **Range shots from screenshots.** On a range session, *From screenshots*
  takes up to six screenshots or photos of the bay's shot list. Claude reads
  them into blocks, one per club, and a review sheet shows every number
  beside the images to check and fix before anything is saved. Yards are
  converted only when the screen says yards; unclear readings, implausible
  shots, total-below-carry and unrecognised clubs are listed as warnings.
  The screenshots are kept with the blocks (`fromImages`) and shown on the
  block page, so every number traces back to what the bay showed.
- **Version in the app.** The header shows the running version; *Bag → Your
  data* shows version, commit and build date. The server reports them at
  `/version` and `/healthz`, and exports record `appVersion`.
- **Release process.** `CHANGELOG.md`, `npm run release -- patch|minor|major`,
  a CI check that pull requests changing shipped code bump the version, and
  automatic `v<version>` tags, versioned images and GitHub releases on merge.
- The app's UI test suites, rebuilt: 71 tests across CRUD, analytics
  invariants, tee sets and migrations, the swing analyzer, and shot logging.

### Fixed
- Deleting a stored file (swing frame, swing video, hole image) never
  worked: the server answered 404 and the file stayed on disk.
- New round: picking a different course now switches the tee control, so
  the round is saved against that course's tee.
- Re-analysing a swing in the app no longer keeps a stale "read in a chat"
  label.
- Deleting a range block or a session now removes its stored screenshots,
  swing frames and videos.
- TrueNAS compose healthcheck probed port 8080; the app is on 1818.

## [1.0.0] - 2026-09-26

The artifact app ported to a self-hosted server: Express + SQLite behind a
shim that serves the artifact's capability surface, a Docker image on GHCR,
and a TrueNAS SCALE deployment. (Dated by its first commit to this repo.)
