# Changelog

What changed in each version, newest first. The app shows this list
when you tap the title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

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
