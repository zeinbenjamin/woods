# Carry as an iPhone / Android app: the plan (parked)

Written 2026-10-31 by the hole-maps chat at Zein's request, so a future chat
can pick it up. **Status: parked by him on 2026-10-31.** Nothing here is built.
Owner when it's picked up: the Carry chat (it's app code), or a new mobile chat
owning a `mobile/` folder.

## Why it came up

On the course, GPS in Play mode is slow after every unlock. Carry is a web page
(even from the home screen), so iOS stops its code and its GPS when the screen
locks or he switches apps; each unlock starts the GPS cold, and a good fix
takes seconds, longer under trees. 18Birdies doesn't have this because it's a
native app with background location. **Only a native app can keep GPS running
while the phone is locked.** That is the reason for this plan; everything else
in it is a bonus.

## Before any of this: what helps with the web app as it is

Discussed the same day; worth doing first and cheap.

1. **The phone's setting** (free): Settings → Privacy & Security → Location
   Services → Safari Websites → *While Using the App*, *Precise Location* on.
   "Ask Next Time" asks again on every reopen; without Precise the fix is off
   by hundreds of metres.
2. **Keep the GPS chip warm with a native app that tracks** (free, untested):
   a Strava *Golf* activity started on the 1st tee keeps iOS location running
   all round, so Carry should get a fresh fix within a second or two of an
   unlock. Doesn't make Carry track while locked. To be confirmed on a round.
3. **Two changes in the app (Carry chat; he picked these two)**, still open as of
   2.69.1:
   - **GPS for the whole round, not only the Play view.** `playLifecycle()`
     stops `watchPosition` on leaving `vPlay`. While a round dated today is in
     progress (started in Play, holes not all done), keep the watch running
     app-wide; stop on *End round*, when every hole is done, or at local
     midnight.
   - **Keep the screen awake for that round**, not just the Play view, and take
     the Wake Lock again on `visibilitychange` back to visible (iOS drops it on
     lock). Battery: roughly 15–25% over 18 holes depending on brightness;
     Low Power Mode can override it.
   (Two more were offered and he found them unhelpful: showing the last fix
   with its age on unlock, and a setting to switch the above on and off.)

## The route: Capacitor

A thin native shell around the existing app: the same HTML/JS, the same NAS,
the same tests, native plugins only where a web page can't reach. React Native
or Flutter would mean rewriting ~3,000 lines of working app code; not worth it.

### Phase 0: decisions and accounts (before code)

- **Apple Developer account**, $149 AUD a year, and **a Mac with Xcode** for the
  first build and signing. (A free account works but the app expires every 7
  days.)
- **Google Play Console**, $25 USD once, or no store at all: an APK installed
  directly is free.
- **Distribution: TestFlight** (iPhone) and **Play internal testing**
  (Android). No public App Store listing, so Apple's "is this just a website"
  review rule (guideline 4.2) doesn't apply. External TestFlight testers (his
  friends) need a light beta review.
- **Check Cloudflare Access's sign-in method.** Email one-time PIN works inside
  an app's web view. Google sign-in is refused inside embedded web views
  (`disallowed_useragent`), so it would need the system browser
  (ASWebAuthenticationSession) to sign in and hand the session back: a known
  pattern, more work.
- **Who builds it** (see Owner above).

### Phase 1: the shell (1–2 days)

- A Capacitor project in `mobile/` whose web view loads
  `https://carry.elevengrant.com` (`server.url`). Every merge to main reaches the
  app at once, with no store release per change.
- Sign-in through Access inside the app. The 2.39.1 sign-in hop
  (`signInHop`, `location.replace`) works there because the login cookie is
  first-party inside the app's web view.
- Icon, splash screen, name. Installed through TestFlight and played with as is.

### Phase 2: GPS for the whole round (2–4 days, then a real round)

- A background-location plugin (e.g. `@capacitor-community/background-geolocation`;
  Transistorsoft's is more complete but paid for Android release builds).
  iOS: `UIBackgroundModes` → `location`, the *When In Use* usage string; the
  blue location pill shows while it tracks. Android: a foreground service with a
  permanent notification ("Carry: round in progress"), which Android requires.
- **Through the shim:** `web/platform.js` gains a location capability; Play asks
  it instead of `navigator.geolocation`. In the browser it falls back to today's
  `watchPosition`. This keeps the capability surface the seam between app and
  platform, as CLAUDE.md's *Architecture* asks.
- While locked, the web view's JS is suspended; the plugin keeps fixes natively
  and hands them over on unlock, so Play has a fresh fix at once. Tracking
  starts with a round in Play and stops on *End round* or at the end of the day.
- Keep-awake as a native plugin (more reliable than the browser's Wake Lock).
- Marking a shot still needs him to tap; nothing is logged on its own.

### Phase 3: Android (1–2 days)

The same project builds for Android; the location notification above is the
only real difference.

### Phase 4: fully offline start (smaller now)

**Mostly done on the web already:** since 2.54.0 the service worker
(`web/sw.js`, *Opening without signal*) opens the app, its data and the course
maps without signal. What would remain in a native build: ship the app's files
inside the app (so it starts even if the NAS is down or the service worker's
cache was cleared), and decide whether the outbox moves to native storage.
Trade-off: app code changes then need a new build (Phase 5 makes that cheap).

### Phase 5: build pipeline

GitHub Actions: Android on the standard Linux runners, iPhone on a macOS
runner (Fastlane), signing keys as repository secrets. A merge to main produces
a TestFlight build without touching the Mac.

### Later, if wanted

- **Lock-screen distances during a round** (iOS Live Activities): front,
  middle, back to the green without unlocking. Needs some Swift. The feature
  that would put Carry ahead of 18Birdies on the course.
- **Apple Watch distances:** a separate native target; big.
- **Share a swing video straight into Carry** from Photos (the share sheet),
  which also avoids the HEVC-in-the-browser decoding problem.
- **Notifications,** e.g. a tee time that suits opening up.

## What stays the same

The server, the data, Cloudflare Access, the web app in a browser (for friends
who don't install it, and on a computer), and the test suites (native plugins
stubbed in tests, checked on a real phone).

## Suggested order when it's picked up

The two web changes in *Before any of this* first. Then Phases 0–2: 18Birdies-
style GPS within about a week of work, without committing to the rest. Phase 4
only if the service worker's offline start turns out not to be enough.
