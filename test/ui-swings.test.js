// Swing history (2.23.0): every swing on file in one timeline, newest first,
// flagged range or course with the date and the one fix its reading gave;
// and a summary per club put together from the readings. Nothing new is
// read. Checked on a hand-made set: two 7i readings at the range months
// apart with different fixes, an unread 5W swing on a round.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, card } from './harness.js';

let app, f1, f2, analyseReply = null, analyseSeen = null;
const reading = (one, extra = {}) => ({ one_thing: one, why: 'w', feel: 'f', drill: { name: 'D', how: 'h' }, check: 'c', ball_data: 'agrees', observations: [{ what: one, evidence: 'frame 5', confidence: 'high' }], cannot_tell: ['Wrist angle at the top'], ...extra });
before(async () => {
  app = await startApp({ seed: { clubs: [club('D', 'driver', { order: 1 }), club('5W', 'wood', { order: 2 }), club('7i', 'iron', { order: 4 })], courses: [{ id: 'c', v: 2, name: 'Test GC', tee: 'white', holes: card(9) }] },
    intercept: async (url, o) => {
      if (!url.endsWith('/api/analyse') || !analyseReply) return null;
      analyseSeen = JSON.parse(o.body);
      return new Response(JSON.stringify(analyseReply), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  f1 = (await app.api.upload(Buffer.from('frame-one'), 'image/webp')).id; f2 = (await app.api.upload(Buffer.from('frame-two'), 'image/webp')).id;
  const frames = [{ asset: f1, t: 0.05 }, { asset: f2, t: 0.3 }, { asset: f1, t: 0.55 }];
  await app.api.put('sessions', 's_aug', { id: 's_aug', v: 2, type: 'range', date: '2026-08-03', venue: 'Moore Park range', blocks: [], swings: [{ id: 'sw_a', view: 'dtl', club: '7i', note: 'hooking', frames, analysis: reading('Rotate through the ball', { ball_data: 'contradicts' }), analysedOn: '2026-08-03' }] });
  await app.api.put('sessions', 's_oct', { id: 's_oct', v: 2, type: 'range', date: '2026-10-19', venue: 'Moore Park range', blocks: [], swings: [{ id: 'sw_b', view: 'dtl', club: '7i', frames, analysis: reading('Hold the wrist angle longer', { wrist: { top: 'flat', lead_arm_parallel: 'released', frames: 'frames 6 and 9' } }), analysedOn: '2026-10-19' }, { id: 'sw_c', view: 'face', club: '7i', frames, analysis: reading('Hold the wrist angle longer'), analysedOn: '2026-10-19' }] });
  await app.api.put('sessions', 'r_sep', { id: 'r_sep', v: 2, type: 'round', date: '2026-09-14', courseId: 'c', courseName: 'Test GC', tee: 'white', detail: 'score_only', holes: card(9).map(({ n, par, metres }) => ({ n, par, metres, strokes: par })), swings: [{ id: 'sw_d', view: 'face', club: '5W', frames, addedOn: '2026-09-14' }] });
  await app.waitFor(() => app.E(`allSwings().length`) === 4, { what: 'swings' });
});
after(() => app && app.stop());

test('the timeline lists every swing newest first, flagged range or course, with the date and the fix', () => {
  app.go('swings');
  assert.match(app.text('#swingBasis'), /4 swings from 3 sessions, 3 Aug 2026 to 19 Oct 2026; 3 read/);
  const rows = app.$$('#swingTimeline .swrow');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.querySelector('.t').textContent.replace(/\s+/g, ' ').trim()), ['19 Oct 2026 range 7i Down the line', '19 Oct 2026 range 7i Face on', '14 Sept 2026 course 5W Face on', '3 Aug 2026 range 7i Down the line']);
  assert.deepEqual(rows.map(r => r.dataset.go), ['range:sessionId=s_oct', 'range:sessionId=s_oct', 'rounds:sessionId=r_sep', 'range:sessionId=s_aug'], 'each opens where it was filmed');
  assert.match(rows[0].textContent, /Moore Park range[\s\S]*Hold the wrist angle longer · ball data agrees/);
  assert.match(rows[2].textContent, /Test GC[\s\S]*not read yet/);
  assert.match(rows[3].textContent, /hooking[\s\S]*Rotate through the ball · contradicts ball data/);
  assert.equal(rows[0].querySelector('img.thumb').getAttribute('src'), `/_blob/${f2}`, 'the middle frame as the thumbnail');
});

test('a summary per club is put together from the readings: count, span, the fixes in order, agreement, the latest wrist answer', () => {
  const c = app.J(`swingClubSummary('7i', swingHistory())`);
  assert.equal(c.n, 3); assert.equal(c.read, 3);
  assert.deepEqual([c.first, c.last], ['2026-08-03', '2026-10-19']);
  assert.deepEqual(c.fixes.map(f => [f.date, f.view, f.fix, f.agrees]), [['2026-08-03', 'dtl', 'Rotate through the ball', false], ['2026-10-19', 'dtl', 'Hold the wrist angle longer', true], ['2026-10-19', 'face', 'Hold the wrist angle longer', true]]);
  assert.deepEqual([c.agrees, c.contradicts, c.cantTell], [2, 1, 1], 'the same can\'t-tell line three times counts once');
  assert.deepEqual(c.latest.wrist, null, 'the latest reading is the face-on one, which has no wrist answer');
  const w = app.J(`swingClubSummary('5W', swingHistory())`);
  assert.deepEqual([w.n, w.read, w.latest], [1, 0, null]);
  app.go('swings');
  const folds = app.$$('#swingClubs details');
  assert.deepEqual(folds.map(d => d.id), ['swc_5W', 'swc_7i'], 'bag order, closed folds with ids');
  assert.match(app.text('#swc_5W summary'), /5W 1 swing, none read yet/);
  assert.match(app.text('#swc_7i summary'), /7i 3 readings · latest: Hold the wrist angle longer/);
  assert.match(app.text('#swc_7i'), /3 swings \(Down the line, Face on\), 3 Aug 2026 to 19 Oct 2026; 3 readings, 2 agreeing with the ball data, 1 contradicting it\./);
  assert.deepEqual(app.$$('#swc_7i ol.fixes li').map(li => li.textContent.replace(/\s+/g, ' ').trim()), ['3 Aug 2026, Down the line: Rotate through the ball contradicts ball data', '19 Oct 2026, Down the line: Hold the wrist angle longer ball data agrees', '19 Oct 2026, Face on: Hold the wrist angle longer ball data agrees']);
  assert.match(app.text('#swc_7i'), /The fix has changed between readings/);
  assert.match(app.text('#swc_7i'), /1 thing the readings said they couldn't see/);
  assert.doesNotMatch(app.text('#swc_7i'), /Wrist, latest/, 'no wrist line when the latest reading has none');
});

test('with no swings the page says so, and the Range list has no link', async () => {
  for (const id of ['s_aug', 's_oct']) await app.api.put('sessions', id, { ...(await app.api.get('sessions', id)), swings: [] });
  await app.api.put('sessions', 'r_sep', { ...(await app.api.get('sessions', 'r_sep')), swings: [] });
  await app.waitFor(() => app.E(`allSwings().length`) === 0, { what: 'cleared' });
  app.go('swings');
  assert.match(app.text('#view'), /No swings on file yet/);
});

/* ---------- a reading across the readings (2.24.0) ---------- */
test('the cross-reading button sends the club\'s readings and ball data, no frames; the answer is stored on the club and shown; newer readings mark it stale', async () => {
  // Readings back (the earlier test emptied them).
  const frames = [{ asset: f1, t: 0.05 }, { asset: f2, t: 0.3 }];
  await app.api.put('sessions', 's_aug', { ...(await app.api.get('sessions', 's_aug')), swings: [{ id: 'sw_a', view: 'dtl', club: '7i', note: 'hooking', frames, analysis: reading('Rotate through the ball', { ball_data: 'contradicts' }), analysedOn: '2026-08-03' }] });
  await app.api.put('sessions', 's_oct', { ...(await app.api.get('sessions', 's_oct')), swings: [{ id: 'sw_b', view: 'dtl', club: '7i', frames, analysis: reading('Hold the wrist angle longer', { wrist: { top: 'flat', lead_arm_parallel: 'released' } }), analysedOn: '2026-10-19' }] });
  await app.waitFor(() => app.E(`clubReadings('7i').length`) === 2, { what: 'readings back' });
  app.go('swings');
  assert.equal(app.$('#swc_5W [data-act="crossRead"]'), null, 'no readings, no button');
  const btn = app.$('#swc_7i [data-act="crossRead"]');
  assert.match(btn.textContent, /Read across these 2 readings/);
  const reply = { thread: 'Both readings point at the hands arriving late: the body turns, the club lags, and the face is open or shut by luck.', moved_on: 'The early rotation cue is no longer mentioned.', still_there: 'Wrist release before impact.', carry_forward: 'Keep the lead wrist flat and let the body wait for it', confidence: 'medium', caveat: 'Two readings, one angle, and the first contradicted the ball data.' };
  analyseReply = { text: JSON.stringify(reply), json: reply };
  btn.click();
  await app.waitFor(() => app.E(`(S.clubs.find(c => c.code === '7i').crossReading || {}).on`) != null, { what: 'stored on the club' });
  assert.equal(analyseSeen.json, true);
  assert.deepEqual(analyseSeen.images, [], 'text only: no frames are sent');
  assert.match(analyseSeen.prompt, /2 readings of a golfer's 7i swing/);
  assert.match(analyseSeen.prompt, /3 Aug 2026, Down the line, his note: "hooking":\n  fix: Rotate through the ball[\s\S]*against the ball data: contradicts/);
  assert.match(analyseSeen.prompt, /19 Oct 2026, Down the line:\n  fix: Hold the wrist angle longer[\s\S]*wrist: flat at the top; released with the lead arm parallel/);
  assert.match(analyseSeen.prompt, /could not tell: Wrist angle at the top/);
  assert.match(analyseSeen.prompt, /7i: no shot-level range data yet/, 'the club\'s ball data goes in');
  assert.match(analyseSeen.prompt, /"carry_forward"[\s\S]*"confidence": "high" \| "medium" \| "low"/);
  const cr = app.J(`S.clubs.find(c => c.code === '7i').crossReading`);
  assert.deepEqual(cr.swings, ['sw_a', 'sw_b']);
  assert.equal(cr.carry_forward, reply.carry_forward); assert.equal(cr.confidence, 'medium');
  assert.equal((await app.api.get('clubs', '7i')).crossReading.thread, reply.thread, 'on the server');
  app.go('swings');
  assert.equal(app.text('#cross_7i .one'), reply.carry_forward);
  assert.match(app.text('#cross_7i'), /The thread Both readings[\s\S]*Moved on The early rotation[\s\S]*Still there Wrist release[\s\S]*Could be wrong because Two readings/);
  assert.match(app.text('#cross_7i'), /Read across 2 readings on .*, medium confidence — a reading of readings, not a measurement\./);
  assert.doesNotMatch(app.text('#cross_7i'), /newer reading/);
  assert.match(app.$('#swc_7i [data-act="crossRead"]').textContent, /Read across them again/);
  assert.equal(app.$('#swc_7i [data-act="crossRead"]').className, '', 'not urged while nothing is newer');
  // A third reading arrives: the stored one is marked stale, the button is primary again.
  await app.api.put('sessions', 's_oct', { ...(await app.api.get('sessions', 's_oct')), swings: [...(await app.api.get('sessions', 's_oct')).swings, { id: 'sw_c', view: 'face', club: '7i', frames, analysis: reading('Hold the wrist angle longer'), analysedOn: '2026-10-19' }] });
  await app.waitFor(() => app.E(`clubReadings('7i').length`) === 3, { what: 'third reading' });
  app.go('swings');
  assert.match(app.text('#cross_7i'), /1 newer reading since\./);
  assert.equal(app.$('#swc_7i [data-act="crossRead"]').className, 'primary');
  analyseReply = null;
});

test('a failed cross-reading says why and stores nothing', async () => {
  const before = app.J(`S.clubs.find(c => c.code === '7i').crossReading`);
  analyseReply = { text: 'not json', json: null };
  app.go('swings');
  app.$('#swc_7i [data-act="crossRead"]').click();
  await app.waitFor(() => /expected format/.test(app.text('#crossProg_7i')), { what: 'error shown' });
  assert.deepEqual(app.J(`S.clubs.find(c => c.code === '7i').crossReading`), before);
  analyseReply = null;
});

test('editing the club in the bag keeps its cross-reading', async () => {
  app.go('settings');
  app.act('editClub', { id: '7i' });
  app.fill('notes', 'stiff shaft');
  assert.equal(await app.save(), true);
  await app.waitFor(() => app.E(`(S.clubs.find(c => c.code === '7i') || {}).notes`) === 'stiff shaft', { what: 'saved' });
  assert.equal(app.J(`S.clubs.find(c => c.code === '7i').crossReading.carry_forward`), 'Keep the lead wrist flat and let the body wait for it');
});

/* ---------- the feed (2.25.0) ---------- */
test('the feed shows the swings that have a video, newest first, one to a screen, with the fix over the bottom; a club chip narrows it', async () => {
  const vid = (await app.api.upload(Buffer.from('not really an mp4'), 'video/mp4')).id;
  const s2 = await app.api.get('sessions', 's_oct');
  await app.api.put('sessions', 's_oct', { ...s2, swings: s2.swings.map(sw => sw.id === 'sw_b' ? { ...sw, video: vid } : sw) });
  const s1 = await app.api.get('sessions', 's_aug');
  await app.api.put('sessions', 's_aug', { ...s1, swings: s1.swings.map(sw => ({ ...sw, video: vid })) });
  const r = await app.api.get('sessions', 'r_sep');
  await app.api.put('sessions', 'r_sep', { ...r, swings: [{ id: 'sw_d', view: 'face', club: '5W', frames: [{ asset: f1, t: 0.05 }], video: vid, addedOn: '2026-09-14' }] });
  await app.waitFor(() => app.E(`reelSwings('').length`) === 3, { what: 'videos' });
  app.go('swings');
  assert.match(app.text('#view [data-go="swings:view=reels"]'), /Watch: 3 videos/);
  // A stand-in observer: jsdom has none. Record what gets observed and let the test fire it.
  let cb = null, observed = [];
  app.win.IntersectionObserver = class { constructor(f, o) { cb = f; this.o = o; } observe(el) { observed.push(el); } disconnect() { observed = []; } };
  const played = [], paused = [];
  app.win.HTMLMediaElement.prototype.play = function () { played.push(this.src); return Promise.resolve(); };
  app.win.HTMLMediaElement.prototype.pause = function () { paused.push(this.src); };
  app.go('swings', { view: 'reels' });
  const reels = app.$$('#reels .reel');
  assert.equal(reels.length, 3, 'the swing without a video (sw_c) is left out');
  assert.deepEqual(reels.map(r => r.querySelector('.reelInfo .t').textContent.replace(/\s+/g, ' ').trim()), ['19 Oct 2026 range 7i Down the line', '14 Sept 2026 course 5W Face on', '3 Aug 2026 range 7i Down the line']);
  assert.deepEqual(reels.map(r => r.querySelector('video').getAttribute('preload')), ['auto', 'auto', 'none'], 'the first two load; the rest wait');
  assert.ok(reels.every(r => r.querySelector('video').hasAttribute('muted') && r.querySelector('video').hasAttribute('playsinline') && r.querySelector('video').hasAttribute('loop')));
  assert.equal(reels[0].querySelector('.reelInfo .fix').textContent, 'Hold the wrist angle longer');
  assert.match(reels[1].textContent, /not read yet/);
  assert.equal(reels[0].querySelector('.count'), null, 'no "n of N · swipe up" row (2.32.0)');
  // The caption opens the swing's card over the feed, not the whole session; one link goes on to where it was filmed.
  assert.equal(reels[1].querySelector('.reelInfo').dataset.go, undefined);
  reels[0].querySelector('.reelInfo').click();
  assert.ok(app.sheetOpen(), 'a sheet over the feed');
  assert.match(app.text('#sheetInner h2'), /19 Oct 2026/);
  assert.match(app.text('#sheetInner #reelCard'), /Hold the wrist angle longer/);
  assert.match(app.text('#sheetInner #reelCard'), /a reading, not a measurement/);
  assert.ok(app.$('#reels'), 'the feed is still there underneath');
  app.$('#sheetInner [data-close]').click();
  reels[1].querySelector('.reelInfo').click();
  assert.match(app.text('#sheetInner #reelCard'), /Not read yet/);
  assert.equal(app.$('#sheetInner [data-act="reelOpen"]').dataset.goSession, 'rounds:sessionId=r_sep');
  app.$('#sheetInner [data-act="reelOpen"]').click();
  assert.ok(!app.sheetOpen() && !app.$('#reels'), 'the link closes the sheet and leaves the feed');
  assert.match(app.text('#view'), /14 Sept 2026/);
  app.go('swings', { view: 'reels' });
  assert.equal(app.$('#reels .reelsClose').dataset.go, 'swings');
  assert.ok(app.$('#reels .reelsClose svg'), 'the back control is a drawn chevron');
  assert.equal(app.$$('#reels .reelsTop .chip').length, 0, 'no club chips');
  assert.equal(app.$$('#reels .reelsSound').length, 0, 'no speaker button: a tap on the clip toggles sound (2.32.0)');
  assert.equal(app.$$('#reels .reel .reelFlash').length, 3, 'a centred flash on every reel');
  assert.equal(app.$$('#reels .reel .reelBottom .reelBar .reelFill').length, 3, 'a progress bar under every caption');
  assert.ok(app.win.document.body.classList.contains('reels'), 'the body knows the feed is open (tab bar translucent, status strip hidden)');
  assert.ok(app.$('nav.tabs'), 'the tab bar stays in the page under the feed');
  assert.ok(reels.every(r => r.querySelector('.reelBg')), 'a blurred still of the middle frame fills each clip\'s bars');
  assert.ok(reels[0].querySelector('.reelBg').getAttribute('src').startsWith('/_blob/'), 'the still is a stored frame');

  assert.equal(observed.length, 3, 'every video is watched');
  // The third video scrolls into view: it plays, its neighbour gets loaded, the first pauses.
  const vids = app.$$('#reels video[data-reel]');   // re-read: the feed was rebuilt by the trip out
  cb([{ target: vids[2], intersectionRatio: 1 }, { target: vids[0], intersectionRatio: 0 }]);
  assert.deepEqual([played, paused], [[vids[2].src], [vids[0].src]]);
  assert.equal(vids[2].preload, 'auto'); assert.equal(vids[1].preload, 'auto');
  // Sound: muted until the clip is tapped, then every reel unmuted (only the one on screen plays), with the speaker flashing in the middle of the one tapped; off again when the feed closes.
  assert.ok(vids.every(v => v.muted === true), 'starts muted so it can autoplay');
  vids[2].click();
  assert.ok(vids.every(v => v.muted === false), 'the tap unmutes');
  const live = app.$$('#reels .reel');   // re-read as vids was: the earlier `reels` are the first build's
  const flash = live[2].querySelector('.reelFlash');
  assert.ok(flash.classList.contains('show') && flash.querySelector('svg'), 'the speaker flashes on the reel tapped');
  assert.ok(!live[0].querySelector('.reelFlash').classList.contains('show'), 'not on the others');
  vids[2].click();
  assert.ok(vids.every(v => v.muted === true), 'and mutes again');
  vids[2].click();
  assert.equal(app.E('reelsSound'), true);
  // The bar follows the clip, and a drag seeks it.
  const v2 = vids[2]; let ct = 0;
  Object.defineProperty(v2, 'duration', { get: () => 8 });
  Object.defineProperty(v2, 'currentTime', { get: () => ct, set: x => { ct = x; } });
  ct = 2; v2.dispatchEvent(new app.win.Event('timeupdate'));
  const bar = live[2].querySelector('.reelBar');
  assert.equal(live[2].querySelector('.reelFill').style.width, '25%');
  assert.equal(bar.getAttribute('aria-valuenow'), '25');
  app.E('reelSeek(document.querySelectorAll("#reels video[data-reel]")[2], 0.75)');
  assert.equal(ct, 6, 'seeking sets the clip\'s time from the fraction');
  v2.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(live[2].querySelector('.reelFill').style.width, '75%');
  // While a finger is on the bar the fill follows it, not the clip (2.32.1), and
  // the fill is a fraction, never rounded to a second.
  bar.dataset.drag = '1';
  app.E('reelFill(document.querySelectorAll("#reels video[data-reel]")[2], 0.3125)');
  assert.equal(live[2].querySelector('.reelFill').style.width, '31.25%');
  ct = 4; v2.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(live[2].querySelector('.reelFill').style.width, '31.25%', 'the clip does not move the fill under a drag');
  delete bar.dataset.drag;
  v2.dispatchEvent(new app.win.Event('timeupdate'));
  assert.equal(live[2].querySelector('.reelFill').style.width, '50%');
  const css = app.doc.querySelector('style').textContent;
  assert.match(css, /\.reelBar \{ position: relative; height: 2px;/, 'the bar is the 2px track itself, flush on the tab bar, no padding');
  assert.match(css, /\.reelInfo \{ [^}]*padding: 14px 16px 6px;/, 'the caption keeps no gap above the bar');
  // A club in the link still narrows it (no chips on the bar any more).
  app.go('swings', { view: 'reels', club: '5W' });
  assert.equal(app.$$('#reels .reel').length, 1);
  app.go('swings', { view: 'reels', club: 'D' });
  assert.match(app.text('#reels'), /No videos for the D/);
  app.$('#reels .reelsClose').click();
  assert.equal(app.$('#reels'), null, 'closed, back on the history');
  assert.ok(!app.win.document.body.classList.contains('reels'), 'the body class goes with the feed');
  // Old links still land on the tab.
  app.go('range', { view: 'reels' }); assert.ok(app.$('#reels')); assert.equal(app.E('S.tab'), 'swings');
  app.go('range', { view: 'swings' }); assert.ok(app.$('#swingTimeline')); assert.equal(app.E('S.tab'), 'swings');
  app.go('swings');
  assert.equal(app.E('reelsSound'), false, 'the next open starts quiet');
  assert.ok(app.$('#swingTimeline'));
});
