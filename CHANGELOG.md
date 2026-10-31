## 2.69.0 — 2026-10-31
- The shot tracer draws hooks and draws properly: over the top, the line now heads the way the ball went after its peak. Before, a ball that came down left of its peak but still right of where it started was drawn as a fade with a flat cut back at the top.
- The body, measured (the four positions and every measure) is now one quiet toggle at the bottom of the swing card, its count in the title.
- The Swings page has an "Analyse n swings" button again. It works through every swing that needs it: any never read, measured with the old body model, or read without "how it fits together". Each is measured on your phone where needed, then read by Claude, one at a time. It disappears once every swing is up to date.

## 2.68.0 — 2026-10-31
- One row of buttons on a swing card: Analyse, Play video, Trace the shot and More…. Moving the ball, measuring again, tracing the hands, changing the angle and deleting are under More….
- Analyse now does both jobs: if the body isn't measured yet, it measures it on your phone first, then Claude reads the swing with those measurements. There's no separate Measure button any more.
- The notes have moved to quiet toggles at the bottom of the card: What Claude saw (with when it was read), how the lines were drawn, every measure, across the swing, and the frames.

## 2.67.0 — 2026-10-31
- A swing card now opens with the whole story in four rows: the ball (how far it went and where it finished, plus the shape you traced), the body (how many measures are outside the guide, and which), the plane (where your hands were against the V), and the fix.
- New readings also say how it all fits together: which measured positions and which shot the fix accounts for, and where they disagree. Older readings say to analyse again to get this.
- The traced shot and the swing plane are drawn on one picture, with both switches above it. Turn either off and the other keeps its own picture.
- Why, feel and drill, what Claude saw, every body measure and the frames are folded under the summary, so the card is about a quarter shorter and the summary is the first thing you read.

## 2.66.0 — 2026-10-31
- Shot tracer: on a swing card, *Trace the shot* takes three taps (the ball, where it peaked, where it came down) and the shape you saw, and draws the ball's flight over the finish frame like the tracers on golf videos. If you've already tapped the ball for the swing plane, Carry starts from there.
- When the swing is tied to its shot, the real numbers sit beside the line: on the course, how far it went, where it finished and what was left to the green, from the hole map; at the range, the bay's carry, total and side. The line itself is labelled as your drawing, not a measurement.
- On the playing video the ball flies out from impact; paused, the whole flight shows. It's in the swing's sheet, the card's *Play video* and the feed.
- *Shot tracer* has its own switch beside *Swing plane*, so you can show either, both or neither.

## 2.65.1 — 2026-10-31
- The swing plane works again on down-the-line swings measured with the new model. It is more cautious than the old one about hands it can't see clearly, and from behind your wrists are always partly hidden, so Carry was throwing away hands that were in the right place. That left some swings with no plane and gaps in the hand line.
- When the model's two wrists disagree, Carry now trusts the one it's surer of rather than averaging them, since both hands are on the grip.

## 2.65.0 — 2026-10-31
- A more accurate body model. From behind, the old one often put your wrists on your forearm instead of your hands, so the hand line ran too close to your body going back. Carry now uses MediaPipe's largest pose model, which found your hands where the video shows them.
- It's a bigger one-time download (about 31 MB) the first time you measure, and measuring takes a few times longer.
- Swings measured with the old model say so on their card. *Measure n swings with the new model* on the Swings page redoes them all in one go, hand trace included.

## 2.64.1 — 2026-10-31
- The hand line now works on slow-motion clips. It traced them too thinly (the downswing got about ten points), which drew a line of corners. Now the whole swing is traced and the downswing filled in frame by frame.
- Where the line changes colour (the top, and impact) now comes from how your hands actually move, so it's right whatever the clip's speed. Before, it could switch to "coming down" halfway down.
- To redo a swing traced before this, use *Measure again*.

## 2.64.0 — 2026-10-31
- The hand line is smooth now, like the tracers on golf videos. *Measure the body* also traces your hands through the stored video, on every frame the clip has across the swing, not just the 16 pictures, and draws one smooth line from address to the finish: green going back, white coming down, grey after impact.
- The line draws itself over the clip as it plays, in the swing's video and in the Swings feed, with your hands as a dot, and shows whole when paused. The *Swing plane* switch turns it off.
- Swings measured before this have *Trace the hands from the video* on the card. A swing with no stored video keeps a dotted line from its 16 frames, labelled as drawn between frames, not measured.
- The line breaks where the model loses your hands in the blur at speed, rather than guessing across the gap. Measurements still come from the 16 frames as before.

## 2.63.0 — 2026-10-31
- Swing plane on down-the-line swings. After *Measure the body*, tap *Tap the ball* and tap the ball once on the address frame. Carry draws the V from the ball (the shaft line through your hands at address, the shoulder line through your shoulders), with your hands going back in green and coming down in white.
- Three new measures: your hands at the top and coming down, against the V (inside it, flatter under the shaft line, or steeper over the shoulder line), and your hands' height at impact against address.
- The sheet checks the camera first: if your shoulders don't overlap at address, the phone wasn't behind your hands, so the plane isn't drawn and Carry says why.
- A *Swing plane* switch on the card hides or shows the drawing on this phone. The measures stay listed either way.
- Plane faults feed the practice list like the other body measures, with their own drills.
- Hands height at impact needs impact marked on the trim (or frames close together there). Otherwise the frame taken as impact can be the follow-through, so it asks you to mark it instead of giving a wrong number.
- The body measures now find the top and impact when only one wrist is visible, as often happens down the line.

## 2.62.0 — 2026-10-31
- The practice list now uses the measured body. A measure outside its guide on most of a club's recent swings from one camera angle (at least 3 of the last 5) becomes a finding, such as hips moving toward the ball at impact on your driver.
- When the same club already has a finding from the ball data, the body fault backs it up on that card ("body, measured") and adds to its weight, rather than being listed twice. On its own it gets its own card, with a drill and a note that the guides are rules of thumb.
- A finding's page lists the measure for each swing behind it, and *How this is ranked* shows the rule.
- Only swings where the body was found on most frames, filmed square on, count. Like any finding, a body fault goes quiet once enough swings come back inside the guide.

## 2.61.0 — 2026-10-31
- Back buttons now take you to the page you came from, named for it: a round opened from the Swings tab goes back to Swings, a finding opened from the Overview goes back to the Overview, and Settings goes back to the page you opened it on. The page comes back as you left it, scrolled to the same place with the same sections open.
- Moving from hole to hole doesn't add to the way back: back from any hole goes to the round, then to wherever you opened the round from.
- Tapping a tab starts afresh. Deleting a round, session, block or course takes you back to where you were before it.
- A swing's card on the Swings tab has *Play video* at the top right, which plays the clip in the card, and shows the measured body under the reading: the four positions, the measures and *Across the swing*.

## 2.60.1 — 2026-10-31
- *Across the swing* now runs across the swing's real time, address to finish, so frames packed around impact no longer squeeze the backswing to one side.
- Address, Top, Impact and Finish are marked on every chart and named once underneath; names that sit close together no longer run into each other.

## 2.60.0 — 2026-10-31
- Settings shows *Range numbers* open: no toggle to tap first.
- On the Overview, *Also costing you* is a toggle, closed until you want it.
- On the Range list, *Quiet lately*, *Is this list right?* and *What the readings couldn't see* are small grey toggles, like *Across the swing* and *What Claude saw*.
- On the Courses list, the public, private and closed tags are in the map's pin colours: sand, lavender and red. Members-only courses are called *private* on the list and on the map's key.

## 2.59.0 — 2026-10-31
- Faster with a season of data: the Overview, Range list and round pages draw about 4 to 10 times faster, and a course page about twice as fast. Nothing you see has changed, only how often the app works it out.
- After a save (every shot marked in Play mode), the app now fetches only what changed, a few KB instead of the whole history, which matters on mobile data. Opening the app no longer downloads everything twice.
- The copy kept on your phone for opening without signal now stays as current as the app, not as it was when you opened it.

## 2.58.0 — 2026-10-31
- On a round, *What this round showed* and *Clubs on the course* are now toggles, right under *Getting to the green* and *Strokes gained*.
- Once a swing's body has been measured, its frame-by-frame strip folds away under *Frames*; the four positions show the swing.
- On the Range list, *Quiet lately* is a row like *Is this list right?* and *What the readings couldn't see*, in one quiet group.
- *Measured, swing by swing* on the Swings page is one row per measure: the latest value, the change since the first swing, and how many swings.
- Face and path now read the way golfers say it: the face open or closed, the path in-to-out or out-to-in. *Curves left* and *curves right* stay.
- The Overview's *Face, path and strike* is just the table: face, path, which way it curves, which one the shots followed, and smash. Clubs without enough shots are listed in one line.
- *Strokes gained* says what it's measured against in one line instead of a paragraph.

## 2.57.1 — 2026-10-31
- On an iPad (or any wide screen), the *Across the swing* charts no longer blow up their labels, dots and guide boxes. They stay the same size as on a phone while the lines use the full width.
- The round-by-round chart on a practice item's page no longer stretches past a comfortable width.

## 2.57.0 — 2026-10-31
- A swing's camera angle can be changed: *Change angle* on the swing card. The body measures follow straight away. A reading made under the old angle stays, with a note to analyse again.
- *Across the swing* now shows a dotted guide at the top and impact on each chart, and marks the swing red where it's outside it. The measures list says *outside the guide* too.
  - The hip guide comes from tour data (Sportsbox: hips under about 2 inches away at the top, about 5 inches toward the target by impact).
  - The head, lead arm and posture guides are coaching rules of thumb, and the chart says so.
- The long note under the body measures is gone; the heading now says *2D* and where impact came from.

## 2.56.1 — 2026-10-31
- A swing where the pose model found no one now says so, and asks you to film the whole body. It used to tell a face-on swing it needed a face-on view.
- A measured swing has *Measure again*, so a clip that measured badly isn't stuck.
- On the Swings page, each club's *Measured, swing by swing* list no longer draws over the page below it.
- A face-on swing filmed from an angle (hips and shoulders almost in line) is no longer measured. It said things like −394% of hip width; now the card says the camera wasn't square on.
- Server libraries updated for two security fixes (in Express's request reading).

## 2.56.0 — 2026-10-31
- A swing can be tied to the shot it hit. On a swing card, *Which shot was this?* lists that round's or session's shots, the swing's club first. Pick one and the card says what that ball did: the hole, the club, how far it went, where it finished. A range shot also shows its carry, total, side, face, path, smash and strike.
- A swing reading is told what its own shot did, and judges the swing against that ball first and the club's averages second.
- The shot shows as *filmed* in the hole's shot list and in a block's shot table. A filmed shot behind a practice finding (a tee shot into the trees, a low runner) shows under *Filmed* on that finding's page, so you can see what the miss looked like.
- Delete an earlier shot and the tag moves with its shot. Delete the tagged shot itself and the swing says it's no longer tied, never a guess. A re-pasted range block finds the same ball by its carry and total.
- In each club's body measures on the Swings page, swings filmed on the course are marked *(course)*.

## 2.55.0 — 2026-10-31
- Swings can now be measured. *Measure the body* on a swing finds your joints on each of its frames, on your phone, with a pose model that runs in the browser (nothing is sent anywhere). The swing card then shows the skeleton over Address, Top, Impact and Finish, and what the camera can measure:
  - Face-on: hip sway at the top, where the hips are at impact, head drift from address to impact, and the lead arm at the top.
  - Down the line: hips moving toward the ball by impact (early extension), forward bend lost, and head height.
- *Across the swing* charts each measure frame by frame, with the top and impact marked. Top and impact are found from your hands, or taken from your impact mark.
- On the Swings page, *Measure the body on n swings* measures everything at once, and each club's fold shows each measure swing by swing, so you can see whether a fault is shrinking.
- Swing readings are given the measured numbers too, and asked to say if what they see disagrees.
- Unsure joints are left out, never guessed. A swing where the body was found in fewer than three in four frames says it's too few to rely on, and isn't counted in the trends. Phones need Safari 16.4 or later, or a recent Chrome.

## 2.54.0 — 2026-10-31
- Carry opens without signal. The page, your data and the course maps you've opened are kept on the phone as they last arrived, and used only when the network can't be reached. The status line says "No signal: showing this phone's copy from …", saves wait on the phone as before, and everything goes back to normal when the signal returns. After updating, open Carry once with signal. Swing videos, photos, map tiles, tee times and swing readings still need signal.
- Patterns by club on the Overview is calmer: it shows each club's oval without the dots. Tap a club's row to see just that club's shots, with the other ovals faint behind; tap it again to see every club. Clubs without enough shots yet are listed too, so you can see their dots.

## 2.53.0 — 2026-10-31
- Face, path and strike. A range block with the bay's club data now shows a *Face, path and strike* section: each shot's club path against its face angle (coloured by whether it finished left or right), the average face, path and smash factor, and a few plain sentences. Where the face was against the path, which one moved more shot to shot, and which one where the shots finished followed.
- Smash factor (ball speed ÷ club speed) is compared with your own pure strikes. If the low runners lose ball speed, it says so, as a measured sign they're struck off the middle rather than just launched low.
- On the Overview, under Gapping, *Face, path and strike* has a row per club and the same sentences.
- Swing readings are now given that club's measured face and path, alongside the distances they already had.

## 2.52.0 — 2026-10-31
- Shot patterns at the range. A block with side numbers now shows a *Pattern*: every shot seen from above, left or right of the target against how far it went, and the oval that holds about 8 in 10 of them. Under it: the centre, how far it leans left or right, how wide and how deep.
- A *Carry / Total* switch shows where the balls landed or where they finished. The phone remembers your choice.
- A club needs 5 shots with side numbers for an oval; with fewer you see the dots and how many more it needs. Tops are left out and counted. Once a club has enough shots to tell, a wild miss (a shank, a big hook) is drawn in red outside the oval and counted, so it doesn't stretch the shape.
- Each block's pattern is compared with your last session with that club, for example "6 m narrower, centre 4 m further left".
- On the Overview, under Gapping, *Patterns by club* draws every club's oval from one tee at one scale, with a table of centre, lean, wide and deep. It uses the same range filters as your distances, and recent shots count more.

## 2.51.1 — 2026-10-31
- A range block's page no longer shows its screenshots and "Read from…" lines between the numbers. They're kept, folded under *Source screenshots* at the foot of the page, below the shot table.

## 2.51.0 — 2026-10-31
- Range screenshots now read more than carry and total: carry side and total side (left or right of the target, in metres), ball speed, club path and face angle, when the shot list shows them. Turn those columns on in the range app before taking the screenshots.
- The review shows those numbers under the shots, with a box to leave them out. They stay with the shot they were read with: change a shot's carry or total and it keeps none of them.
- Screenshots of a session that's already in Carry fill in the numbers its shots are missing instead of adding the shots twice. Shots are matched by carry and total; nothing else on the block changes, and the screenshots are kept with it. Shots that match nothing are named and left out.
- A block's shot table shows the new columns, with a dash where the bay didn't measure one.
- Up to 12 screenshots at a time, up from 6, since a list with more columns shows fewer shots per screen.
- Deleting one of two blocks read from the same screenshots no longer deletes the screenshots the other block still shows.

## 2.50.0 — 2026-10-31
- Courses: the top is two rows now. *Find a tee time* is the one button beside the heading, with *Add course* as a small + next to it. The sort says *Newest* instead of *Recently added*, the map is a pin icon, and *From Home ›* sits at the end of the same row.
- Rounds: *Play* starts a round with GPS (it was *Start round*). *Add past round* replaces *New round* and the screenshots link: it asks whether to type the round in or read it from screenshots.
- The penalty link on Rounds is shorter: *Penalty report · 14 strokes*.
- Swings: one short line under the heading (how many swings, the months they span, how many are read), and *▶ Watch* as the button. The note that readings are interpretations moved to the foot of the page.
- Range sessions name the speed column *Club speed*, which is what Carry reads and stores (never ball speed).

## 2.49.1 — 2026-10-30
- Courses on a map: the pins stand out from the map now. Public courses are sand, members' courses lavender, closed courses red, and courses whose access isn't known grey. The legend matches.
- The Settings gear in the top right is now a simple line drawing, like the sound icon in the swing feed, instead of the emoji gear.

## 2.49.0 — 2026-10-30
- Courses on a map is now drawn like a yardage book: parchment ground with fine hatching, an inked coastline, water with waves, parks stippled and golf courses in fairway green, in the same colours as the hole maps, light or dark.
- Far less clutter: no buildings, boundaries, shops or road numbers; main roads appear only as you zoom in, minor streets never, and only suburb and city names.
- Pins, colours and tapping a pin for its course work as before. On a browser that can't draw it, the map falls back to the plain street map.

## 2.48.0 — 2026-10-30
- Rounds → Add past rounds from screenshots: pick screenshots of past rounds from 18Birdies (or another scoring app), as many as 60 at a time. Claude reads each one's date, course, tee and hole scores, and a full scorecard screenshot after a round's summary adds its putts.
- Every round is shown beside its screenshots to check before anything is saved: fix any number, pick the course if Carry couldn't match it, or untick a round. A round you already have for that course and day comes unticked.
- Pars and lengths come from the course's card in Carry. The rounds count for your handicap, scoring trend and course history, and the screenshots stay with each round.

## 2.47.1 — 2026-10-30
- Courses: the tab could stay stuck on the page you were on (or blank) instead of showing the list. A cached copy of an older map file was being used with the new app; each update now loads its own files fresh, and the list still draws if a file is out of date.
- If a page ever fails to draw, it now says so on screen with the reason, instead of looking frozen.

## 2.47.0 — 2026-10-30
- Courses: each course in the list now has a small picture of the whole course at the left, drawn from its map: the outline, fairways, water and greens, north up. A course without a linked map shows its initials in the same tile.

## 2.46.0 — 2026-10-30
- Every course map now comes with a small picture of the whole course, its outline, fairways, water and greens, ready for the Courses list. It appears there once the list is updated to show it.

## 2.45.0 — 2026-10-30
- Each course's page has a Tee times fold near the top. Open it to see that course's free times for today, from the club's own booking site; once today's times have gone it shows tomorrow. Pick another day or the number of players, and tap a time to book it on the club's site.
- The fold asks the club only when you open it, so browsing courses doesn't. A course Carry can't read shows how to book it instead, and "Other courses this day" opens Find a tee time on the same day.
- Swings: "Watch: n videos" is now top right beside the heading, as the buttons are on Range, Rounds and Courses.

## 2.44.1 — 2026-10-30
- Courses on a map: the streets now show behind the pins. The map service used in 2.44.0 started asking for a key and covered the map in "API key required"; it now uses OpenStreetMap's own map, darkened in dark mode.

## 2.44.0 — 2026-10-30
- Courses: the sort buttons, a new map button and "Distances from…" now share one row, with your location on the right. On a phone the location link drops to its own line, still on the right.
- View on a map: every course with a location is a pin, green for public, grey for members, red for closed, with your home as a square. Tap a pin for the course's name, distance and a link to its page. The map follows light or dark mode, and courses with no location are counted under it.
- Find a tee time: after you pick a day, the row of days stays scrolled to it instead of jumping back to the start, and the page no longer jumps to the top.
- Find a tee time on a computer: clicking *Pick a date* now opens the calendar. Before, it did nothing you could see.

## 2.43.2 — 2026-10-30
- *Pick a date* on Find a tee time no longer closes its calendar a second after opening it. The page was redrawing as each course's times came in; it now waits while a date picker or filter is open.
- Newgreens Chatswood's map no longer shows the old Chatswood course: OpenStreetMap still has the old 18-hole layout, so the map is the course outline only, under its new name, and each hole is drawn from your Mark tee and Mark flag until OpenStreetMap maps the new 12 holes.
- Tee times from GolfNow's TeeItUp pages: the number of spots free on each time now comes straight from what the club's page offers, after the first real search at Georges River showed how GolfNow counts them.

## 2.43.1 — 2026-10-30
- Tee times: the filters now use the same size and weight as the app's other buttons, instead of a larger size of their own. Tapping a menu still opens your phone's picker without zooming the page.

## 2.43.0 — 2026-10-30
- Find a tee time now also reads the clubs that book through GolfNow's TeeItUp pages: Georges River, Marrickville, Palm Beach and Avalon once their imports are loaded again, and Bardwell Valley once its booking link is set to its TeeItUp page. Each time links to the club's TeeItUp page for that day.
- First live search to come: if a TeeItUp course says it couldn't be read, open its tee-times address in the browser and send what it shows.

## 2.42.0 — 2026-10-30
- Tee times: pick any day up to a year ahead with the new Pick a date chip, not just the coming week.
- Tee times: a Max price filter. It goes by each time's own fee, and says when nothing is at or under your price and what the cheapest would be.
- Tee times: the filters take two rows instead of four (Time and Players, then Holes, Within and Max price), and the day chips, buttons and menus are all the same size.

## 2.41.3 — 2026-10-30
- Tee times now searches Gordon and Richmond: their booking links point at their MiClub event list, which Carry didn't recognise, though their calendars read like any other.

## 2.41.2 — 2026-10-30
- Tee times: courses with nothing that suits are now folded together under the ones with times, instead of a long list of "No times left that match". Each says what came closest: times outside your window (and the first of them), times in your window without enough spots, or no rate for the holes you picked.
- Courses: Find a tee time sits beside Add course, on the heading's row.
- Liverpool's booking link pointed at a site that no longer exists; it now points at Oak Point's (the club's name since the merger). Import liverpool.json again to pick it up.

## 2.41.1 — 2026-10-30
- On a course page, the Use this map button no longer sits on the line of Course information below it.

## 2.41.0 — 2026-10-30
- Courses → Find a tee time: free tee times on the clubs' own booking sites for the next seven days. Pick the day, a time window, how many players, 9 or 18 holes and how far from home; the courses with times come first, nearest first, each time showing how many spots are left.
- Tap a time to book it on the club's own page. Carry books nothing and stores nothing; it reads the clubs' public pages when you look, and "Check again" reads them afresh.
- A course with nothing to show says why (nothing public that day, a calendar that needs signing up, or a site that didn't answer). Courses booked another way (Lane Cove, by phone) are listed underneath with how to book; private and closed courses are left out.

## 2.40.1 — 2026-10-30
- Tee times: Moore Park's 12-hole rate is now read as 12 holes, not 9, and a 12-hole round can be asked for.
- When a course has no tee times to show, Carry now says why: nothing open to the public that day (often a members' competition), or a club whose public calendar shows nothing until you sign up on its site (Massey Park).

## 2.40.0 — 2026-10-30
- Carry can now read the free tee times on a MiClub booking site (38 of the courses, Bexley and Moore Park among them): each rate for the day (18 holes, 9 holes, late rates), its price, and every time with how many spots are left. Nothing in the app shows them yet. The search screen comes next.
- Nothing is booked and nothing about you is sent: Carry asks the club's public page for a date, the same as opening it in a browser.

## 2.39.1 — 2026-10-30
- When your Carry sign-in lapses while the app is open, it now renews it the way reopening the app does: one quick trip through Cloudflare, landing back on the same screen with your folds and scroll. The "Signed out" bar should now only appear when Cloudflare really needs you to log in.
- It never does this while a form or a question is open; the bar shows instead, and the trip waits until you close it. Anything you saved meanwhile waits on the phone and is sent after.

## 2.39.0 — 2026-10-30
- Every course now says who can play it: a green "public" tag in the Courses list, "private" for members and guests, "closed" for a course that's gone. The course page says the same under Course information, with how to book (register first, phone the pro shop, walk up).
- The course form asks "Who can play": Public, Private, Closed or Not known. Saving a course whose access wasn't known used to mark it members only; it now stays not known.
- 77 course imports gained their booking link and who can play, found on 2026-10-29. Import them again to see this on courses added in the batch. Kogarah is marked closed (March 2025), and Chatswood's notes say the course was rebuilt with 12 holes.

## 2.38.0 — 2026-10-29
- Import a backup takes any number of files at once: pick them all, answer one question, and each is restored in turn. A file that isn't a Carry export is named and skipped, never silently.

## 2.37.0 — 2026-10-29
- Settings has an Appearance section: System, Light or Dark. System follows your phone, as before; a choice is remembered and the app opens straight into it.

## 2.36.1 — 2026-10-29
- The rest of the app now uses the same palette as the scores: the red edges on tee and penalty practice cards, the lost-stroke bars, warning tags, penalty markers and Delete buttons are the scorecard's muted red, and the sand on short-game and strike cards is the scorecard's bogey sand.

## 2.36.0 — 2026-10-29
- Scores wear a new palette: eagle a deep green, birdie a soft green, bogey sand, double bogey terracotta, worse a muted red; par unchanged. The circles and squares stay.
- In the swing feed, a clip you swipe away from and come back to plays again from the start.

# Changelog

What changed in each version, newest first. The app shows this list
when you tap the title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

## 2.35.0 — 2026-10-29
- Strokes gained: a round page now has a "Strokes gained" fold under "Getting to the green", scoring every traced shot against a published table of expected strokes to hole out (by lie and distance) at a reference handicap, and summing where strokes went: off the tee, approaches, around the green, sand, recovery, putting. The two biggest losses are the teaser.
- The Overview's detail has the same across your recent fully traced rounds, per 18 holes, recent rounds weighted more; it needs three.
- A practice card for tee shots, approaches, the short game or putting says what that is costing a round, as a read-only estimate.
- Settings: which golfer you are measured against, nearest your estimated handicap unless you pin one (scratch to 30).
- It is an estimate against a published table, worked out on every draw and never stored, and it changes nothing about the practice list, the plan or the armed club.

## 2.34.1 — 2026-10-29
- Score colours: a double bogey is the lighter orange-red and worse a Ferrari red (the dark maroon is gone), on the scorecard, the hole strips and the key.

## 2.34.0 — 2026-10-29
- Scores are marked the way a scorer marks a card: a circle for a birdie, a double circle for an eagle or better, a square for a bogey, a double square for a double bogey or worse; par stays plain. The colours are unchanged. On the scorecard, the hole strips and the key.

## 2.33.0 — 2026-10-28
- Swings: tapping a swing in the timeline opens its reading card (the same card the feed's caption opens), with one link on to the session or round.
- Swings, by club: instead of listing every reading again, each club now shows what the readings keep pointing at (wrist, hands and arms, body turn, head and posture, clubface, path, setup, tempo), how often and over what span, which theme is new or recurring, the progression period by period, and a short pattern line; the latest fix stays. "Read across these readings" is still the full reading across them.

## 2.32.1 — 2026-10-28
- Swings feed: the thin progress bar now sits right on the tab bar, with the caption directly above it and no gap between the three.
- The bar fills smoothly as the clip plays (every frame, not in steps), and dragging it scrubs without the stutter: the bar follows your finger at once and the clip catches up once a frame.

## 2.32.0 — 2026-10-28
- In the swing feed, tap the clip to turn sound on or off: the speaker flashes in the middle of the clip and fades. The corner button is gone.
- A thin bar under the caption follows the clip as it plays, and dragging across it moves to that point in the clip.
- The "n of N · swipe up" line is gone.

## 2.31.3 — 2026-10-28
- In the swing feed the tab bar is the same solid bar as everywhere else; the clip ends at the bar instead of running under it.

## 2.31.2 — 2026-10-28
- Being signed out no longer puts a sheet over the screen. One refused check is ignored, then the app signs in again silently in the background; only if that fails does a small banner appear at the top with a Sign in again button, and what's on screen stays. A toast says when you're back in.

## 2.31.1 — 2026-10-28
- The bare strip under the tab bar is gone. It came from iOS itself when the app ran under the status bar, so the app no longer does; the swing feed starts below the status bar again, with everything else from 2.29.0 kept.

## 2.31.0 — 2026-10-28
- 53 more Sydney courses have course maps. Seven are partly mapped in OpenStreetMap: Everglades, Monash, Chatswood, Macarthur Grange, Cammeray, Eastlake and Ryde Parramatta.
- Holes OpenStreetMap hasn't drawn come from your Mark tee and Mark flag in Play, as at Lane Cove: Chatswood 3 and 9, Cammeray 6 and 9, Macarthur Grange's back nine, and all but the 1st at Eastlake and Ryde Parramatta.
- Where OpenStreetMap has no green (all of Everglades and Macarthur Grange, most of Monash), the green is an estimate on its pin: the middle distance only, and you pick the lie there.
- The other sixteen: Bayview, Gordon, Liverpool, Muirfield, North Turramurra and Pennant Hills with all 18 holes; Cabramatta, Castle Cove, Cronulla, Leonay, Macquarie Links, Marrickville, North Ryde, Roseville, Wakehurst and Warringah with every hole from your marks, over the greens, bunkers and trees OpenStreetMap has.
- 30 more: Antill Park, Boomerang, Camden, Campbelltown, Canterbury, Carnarvon, Castle Hill, Cromer, Cumberland, Kareela, Killara and Woolooware with every hole; Avalon, Balgowlah, Concord, Del Rio, Fairfield City, Fox Hills, Gosford, Hawkesbury Waters, Kingdom Estate, Kurrajong Hills, Orchard Hills, Palm Beach, Sefton, Springwood, Sylvania Par 3, Wallacia Panthers, Windsor and Woodville as outlines whose holes come from your marks.
- A flag you mark on a mapped green now takes that green: distances to its front, middle and back, and a green lie when your ball lands on it, instead of a dashed estimate.

## 2.30.3 — 2026-10-28
- The swing feed no longer sits high on the screen with bare black under the tab bar: the page behind the feed is held still while it is open.

## 2.30.2 — 2026-10-28
- In the swing feed the clip now shows through the tab bar instead of a black band: the caption's dark shading stops at the bar, and the bar is a touch more see-through.

## 2.30.1 — 2026-10-28
- The swing feed no longer slides sideways: the blurred backdrop behind a clip is clipped to the screen, so a clip can't be pushed off to one side.

## 2.30.0 — 2026-10-28
- Seven more Sydney courses have course maps ready, each with all 18 holes and real greens: Avondale, Brighton Lakes, Kogarah, Mona Vale, NSW, St Michael's and The Lakes.
- Kogarah's 16th, 17th and 18th play down the same fairways as the 1st, 2nd and 10th, so their maps are those holes' maps; the card check will say if their tees differ.
- To use one, add the course with its card, then link its map on the course page.

## 2.29.0 — 2026-10-28
- Watching swings keeps the tab bar in view, translucent and blurred over the video, so you can leave the feed from the bar as from any page.
- The feed runs under the status bar at the top, around the clock, signal and battery, the way Instagram does; the rest of the app keeps a solid strip there.
- A clip that doesn't fill the screen gets a blurred, darkened still of its own swing behind it instead of black bars.

## 2.28.0 — 2026-10-28
- 27 more Sydney courses have course maps ready, every one fully mapped in OpenStreetMap with real greens, tees, bunkers and water: Asquith, Auburn, Bankstown, Bonnie Doon, Botany, Colonial, Dunheved, Elanora, Georges River, Glenmore Heritage Valley, Lakeside Camden, Lynwood, Manly, Moore Park, Oatlands, Penrith, Pymble, Richmond, Royal Sydney, Shortees, Stonecutters Ridge, Strathfield, Terrey Hills, The Australian, The Ridge, Twin Creeks and Woollahra.
- To use one, add the course with its card, then link its map on the course page; the card check compares the two.
- Moore Park's map is the interim ten holes, as you play it now. On your blue card, holes 3 and 7 differ from the map, so the course page flags them.
- Manly's 14th is left off its map for now: OpenStreetMap has two different 14th holes, and your card will say which one is played.

## 2.27.2 — 2026-10-28
- The feed is simpler: no club chips; a bare back arrow at the top that reads on light or dark video; the sound button sits above the caption on each clip.
- A swing's card opened from the feed no longer shows a strip of content scrolling past under the Close button; the same fix applies to every sheet in the app.

## 2.27.1 — 2026-10-28
- A heading with buttons beside it (Blocks, Swings, Bag) now has room above and below: the buttons no longer sit on the line before or the text after.

## 2.27.0 — 2026-10-28
- Five tabs: Swings · Range · Overview · Rounds · Courses, with Overview in the middle as a green pill. Swings is the swing history, with Watch one tap in; it is no longer a link inside Range.
- The feed's club chips are no longer clipped at the top, the video sits centred with even black above and below instead of a band under the chips, and the sound button is a drawn speaker (waves on, a cross off) rather than an emoji.

## 2.26.0 — 2026-10-28
- Swing frames can be packed around impact: the trim has an Impact slider; move it to where the club meets the ball and 10 of the 16 frames sit from 0.3 s before it to 0.1 s after, about 0.04 s apart, with the rest spread over the backswing and finish. Unmarked, the frames stay evenly spaced as before. The reading is told where the frames are packed, and the swing card says so.
- The trim preview no longer stays black: it was asking the decoder for the very first instant of the clip, and on an iPhone a video that has never played shows nothing. It now starts a frame in and plays and pauses once so the picture appears. A clip the browser can't decode says so instead of showing an empty box.
- The swing video feed has a sound button: videos start quiet so they can play on their own, and one tap turns the sound on for the clip on screen.
- Tapping a caption in the feed opens that swing's card over the video (the reading, or "not read yet") with one link on to the session or round, instead of leaving the feed for the whole session page.

## 2.25.1 — 2026-10-28
- Spacing fixed throughout: the bag in Settings is a list of rows that fits a phone (the table hid the measured carry and the Edit button off the edge), there is room between the practice list's review folds and the plan button, before Delete buttons, after rows of buttons and before the next heading, the video feed's club chips sit clear of the video, and course and session headings no longer carry stray punctuation ("Nineteenth GC," or ". Par 36").

## 2.25.0 — 2026-10-28

- Swing history has a "Watch" button: your swing videos one to a screen, newest first, swipe up for the next. Each plays on a loop as it comes into view, with the date, where it was filmed, the club, the angle and the reading's fix over the bottom; tap those to open the session. Chips at the top narrow it to one club, to flick through, say, the 7i swings across months. Only the video on screen and its neighbours are loaded.
- A swing keeps its video up to 60 MB now (it was 20), so a slow-motion clip of 15 seconds or so is stored and plays in the feed. Only swings with a stored video appear there.

## 2.24.0 — 2026-10-28

- Swing history: each club's fold has "Read across these readings". It sends that club's swing readings (the text only, no frames) and the club's ball data to Claude for one reading across them: the thread they keep coming back to, what the later readings no longer see, what is still there, the one thing to carry to the next session, a confidence and the main reason it could be wrong. Needs two readings; nothing is read unless you press it.
- The result is kept with the club and shown on the fold, labelled a reading of readings, not a measurement, and says how many newer readings have come since so you know when to read again. Editing a club in the bag keeps it.

## 2.23.0 — 2026-10-28

- Range → "Swing history": every swing you've filmed in one timeline, newest first, each flagged range or course with the date, the venue or course, the club, the camera angle, a frame, and the one fix its reading gave (or "not read yet"). Tap one to open the session or round it was filmed in.
- Above the timeline, a fold per club put together from the readings: how many swings and over what span, the fix reading by reading with whether the ball data agreed, the latest wrist answer, and a note when the fix has changed between readings. Nothing new is read; it's a summary of what's already on file.

## 2.22.0 — 2026-10-28

- A round's page has a new fold under the scorecard, "Getting to the green": for each hole, the long shots it took to reach the green, the chips, the sand shots and the putts, with the totals and a short account of where the strokes went ("55 strokes, of which 24 got the ball to the green and 31 were spent from inside 60 m"), and how many long shots the par 3s, 4s and 5s took on average.
- On a hole with traced shots the numbers come from the shots (inside 60 m is a chip, from a bunker is a sand shot). On a scores-only hole, tap in the putts, chips and sand shots under "Tap them in" and the long shots are what's left; it refuses a count that would exceed the hole's score.

## 2.21.0 — 2026-10-28

- Bexley has a course map. Link it from the course page and every hole is drawn from OpenStreetMap: real greens, tee boxes, fairways, bunkers and water, so tapping a shot reads the lie from where it lands.
- Checked against your card for the blue, white and red tees: every tee lands on a mapped tee box, so nothing is flagged.
- In Play, Bexley's greens are mapped shapes, so you get the front, middle and back distances.

## 2.20.3 — 2026-10-28

- A round typed into the round form now records the lengths of the tee you picked. It used to copy the course's main tee whatever you chose (a red-tee round at Moore Park kept the blue lengths), and changing the tee now re-fills the lengths, leaving any you typed yourself. Distances were already worked out from the right tee, so nothing you've seen changes; the round's own copy of the card is now right too.

## 2.20.2 — 2026-10-27

- A 10-hole round's scorecard is one table of ten with its total, not a nine plus a lonely tenth hole labelled "In". A 12-hole card shows as two sixes.
- Today's round no longer offers "Play: hole n" once every hole is scored.

## 2.20.1 — 2026-10-27

- "Import a backup" lets you pick any file. The picker only offered files the phone had typed as JSON, and a file saved from GitHub or Mail on an iPhone is usually typed as plain text, so the export file was greyed out. The file is still checked before anything is imported.

## 2.20.0 — 2026-10-27

- Moore Park Golf is ready to import (`imports/moore-park.json`): the 10 holes it plays while its 12-hole course is built (holes 1–10 of the old layout, par 38; blue, white and red tees in metres from the club's own course page, stroke index re-ranked for ten holes, fees, booking link). The club says an interim 12-hole layout opens on 2 November; add its two temporary holes to the card when the club publishes them.
- A scorecard can now be 10 or 12 holes as well as 9 or 18. The course and round forms offer all four, a 10-hole course is no longer shown as an 18-hole card with eight holes missing, and a round there prefills ten holes and is scored as ten.
- A round on a 10- or 12-hole card is listed under the handicap as not counting, with the reason: only 9- and 18-hole cards are rated. It no longer asks for a rating it could never use.

## 2.19.0 — 2026-10-26

- The app now checks its own practice list. Under "What to practise", "Is this list right?" says how each finding resolved: quiet after range work on its club, quiet without any, faded with time, or worked on and still showing. Once enough have resolved it says whether findings go quiet more often after range work than without it, which is the test of whether the list points at the right things. It never claims the practice caused the change.
- "How this is ranked" now shows the rules behind the list: what each kind of miss costs, when a finding goes quiet, when a club is flagged for strike. They are judgements, and shown so you can disagree with them.
- "What the readings couldn't see" counts, by camera view, what the swing readings said their angle or frames couldn't answer. A thing that keeps coming up is a question for the camera or the trim, not the swing.
- The Overview's Gapping says how far the carries you've put in the bag sit from what the range measures, and which club is furthest off.

## 2.18.0 — 2026-10-26

- A swing now gives Claude 16 frames instead of 8. The downswing takes about a quarter of a second, and 8 frames across a clip left at most one in it, so no reading could say when the wrist angle went. On a tight trim of about 1.5 s the frames are about 0.1 s apart: three in the downswing. Swings already saved keep their 8.
- The trim hint under the video says what you'll get ("16 frames, 0.10 s apart across 1.5 s") and warns when the frames are too far apart to see the downswing. Each swing's card shows its spacing too.
- Down-the-line readings are asked the cast-or-flip question outright: the lead wrist at the top (cupped, flat or bowed) and whether the shaft-to-arm angle is still held when the lead arm is parallel on the way down, answered from those frames only or "cannot tell". The answer is under "What Claude saw". Claude is also told each frame's time, and to name the frames nearest the top and impact before reading between them.
- Moving a round from the hole pictures onto the map now goes through the map's own rule only (the app's copy from 2.17.0 is gone).

## 2.17.1 — 2026-10-25
- Moving a round from the hole pictures onto the map now uses the map's own rule for where a tap lands, so it can't drift from how the map is drawn. Where your shots land is the same as in 2.17.0.

## 2.17.0 — 2026-10-25

- Hunter Valley's old rounds can move onto its new map. On the course page, "Rounds traced on artwork" lists what was traced on the uploaded hole pictures and offers to move those shots onto the map: each shot keeps its place along the hole and its distance to the side, then its distances come from the map like any other map shot.
- It's approximate (the picture was a drawing, the map line is OpenStreetMap's) and never automatic: you press the button and confirm. The artwork position is kept on each shot.

## 2.16.0 — 2026-10-25
- Hunter Valley has a course map. OpenStreetMap now has all 18 holes there, so link it from the course page and every hole is drawn, with the card checked against it. Rounds already traced on the artwork stay on it.
- Hunter Valley's greens aren't mapped yet, so each one is estimated on its flag and drawn dashed, as at Hurstville. You pick the lie there, and Play shows the distance to the middle only.
- Barnwell Park, Beverley Park and Lane Cove now show the trees and bush mapped there since September, and a tap in them reads as trees.

## 2.15.0 — 2026-10-25

- A round has a format: solo (the default), Ambrose / scramble, best ball, or another team format. Set it on New round, Edit round and Start round.
- A team round is your card, not your game alone, so it's kept and shown in your rounds and a course's history, labelled, but left out of the handicap (listed with the reason), Current form, the scoring trend, course averages and the practice list's evidence.
- To mark the Lane Cove Ambrose of 25 Oct: open the round, Edit, Format → Ambrose, Save.

## 2.14.0 — 2026-10-25

- A read-only window for the monitor: `GET /api/admin/health`, `/activity` and `/data`, open only to one Cloudflare service token (its Client ID in `CF_ACCESS_MONITOR_ID`). Nothing under it can write, a person's sign-in is refused there, and the service token is refused everywhere else.
- It shows your own documents and the shared courses only, never a friend's: not their records, not counts, not their request lines. Without `OWNER_EMAIL` it shows the server's health and nothing else.
- Nothing changes in the app itself. Leave `CF_ACCESS_MONITOR_ID` empty and the endpoint doesn't exist.

## 2.13.0 — 2026-10-25

- Four tabs instead of five: Overview, Range, Rounds, Courses. The Bag has moved into a Settings page behind the gear at the top right, with everything you set once: your clubs, which range shots count (the window, weighting and ball filters, which used to sit inside the Overview's Gapping section), your location, export and import, and who's signed in.
- "Range vs course" (how your on-course distances compare with the range) is now a fold under The detail on the Overview, next to Putting and Evidence, with its one number on the fold.
- The Overview's Gapping section shows the range filter as one line ("All time · recent shots count more · all balls · change") instead of the whole panel.
- A phone that last had the Bag tab open opens Settings.

## 2.12.2 — 2026-10-25

- The line above the practice list is just the counts: "18 holes traced · 229 range shots · 15 swings · newest 21 Oct". Scorecard-only rounds are mentioned under "How this is ranked" instead.

## 2.12.1 — 2026-10-25

- The line above the practice list (and under Next practice on the Overview) is one line: "18 holes traced · 229 range shots · 15 swings · newest 21 Oct". The full sentence, and that it's recalculated on every draw, is under "How this is ranked".

## 2.12.0 — 2026-10-25

- The practice list reads like a coach's note: each item is what's wrong, what to hit (club, target and the drill), whether it's getting better, and Practise this. The list of every shot behind it, the ball-data sentence and the hole links have moved to the item's own page under "The evidence".
- "Approaches clubbed short" sums up by club ("7i ×6 from 137–177m, stock 112m") instead of listing every shot, and its on-course note says where most of them were from.
- A swing video that backs an item is one line on the card ("video agrees …"), the full reading on its page.
- "How this is ranked" is folded under the list's summary line.

## 2.11.4 — 2026-10-25

- The practice list weighs evidence by whole days, so the same finding gets the same weight on every draw. Nothing visible changes; a publish had failed on a test that caught two draws disagreeing in the tenth decimal.

## 2.11.3 — 2026-10-25

- Add a swing: the "Video" label no longer runs into the file picker; the picker sits on its own line.
- A swing reading from before 2.11.0, whose fix is a whole paragraph, is shown in body type rather than as a headline. New readings are unchanged.

## 2.11.2 — 2026-10-25

- Double-tapping no longer zooms the page, and tapping into a field no longer zooms in on it. Pinch-to-zoom still works.
- The hole logger's lie and club chips for the last shot sit in one labelled box ("Shot 3: PW, green. Correct its lie or club here"), so they aren't mistaken for the next-shot chips above them.
- The Bag table fits a phone: its headings wrap instead of pushing the measured carry off the screen.
- A finding's page says "fairways hit" under "1 of 2 fairways", not "missed the fairway".
- A range session's source reads "Toptracer", not "toptracer"; "1 scorecard-only rounds" is now singular; the Courses list puts its tags after the words; the practice list's ranking note is one sentence.

## 2.11.1 — 2026-10-24

- Editing a round through its form (date, notes, tees) no longer drops penalties ticked on a shot from that hole's score.
- A penalty ticked on the shot that cost it now counts towards "Penalty strokes" on the practice list, as one added with the hole's counter always did.
- A round logged off "Blue" tees now uses the card's blue lengths: the tee name is matched ignoring case instead of falling back to the main tee's distances.
- A shot whose lie was never picked (unmapped ground on a course map) is no longer counted as a missed fairway or green; it's left out of those counts.
- Tapping a missing hole on a round's hole grid opens the course to add it, instead of failing.
- A course's best score is the best full round there, not a 9-hole total beside an 18.
- A round that hasn't been scored yet is listed as "not scored yet" rather than 0 +0.
- A booking link on a course is only shown when it's a web address.

## 2.11.0 — 2026-10-24

- A swing reading now comes back the way a coach gives it: the one fix, why (with the frame that shows it), a feel to take to the ball, one drill and how to know it's working.
- Everything behind it (what Claude saw, how it matches your ball data, what the camera angle can't show) is folded under "What Claude saw".
- Readings you already have keep their words: the fix and drill stay on the card, the rest folds away. Tap "Analyse again" for the new layout.

## 2.10.0 — 2026-10-24
- On a hole the course map hasn't drawn yet (Lane Cove, Barnwell Park and Beverley Park on your first visit), "Mark my ball here" now works: it saves where your ball is by GPS, even though there are no distances to show yet.
- Once your tee and flag marks draw the hole, those shots are measured from your real tee, so a first round there counts in full. Until then they show as not measurable rather than a guess.
- The hole logger won't let a tap on the drawn outline mix with GPS-marked shots on the same hole.

## 2.9.0 — 2026-10-22
- A course's Edit form has "Paste a scorecard": paste lines like "1: 4 / 260 / 16" (par / metres / stroke index), tap Fill, check the card, then Save. If the text names the tee ("blue tees"), that tee is set too.
- It refuses a card it can't read cleanly (a hole twice, a hole missing, an odd par) and says what's wrong, rather than half-filling it.
- When a save changes a hole's par, rounds already played there are offered the new pars. Your scores stay as they are; only over or under par changes.

## 2.8.0 — 2026-10-21
- Hurstville's holes had the wrong numbers: the map numbered them from the old clubhouse, so the front and back nines were swapped and every hole showed a different hole. They're renumbered now, so hole 1 is the hole you tee off first today.
- Checked against your GPS app's blue card for all 18: 17 tees land on a mapped tee, within 12 m of the card. Hole 18's blue tee is 38 m ahead of the one on the map, so the course page flags it and the tee is placed from the card.
- Shots you've already logged at Hurstville stay where you tapped them, and are measured on the right holes now. Flags you marked on 21 October count towards their own hole's estimated green.

## 2.7.0 — 2026-10-20
- Gapping shows where each club's shots actually land: the middle half of them, and 8 in 10, drawn on the bar ("middle half 110–130m").
- A round's page shows a proper scorecard: par, score (coloured against par), putts and penalties, with the totals for each nine. Tap a hole to open it.
- Each practice finding has a round-by-round chart: how often it happened in each round, with a line where you practised it at the range.
- On a course's hole page, tap a dot to see that shot: the date, club, how far it went and where it finished, with a link to that round's hole.
- Fixed: numbers for rounds traced on a course map could leave those shots out (from the practice list, where your game is being tested and approach distances) if the map was still loading when the numbers were first worked out.

## 2.6.0 — 2026-10-20
- Each thing on your practice list now has its own page: what it is now, the drill, the range sessions that worked on it, and the holes where it showed up. Tap it from the Overview, the Range tab or a round.
- "Practise this" adds that one drill to your planned range session, or plans a new one, so you don't have to set it up again.
- A round now shows what it revealed: each finding with how many times, the club, the holes, and a button to practise it.
- Screenshots for a planned club fill that planned block, so the session shows "2 of 3 planned blocks hit" and then "Plan done".
- After your next round, the finding shows before and since: for example "Since the range on 9 Oct: 4 of 9 came up short (44%), against 9 of 9 (100%) before". It tells you what happened, not that the practice did it.
- A range block compares itself with the last time you hit that club: median carry and how many were low runners or tops.

## 2.5.0 — 2026-10-20
- The Overview is shorter and leads with the answer: how you're playing (last score, over par a hole, handicap) and your next practice — the club, the target and the drill, with the one button to plan the range session.
- The next two things costing you are short rows with their evidence; tap one for the full reasoning on the Range tab.
- Everything else is still there, one tap down: putts, fairways and greens, how the handicap is worked out, distance gaps, strike profile, best rounds, where your game is being tested, approach distances, putting and evidence. Each folded row shows its key number.
- The range filter now sits with the gapping numbers it changes.
- A course page shows its holes and your rounds there first; booking, fees, ratings and notes are folded into "Course information".

## 2.4.0 — 2026-10-20
- Barnwell Park, Beverley Park and Lane Cove have course maps now. OpenStreetMap only has their boundaries, so their holes come from you: on each hole in Play, Mark tee on the tee and Mark flag at the hole, and from then on the course draws that hole for you and anyone who plays there.
- A hole drawn from your marks runs from your tee mark to the average of your flag marks, with the green estimated (dashed) where the flags are. Distances to the green are to the middle only, and you pick the lie, as on any green that isn't mapped. The legend says what came from your marks.
- At Hurstville, flag marks move a hole's estimated green to where the flags actually were.
- A mark that doesn't agree with the others on a hole (a flag marked on the wrong hole, say) is left out, and if two marks disagree the hole isn't drawn until there are more to go on. You can remove your own marks on the hole's page.
- The course page lists which holes are drawn from your marks and which are still waiting for them.

## 2.3.0 — 2026-10-19
- On holes the course map can't draw yet (Barnwell Park, Beverley Park, Lane Cove, and Hurstville's estimated greens), Play mode offers "Mark tee" and "Mark flag". One round of marks lets the map draw those holes, for you and anyone who plays there.
- Marks need a good GPS fix (±10 m or better); if it's rougher, the app asks you to move into the open and try again.
- A hole's page shows how many marks it has, and you can remove your own. Other players' marks stay.

## 2.2.0 — 2026-10-19
- Hurstville has a course map: link it from the course page and every hole is drawn from OpenStreetMap, with the card checked against it.
- Hurstville's greens aren't mapped yet, so each is an estimate on the flag, drawn dashed and labelled "Estimated green (not mapped)". A tap there doesn't set the lie (you pick it), and Play mode shows the distance to the middle only, not the front and back.

## 2.1.1 — 2026-10-19
- The bottom of every page is no longer hidden behind the tab bar on an iPhone; the last button (like "End round here") now sits clear of it.
- "Mark my ball here" is bigger and has room between it and the course map.
- The line over the selected tab is straight again, without the rounded box behind it.

## 2.1.0 — 2026-10-19
- Play mode: Rounds → Start round when you're at the course. It picks the course you're standing at, and you choose your tees and whether you start at hole 1 or 10.
- Each hole shows where you are on the course map, the distance to the front, middle and back of the green, and how far to reach and to carry the hole's bunkers and water ahead of you.
- Stand at your ball and tap "Mark my ball here" (or tap the map) to log each shot, then add putts and penalties. The running score updates as you go, and "Hole 8 →" takes you on once a hole is finished.
- If GPS is rough (worse than ±25 m) it asks before marking, and away from the course it says how far away you are instead of guessing.
- No signal on the course? Saves stay on your phone and are sent when signal comes back; the top of the screen says how many are waiting.
- Today's round has a "Play" button to pick up where you left off. Courses without a map can still be scored hole by hole.

## 2.0.0 — 2026-10-19
- You sign in with Cloudflare Access (the email one-time PIN) instead of pasting an access token. The token is gone.
- Carry only opens at its Cloudflare address now, at home too: the NAS's own address shows a note saying where to open it instead.
- Friends can use Carry: add their email to the Access policy. Each person has their own clubs, rounds, range sessions and swings; courses are shared, so one person's fix to a scorecard is everyone's.
- Bag shows who you're signed in as, with a Sign out button. When your sign-in expires the app says so and offers to sign in again.
- A course someone else has played on can't be deleted, and the app says why.
- On the first start, your existing data becomes yours (set OWNER_EMAIL to your Access email), and a copy of the old database is kept beside it as carry-before-2.0.0.db.

## 1.15.0 — 2026-10-19
- Northbridge now has a course map: all 18 holes from OpenStreetMap, with its tree-lined holes drawn. Turn it on from the course's page; the page checks the map against your scorecard and flags any hole that doesn't fit.
- Behind the scenes, course maps can now place a GPS position on the hole and measure to the front, middle and back of the green, ready for Play mode.

## 1.14.0 — 2026-10-19
- Long Reef now has a course map: all 18 holes from OpenStreetMap, checked against your white tees.
- Holes 4, 11 and 16 are flagged: your white tee lands more than 15 m from any mapped tee box, so it's placed from the card distance alone.

## 1.13.1 — 2026-10-19
- A round you didn't finish (out of daylight, or cut short) no longer makes the round page zoom out on a phone: the holes you didn't play show as small dashed squares in the grid, and "Tap a hole…" sits below them again.
- The Rounds list says when a round is short, e.g. "14 of 18 holes", so its score isn't read as a full round.

## 1.13.0 — 2026-10-14
- The course scorecard editor has a stroke index (SI) column, so a course without one (like Randwick) can have it added, and a wrong one fixed.
- Each hole's SI must be between 1 and the number of holes, and no two holes can share one; the app says which number is wrong.

## 1.12.0 — 2026-10-14
- Massey Park now has a course map: all 18 holes from OpenStreetMap, checked against your red tees. No hole is flagged.
- Hole 9 has no red length yet (your GPS app doesn't show one), so on the reds it measures from the blue tee until the red length is known.

## 1.11.0 — 2026-09-28
- Bondi Golf & Diggers Club now has a course map: all nine holes from OpenStreetMap. Turn it on from the course's page under "Course map".
- Hole 8 is flagged: your tee lands 20 m from the nearest mapped tee box.

## 1.10.0 — 2026-09-28
- A course map now has a legend under it, when you log shots and on each hole's page: what the green, fairway, estimated fairway, tee box, bunker, water, trees, rough, paths, your tee, your shots and the distance rings look like.
- It lists only what that hole shows, so a hole with no water has no "Water" entry. It uses the map's own colours, in light and dark mode.

## 1.9.0 — 2026-09-28
- The Coast now has a course map. Holes 4 and 14 aren't mapped on OpenStreetMap, so they use the tees and greens you confirmed.
- The course page now flags a hole only when your tee doesn't land on any mapped tee box. OpenStreetMap often measures from the back tee, so a scorecard 60 m shorter can still be spot on; a hole is flagged only when neither the line nor any tee box matches your card. Randwick has no flagged holes now, Bardwell Valley has one (11), and The Coast has one (18).

## 1.8.0 — 2026-09-28
- Holes can now be drawn from the course's real shapes on OpenStreetMap, in a yardage-book style that also has a dark version: greens, tees, fairways, bunkers, water and trees where they're mapped. Randwick and Bardwell Valley have maps; turn one on from the course's page under "Course map".
- On a mapped course, distances are real metres. Your tee sits its scorecard distance from the middle of the green, along the hole line, so the card always sets the length.
- The course page lists any hole whose card and mapped line are more than 10% apart, and that hole's own page says whether the tee sits ahead of or behind the mapped tee box.
- Par 4s and 5s without a mapped fairway get a dashed, estimated fairway. It's there to help you see the hole, and never decides a lie.
- Where you tap sets the lie from the shape underneath (bunker, water, green, fairway, trees). Where nothing is mapped, including the estimated fairway, you pick the lie yourself; it's never assumed to be rough.
- Holes you've already traced on the drawn outline or on artwork stay that way for that round. Turning a map off keeps every shot, and turning it back on measures them again.

## 1.7.0 — 2026-09-27
- The Courses list can be sorted by Closest, Recently added or A–Z. It starts on Closest when your location is set, and on Recently added otherwise; the order you pick is remembered.
- Courses with no location sort last under Closest, and courses added before the app kept the date sort last under Recently added, both A–Z, with a note saying so.

## 1.6.3 — 2026-09-27
- Handicap ratings on a course now have a row for every tee you've played there, not just the tees on the scorecard, with how many rounds you played off each.
- There's also an "Another tee" row, to add the rating and slope for a tee you haven't played yet.

## 1.6.2 — 2026-09-27
- Club distances weigh every shot from the same day exactly the same, so a number can no longer come out a hair off (like 125.25000000025 instead of 125.25). A shot from today now counts fully, and one from 60 days ago exactly half.

## 1.6.1 — 2026-09-27
- When there's no handicap estimate yet, the Overview now lists every round that can't count and why, instead of just showing a dash.
- A hole left blank no longer stops a round counting before you have a handicap: it counts as net par, as the World Handicap System does.
- Rounds of 10 to 13 holes now count as a 9-hole score, from the nine with more holes played.
- A tee name typed with different capitals ("White" and "white") now finds its rating.

## 1.6.0 — 2026-09-27
- New on the Overview: an estimated handicap, worked out the way the World Handicap System does it (the system Golf Australia uses), with the scores behind it.
- Each hole is capped at net double bogey (par + 5 until you have a handicap), 9-hole rounds are paired into one score, and an unusually good round lowers it the way the real system does.
- Courses have a new "Handicap ratings" section: type in the course (scratch) rating and slope for each tee from the scorecard. Rounds at a course without them can't count yet, and the Overview lists which courses need them.
- It's an estimate, not an official handicap: it only knows the rounds logged here and makes no playing-conditions adjustment.

## 1.5.0 — 2026-09-26
- Club distances now favour your recent shots: a shot from two months ago counts half as much as one from today, so a swing change shows up in your numbers sooner. You can switch back to every shot counting the same.
- Gapping says how much each number rests on, for example "12 shots · counts like 7 recent".
- New "Range numbers" panel at the top of the Overview: pick the date window, the weighting, and which balls count (all, range balls only, or premium and your own).
- Leave a range session out of your numbers from its page (for example a session on bad mats, or with someone else's clubs); it stays in your history and can be counted again.
- New Penalty report (from Rounds or the Overview): which clubs and shots cost penalty strokes, where the ball went, and which holes keep costing them.
- A block's shot list shows each shot's strike again (pure, runner, short, top); the tags were blank.
- If the app doesn't have your token, it asks for it instead of showing "Storage error: unauthorised".
- The app on the NAS stops straight away on a redeploy, and its log shows saves and errors (re-paste the app YAML once to get this).

## 1.4.0 — 2026-09-26
- The Overview is redesigned as your home screen: how you're playing, what to work on, then the detail behind it.
- New "Current form" at the top: your last score, to par, strokes over par per hole across recent rounds, putts, fairways and greens — each only when your rounds record it.
- "What to work on" shows your top three priorities as cards, each with its evidence and the practice to do, with Plan range session right below.
- Gapping shows how many shots each club rests on, and flags gaps between neighbouring clubs that stand out from your own usual gap.
- Scoring trend adds your per-hole average, best 18 and best 9, and blow-up holes; 9-hole rounds are marked.
- New "Where your game is being tested": how often tee shots, approaches, short game and putts missed their target, and how often a hole had a penalty.
- Approach distances shows the bands you face most, with your nearest measured club beside each.
- Putting shows how many holes have a first-putt distance and how many were estimated.
- New Evidence summary, and a shorter Recent list.
- The strike profile is folded under Gapping.

## 1.3.1 — 2026-09-26
- New rounds and sessions started before 10am are dated today, not yesterday.
- Tapping shots quickly on the hole map no longer loses one.
- The app stays quick as your rounds and range sessions pile up.
- Swing videos stream properly, so they can play on a phone.
- Quick score and the other folded lists stay open while you tap through them.
- A link with your token in it no longer leaves the token in the address bar.
- Stored images and videos can't be opened as a web page, and nothing new is published unless the tests pass.

## 1.3.0 — 2026-09-26
- What to practise now favours recent evidence: something last seen two months ago counts half as much as something from today.
- Each practice item says how fresh it is: still happening, worked on at the range since (not yet tested on course), or quiet.
- Items that haven't happened in enough chances to count as fixed move to a "Quiet lately" list and out of the plan, with the reason.
- The list shows the top five; the rest are folded away.
- Range data now feeds the list: a club that keeps coming off as low runners or tops shows up, and says whether your latest range session still shows it.
- Clubs with no range data yet are listed to measure, even before a course asks for them.
- A newer swing reading replaces an older one of the same club and angle, and a reading about a club with ball data sits with that item instead of on its own.
- Plan a range session now draws on your latest rounds, range sessions and swings, says why each block is there, and replaces an unhit plan instead of adding another.
- Removed "Analyse in a chat": Analyse in the app is the one way to read a swing. Older readings from a chat still show.

## 1.2.0 — 2026-09-26
- Tap "Carry" at the top to see which version and build you're running, and what changed in each version.
- If the server has a newer version than the one open on your phone, the app tells you to close and reopen it.
- Redeploying on the NAS now always fetches the new version instead of restarting the old one (after you paste the updated app YAML once).
- The swing video and copy-the-prompt sheets have a Close button instead of a Save button that saved nothing.

## 1.1.0 — 2026-09-26
- New: add range shots from screenshots of the bay instead of typing them. You check every number against the screenshot before it's saved, and the screenshots stay with the block.
- The version you're running is shown next to the title.
- New rounds are saved against the tee of the course you picked, not the first course in the list.
- Re-analysing a swing in the app no longer says it was read in a chat.
- Deleting a block or a session also removes its screenshots, swing frames and videos.
- Deleted swing frames, videos and hole images are now actually removed from the server.

## 1.0.0 — 2026-09-26
- The app as it was when it moved from the Claude artifact to your own server.
