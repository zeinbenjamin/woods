# Changelog

What changed in each version, newest first. The app shows this list
when you tap the title.

Format: each version is a `## <version> — <YYYY-MM-DD>` heading followed by
`- ` bullet lines. The app parses exactly that, so keep to it.

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
