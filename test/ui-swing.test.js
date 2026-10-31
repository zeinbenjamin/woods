// The swing analyzer: frame extraction (never t=0, blank frames retried and
// dropped), analysis through the server, and video ranking below ball data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club, rangeSession, block, sleep } from './harness.js';

/* ---------- a fake decoder with the real browser's timing problem ----------
   A seek reports `seeked` BEFORE the new frame is painted; the frame only
   exists once requestVideoFrameCallback fires. Drawing on `seeked` alone
   gets the previous (or no) frame — which is how blank frames happened.
   Anything earlier than 0.05s, or inside `blank(t)`, decodes as blank. */
function installFakeMedia(win, { duration = 2, width = 1920, height = 1080, blank = () => false } = {}) {
  const log = { videos: [] };
  const realCreate = win.document.createElement.bind(win.document);
  const blankAt = t => t == null || t < 0.05 || blank(t);
  win.document.createElement = (tag, ...rest) => {
    if (tag === 'video') {
      const v = realCreate('video'); let ct = 0, painted = null;
      const rec = { seeks: [] }; log.videos.push(rec);
      Object.defineProperties(v, {
        src: { get: () => 'blob:fake', set() { setTimeout(() => v.onloadedmetadata && v.onloadedmetadata(), 2); } },
        duration: { get: () => duration }, readyState: { get: () => 4 },
        videoWidth: { get: () => width }, videoHeight: { get: () => height },
        currentTime: { get: () => ct, set(x) { ct = x; rec.seeks.push(x); setTimeout(() => v.onseeked && v.onseeked(), 2); } },
        __painted: { get: () => painted },
      });
      v.requestVideoFrameCallback = cb => setTimeout(() => { painted = ct; cb(); }, 4);
      v.play = () => Promise.resolve(); v.pause = () => {};
      return v;
    }
    if (tag === 'canvas') {
      let drawn = null;
      const ctx = {
        clearRect() { drawn = null; },
        drawImage(src) { drawn = src.__painted; },
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(w * h * 4);
          if (!blankAt(drawn)) for (let i = 0; i < data.length; i += 4) { data[i] = (i * 37) % 256; data[i + 1] = (i * 11) % 256; data[i + 2] = 90; data[i + 3] = 255; }
          return { data, width: w, height: h };
        },
      };
      return { width: 0, height: 0, getContext: () => ctx,
        toBlob(cb, type) { const t = drawn; setTimeout(() => cb(new win.Blob([JSON.stringify({ t })], { type: type || 'image/png' })), 1); } };
    }
    return realCreate(tag, ...rest);
  };
  log.restore = () => { win.document.createElement = realCreate; };
  return log;
}

const SEVEN = [[130, 140], [128, 138], [125, 135], [124, 150], [100, 108], [15, 40], [118, 127]];
const frameBytes = i => Buffer.from(`frame-${i}-` + 'x'.repeat(50 + i));
let app, sw, frames, videoId, analyseReply = null, analyseSeen = null;

before(async () => {
  app = await startApp({
    seed: {
      clubs: [club('7i', 'iron', { order: 3 })],
      sessions: [rangeSession('s_data', '2026-09-01', [block('b1', '7i', SEVEN)])],
    },
    intercept: async (url, o) => {
      if (!url.endsWith('/api/analyse') || !analyseReply) return null;
      analyseSeen = JSON.parse(o.body);
      return new Response(JSON.stringify(analyseReply), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  frames = [];
  for (let i = 0; i < 5; i++) frames.push({ asset: (await app.api.upload(frameBytes(i), 'image/webp')).id, t: +(0.05 + i * 0.3).toFixed(2) });
  videoId = (await app.api.upload(Buffer.from('not really an mp4'), 'video/mp4')).id;
  sw = { id: 'sw_1', view: 'dtl', club: '7i', note: 'hooked it', addedOn: '2026-09-02', duration: 1.4, frames, video: videoId };
  await app.api.put('sessions', 's_sw', { id: 's_sw', v: 2, type: 'range', date: '2026-09-02', focus: 'release timing', blocks: [], swings: [sw] });
  await app.waitFor(() => app.E(`!!session('s_sw')`), { what: 'poll' });
});
after(() => app && app.stop());

/* ---------- extraction ---------- */

test('frame extraction never seeks to t=0 and waits for the decoder to paint', async () => {
  const log = installFakeMedia(app.win);
  try {
    const out = app.win.eval(`extractFrames(new Blob(['v'], { type: 'video/mp4' }), { start: 0, end: null })`);
    const ex = await out;
    const seeks = log.videos.at(-1).seeks;
    assert.ok(seeks.length >= 16);
    assert.ok(seeks.every(t => t >= 0.05), `every seek at or after 0.05s, got ${seeks.filter(t => t < 0.05)}`);
    assert.equal(ex.frames.length, 16, '16 frames since 2.18.0, so the downswing gets about three');
    assert.equal(ex.dropped, 0);
    assert.equal(ex.frames[0].t, 0.05, 'the first frame is 0.05s, not 0');
    assert.ok(ex.frames.every(f => f.t >= 0.05));
    // Each stored image is the frame that was asked for, not the one before it.
    for (const f of ex.frames) {
      const drawn = JSON.parse(await f.blob.text()).t;
      assert.ok(Math.abs(drawn - Math.min(f.t, 1.95)) < 0.01, `frame for ${f.t}s shows ${drawn}s`);
    }
  } finally { log.restore(); }
});

test('a blank frame is retried a little later; one that stays blank is dropped', async () => {
  // 0.55–0.6s decodes blank once (recovers on the nudge); 1.4–1.9s is blank throughout.
  const log = installFakeMedia(app.win, { blank: t => (t >= 0.55 && t < 0.6) || (t >= 1.4 && t <= 1.9) });
  try {
    const ex = await app.win.eval(`extractFrames(new Blob(['v'], { type: 'video/mp4' }), {})`);
    assert.equal(ex.dropped, 2, 'the frames at ~1.48s and ~1.61s stayed blank through three attempts; later ones nudged past 1.9s');
    assert.equal(ex.frames.length, 14);
    assert.ok(ex.frames.some(f => f.t === 0.69), 'the ~0.57s frame was nudged to 0.69s');
    for (const f of ex.frames) assert.notEqual(JSON.parse(await f.blob.text()).t, null, 'no kept frame is blank');
  } finally { log.restore(); }
});

test('adding a swing end to end: frames and video land as fetchable assets, every t ≥ 0.05', async () => {
  const log = installFakeMedia(app.win, { duration: 3 });
  try {
    app.go('range', { sessionId: 's_data' });
    app.act('addSwing', { id: 's_data' });
    const input = app.field('vid');
    const file = new app.win.File(['fake video bytes'], 'swing.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new app.win.Event('change'));
    await app.waitFor(() => app.$('#sheetInner [name=s0]'), { what: 'trim sliders' });
    // The trim hint says what the frames will be, and warns when they're too far apart to see the downswing.
    assert.match(app.text('#frameNote'), /^16 frames, 0\.20 s apart across 3\.0 s\. Over 0\.15 s apart the downswing \(about 0\.3 s, top to ball\) is mostly skipped: trim to about 1\.5 s, address to a beat after the finish\. Or move Impact to where the club meets the ball and the frames pack there\.$/);
    const s1 = app.$('#sheetInner [name=s1]'); s1.value = '1.5'; s1.dispatchEvent(new app.win.Event('input'));
    assert.equal(app.text('#frameNote'), '16 frames, 0.10 s apart across 1.5 s. Trim tight: address to a beat after the finish. Or move Impact to where the club meets the ball and the frames pack there.');
    app.fill('view', 'face'); app.fill('club', '7i'); app.fill('note', 'test swing');
    assert.equal(await app.save(), true);
    const s = await app.api.get('sessions', 's_data');
    const added = s.swings[0];
    assert.equal(added.view, 'face');
    assert.equal(added.impact, null, 'no impact marked: stored as null, frames even');
    assert.equal(added.frames.length, 16);
    assert.ok(added.frames.every(f => f.t >= 0.05 && f.t <= 1.5), JSON.stringify(added.frames.map(f => f.t)));
    assert.ok(Math.abs(added.frames[1].t - added.frames[0].t - 0.1) < 0.011, 'about 0.1 s apart on a 1.5 s trim');
    app.go('range', { sessionId: 's_data' });
    assert.match(app.text('#view .swing .spread .small'), /^16 frames, 0\.10 s apart$/);
    for (const f of added.frames) assert.equal(await app.api.blobStatus(f.asset), 200);
    assert.ok(added.video, 'a small video is stored too');
    assert.equal(await app.api.blobStatus(added.video), 200);
  } finally { log.restore(); }
});

/* ---------- packed around impact (2.26.0) ---------- */

test('frameTimes: even without a mark; with one, 10 of 16 sit from 0.3 s before the ball to 0.1 s after', () => {
  const even = app.J(`frameTimes({ start: 0, end: 1.5 })`);
  assert.equal(even.length, 16); assert.equal(even[0], 0.05); assert.equal(even[15], 1.5);
  assert.ok(even.every((t, i) => i === 0 || Math.abs(t - even[i - 1] - 0.0967) < 0.011), 'even spacing');
  const packed = app.J(`frameTimes({ start: 0, end: 1.5, impact: 1.0 })`);
  assert.equal(packed.length, 16);
  assert.deepEqual(packed, [...packed].sort((a, b) => a - b), 'in order');
  assert.equal(new Set(packed).size, 16, 'no repeats');
  const inWin = packed.filter(t => t >= 0.7 - 0.001 && t <= 1.1 + 0.001);
  assert.equal(inWin.length, 10, `10 in the window: ${packed.join(' ')}`);
  assert.ok(inWin.every((t, i) => i === 0 || t - inWin[i - 1] < 0.056), 'about 0.04 s apart there');
  assert.equal(packed[0], 0.05); assert.equal(packed[15], 1.5, 'still address to finish');
  assert.equal(packed.filter(t => t < 0.7 - 0.001).length, 4, 'the rest in proportion: 0.7 s before against 0.4 s after');
  assert.equal(packed.filter(t => t > 1.1 + 0.001).length, 2);
  // A mark at the very start of the trim packs what it can and spreads the rest after.
  const early = app.J(`frameTimes({ start: 0, end: 1.5, impact: 0.1 })`);
  assert.equal(early.length, 16); assert.equal(early[0], 0.05); assert.equal(early[15], 1.5);
  assert.equal(early.filter(t => t <= 0.2 + 0.001).length, 10);
  // A mark outside the trim is ignored: even again.
  assert.deepEqual(app.J(`frameTimes({ start: 0, end: 1.5, impact: 2 })`), even);
});

test('marking impact on the trim packs the stored frames there, is kept on the swing, and reaches the prompt', async () => {
  const log = installFakeMedia(app.win, { duration: 3 });
  try {
    app.go('range', { sessionId: 's_data' });
    app.act('addSwing', { id: 's_data' });
    const input = app.field('vid');
    const file = new app.win.File(['fake video bytes'], 'swing2.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new app.win.Event('change'));
    await app.waitFor(() => app.$('#sheetInner [name=imp]'), { what: 'impact slider' });
    assert.equal(app.text('#sheetInner #ii'), 'not marked');
    const preview = log.videos[log.videos.length - 1];
    assert.ok(preview.seeks.length && preview.seeks.every(t => t >= 0.05), `the preview is never seeked to 0: ${preview.seeks.join(' ')}`);
    const s1 = app.$('#sheetInner [name=s1]'); s1.value = '1.5'; s1.dispatchEvent(new app.win.Event('input'));
    const imp = app.$('#sheetInner [name=imp]'); imp.value = '1.0'; imp.dispatchEvent(new app.win.Event('input'));
    assert.equal(app.text('#sheetInner #ii'), '1.00s');
    assert.equal(app.text('#frameNote'), '16 frames: 10 packed 0.04 s apart from 0.7 to 1.1 s (0.3 s before the ball to 0.1 s after), 6 across the rest of the 1.5 s.');
    // Trimming the end inside the mark drags the mark with it.
    s1.value = '0.9'; s1.dispatchEvent(new app.win.Event('input'));
    assert.equal(app.text('#sheetInner #ii'), '0.90s');
    s1.value = '1.5'; s1.dispatchEvent(new app.win.Event('input'));
    imp.value = '1.0'; imp.dispatchEvent(new app.win.Event('input'));
    app.fill('view', 'dtl'); app.fill('club', '7i'); app.fill('note', 'marked');
    assert.equal(await app.save(), true);
    const s = await app.api.get('sessions', 's_data');
    const added = s.swings.find(w => w.note === 'marked');
    assert.equal(added.impact, 1);
    const ts = added.frames.map(f => f.t);
    assert.equal(ts.length, 16);
    assert.equal(ts.filter(t => t >= 0.699 && t <= 1.101).length, 10, `packed: ${ts.join(' ')}`);
    assert.ok(ts.every(t => t >= 0.05 && t <= 1.5));
    app.go('range', { sessionId: 's_data' });
    const card = app.$$('#view .swing').find(el => /marked/.test(el.textContent));
    assert.match(card.querySelector('.spread .small').textContent, /^16 frames, packed around impact at 1\.0 s$/);
    const prompt = app.E(`swingPrompt(session('s_data').swings.find(w => w.note === 'marked'), session('s_data'))`);
    assert.match(prompt, /marked the club meeting the ball at 1\.00 s/);
    assert.match(prompt, /from 0\.70 s to 1\.10 s they are about 0\.04 s apart/);
    assert.match(prompt, /may be a frame either side/);
    assert.doesNotMatch(prompt, /fixed intervals/);
    assert.doesNotMatch(prompt, /\(about [\d.]+ s apart\)/, 'no mean gap when packed');
  } finally { log.restore(); }
});

/* ---------- one route to an analysis ---------- */

test('there is no "Analyse in a chat" route any more: Analyse is the one way in', () => {
  app.go('range', { sessionId: 's_sw' });
  const acts = app.$$('#view .swing [data-act]').map(b => b.dataset.act);
  assert.ok(acts.includes('analyseSwing'));
  assert.deepEqual(acts.filter(a => /chat|swingPrompt|swingFrames/.test(a)), []);
  assert.doesNotMatch(app.text('#view .swing'), /in a chat/);
  const gone = app.J(`['chatRoute', 'swingPrompt', 'swingFrames'].filter(k => k in ACTIONS)`);
  assert.deepEqual(gone, []);
  for (const fn of ['swingHandoff', 'zipStore', 'parseAnalysis']) assert.equal(app.E(`typeof ${fn}`), 'undefined', `${fn} removed`);
});

test('an older analysis read in a chat still shows, labelled as such', async () => {
  const s = await app.api.get('sessions', 's_sw');
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: { one_thing: 'Keep the hips back', observations: [] }, analysedOn: '2026-09-10', analysedIn: 'chat' }] });
  await app.waitFor(() => app.E(`session('s_sw').swings[0].analysedIn === 'chat'`), { what: 'poll' });
  app.go('range', { sessionId: 's_sw' });
  assert.match(app.text('#view .swing'), /Keep the hips back/);
  assert.match(app.text('#view .swing'), /Read from frames by Claude in a chat on .* a reading, not a measurement/);
});

/* ---------- analysis through the server ---------- */

test('with no API key on the server, Analyse says so instead of failing silently', async () => {
  analyseReply = null;
  // The notice lives only in the DOM, so the re-render the poll does after
  // the previous test's save would wipe it. Let that poll land first.
  await sleep(600);
  app.go('range', { sessionId: 's_sw' });
  app.click('#view [data-act="analyseSwing"]');
  await app.waitFor(() => /check ANTHROPIC_API_KEY on the server/.test(app.text('#an_sw_1')), { what: 'unavailable notice' });
  assert.match(app.text('#an_sw_1'), /\(unavailable\)/);
});

test('Analyse sends the frames with the ball data and view brief, and stores the reply', async () => {
  analyseReply = { text: '{}', json: { observations: [{ what: 'Hips stall', evidence: 'frame 6', confidence: 'high' }], matches_ball_data: 'Consistent with the runners.', one_thing: 'Rotate through' }, usage: {} };
  app.go('range', { sessionId: 's_sw' });
  app.click('#view [data-act="analyseSwing"]');
  await app.waitFor(async () => (await app.api.get('sessions', 's_sw')).swings[0].analysis.one_thing === 'Rotate through', { what: 'analysis stored' });
  assert.equal(analyseSeen.json, true);
  assert.equal(analyseSeen.images.length, 5, 'every frame, up to the 20-image limit');
  analyseSeen.images.forEach((img, i) => assert.deepEqual(Buffer.from(img.data, 'base64'), frameBytes(i)));
  assert.match(analyseSeen.prompt, /DOWN THE LINE/);
  assert.match(analyseSeen.prompt, /7i from 7 tracked range shots/);
  assert.match(analyseSeen.prompt, /stock carry 125m/);
  assert.match(analyseSeen.prompt, /hook and shank/);
  assert.match(analyseSeen.prompt, /Do not invent measurements/);
  assert.match(analyseSeen.prompt, /release timing/, 'the session focus goes in');
  assert.match(analyseSeen.prompt, /One fix, not a list/, 'coached as one fix');
  assert.match(analyseSeen.prompt, /"feel"[\s\S]*"check"[\s\S]*"ball_data": "agrees" \| "contradicts" \| "unclear"/);
  assert.match(analyseSeen.prompt, /At most three observations/);
  assert.equal((await app.api.get('sessions', 's_sw')).swings[0].analysedView, 'dtl', 'the angle it was read under (2.57.0)');
});

// Regression: in-app analysis used to keep a stale analysedIn: 'chat'.
test('re-analysing in the app clears the "read in a chat" label', async () => {
  const got = (await app.api.get('sessions', 's_sw')).swings[0];
  assert.equal(got.analysis.one_thing, 'Rotate through', 'this is the in-app reading, replacing the chat one');
  assert.equal(got.analysedIn, undefined);
  app.go('range', { sessionId: 's_sw' });
  assert.doesNotMatch(app.text('#view .swing'), /in a chat/);
});

/* ---------- the reading as a coach gives it (2.11.0) ---------- */

const COACHED = { one_thing: 'Swing out to the right through the ball', why: 'Frames 5–7: the club exits left of target, which cuts across the ball and thins it.',
  feel: 'Hands out toward right field', drill: { name: 'Gate stick', how: 'Stick outside the ball; club exits right of it.' }, check: 'Ball starts straight and stops cutting',
  ball_data: 'agrees', matches_ball_data: 'Explains the low runners.', observations: [{ what: 'Club exits left', evidence: 'frames 5–7', confidence: 'high' }],
  cannot_tell: ['Face angle at impact'] };

test('a reading shows the one fix in the card\'s summary; why, feel, drill and how to know one tap down; the detail folded', async () => {
  const s = await app.api.get('sessions', 's_sw');
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: COACHED, analysedOn: '2026-10-24' }] });
  await app.waitFor(() => app.E(`session('s_sw').swings[0].analysis.feel`) === COACHED.feel, { what: 'poll' });
  app.go('range', { sessionId: 's_sw' });
  // 2.67.0: the fix is the summary's last row; why, feel, drill and check fold under it.
  assert.ok(app.$('#sumFix_sw_1 .analysis .one'));
  const how = app.$('#how_sw_1'); assert.ok(how && how.tagName === 'DETAILS' && !how.open);
  assert.equal(how.querySelector('summary').textContent, 'Why, feel and drill');
  const cues = app.$$('#how_sw_1 > .cue').map(e => e.textContent);
  assert.deepEqual(cues, ['Why ' + COACHED.why, 'Feel Hands out toward right field', 'Drill Gate stick — Stick outside the ball; club exits right of it.', 'Working when Ball starts straight and stops cutting']);
  assert.equal(app.text('#view .analysis .one'), COACHED.one_thing);
  const seen = app.$('#seen_sw_1');
  assert.ok(seen && seen.tagName === 'DETAILS' && !seen.open, 'what Claude saw is one tap down, with an id so it stays open across redraws');
  assert.equal(seen.querySelector('summary').textContent, 'What Claude saw · 1', 'a quiet fold at the card\'s foot (2.68.0)');
  assert.match(seen.textContent, /Club exits left[\s\S]*Against your ball data: Explains the low runners\.[\s\S]*Can't tell from this angle: Face angle at impact/);
  assert.equal(app.$$('#view .analysis > .obs').length, 0, 'no observations on the card itself');
});

test('an older, longer reading keeps its text but folds everything but the fix', async () => {
  const s = await app.api.get('sessions', 's_sw');
  const old = { one_thing: 'Swing the club head out to the right', observations: [1, 2, 3, 4].map(i => ({ what: 'obs ' + i, evidence: 'frame ' + i, confidence: 'medium' })),
    matches_ball_data: 'Consistent with the 33% low runners.', drill: { name: 'Alignment stick gate drill', why: 'The out-to-in exit is the cause.' }, cannot_tell: ['Low point'] };
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: old, analysedOn: '2026-09-26' }] });
  await app.waitFor(() => app.E(`session('s_sw').swings[0].analysedOn`) === '2026-09-26', { what: 'poll' });
  app.go('range', { sessionId: 's_sw' });
  assert.deepEqual(app.$$('#view .analysis .cue').map(e => e.textContent), ['Drill Alignment stick gate drill'], 'no why/feel/check invented for it');
  const seen = app.$('#seen_sw_1');
  assert.equal(seen.querySelectorAll('.obs').length, 4);
  assert.match(seen.textContent, /Why this drill: The out-to-in exit is the cause\./);
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: COACHED, analysedOn: '2026-10-24' }] });
});

test('each camera view gets its own brief; an unknown view is treated as "other"', () => {
  const p = view => app.E(`swingPrompt({ view: ${JSON.stringify(view)}, club: null, frames: [] }, { })`);
  assert.match(p('face'), /FACE ON/);
  assert.doesNotMatch(p('face'), /DOWN THE LINE \(camera/);
  assert.match(p('sideways'), /NEITHER down the line NOR face on/);
  assert.match(p('dtl'), /No club recorded for this swing/);
});

test('the prompt gives each frame\'s time, and asks the wrist question down the line only', () => {
  const fr = [{ t: 0.05 }, { t: 0.16 }, { t: 0.27 }, { t: 0.38 }];
  const p = view => app.E(`swingPrompt({ view: ${JSON.stringify(view)}, club: null, frames: ${JSON.stringify(fr)} }, { })`);
  assert.match(p('dtl'), /looking at 4 still frames/);
  assert.match(p('dtl'), /in seconds: 0\.05, 0\.16, 0\.27, 0\.38 \(about 0\.11 s apart\)/);
  assert.match(p('dtl'), /which frame is nearest the top of the backswing and which is nearest impact/);
  assert.match(p('dtl'), /WRIST ANGLE[\s\S]*cupped, flat or bowed[\s\S]*still held \(an L or tighter\), opening, or already released/);
  assert.match(p('dtl'), /"wrist": \{ "top": "cupped" \| "flat" \| "bowed" \| "cannot tell", "lead_arm_parallel": "held" \| "opening" \| "released" \| "cannot tell"/);
  assert.match(p('dtl'), /Do not infer it from the ball data/);
  for (const v of ['face', 'other']) assert.doesNotMatch(p(v), /wrist/i, `${v}: the camera can't show it, so it isn't asked`);
  assert.equal(app.E(`frameGap(${JSON.stringify(fr)})`), 0.11);
  assert.equal(app.E(`frameGap([{ t: 0.05 }])`), null);
});

test('a reading\'s wrist answer shows under what Claude saw', async () => {
  const s = await app.api.get('sessions', 's_sw');
  const a = { ...COACHED, wrist: { top: 'flat', lead_arm_parallel: 'released', frames: 'frames 7 and 10' } };
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: a, analysedOn: '2026-10-26' }] });
  await app.waitFor(() => app.E(`session('s_sw').swings[0].analysedOn`) === '2026-10-26', { what: 'poll' });
  app.go('range', { sessionId: 's_sw' });
  assert.match(app.text('#seen_sw_1'), /Wrist: flat at the top; released with the lead arm parallel on the way down \(frames 7 and 10\)/);
  assert.doesNotMatch(app.$$('#view .analysis .cue').map(e => e.textContent).join(' '), /Wrist/, 'not with the fix');
  await app.api.put('sessions', 's_sw', { ...s, swings: [{ ...s.swings[0], analysis: COACHED, analysedOn: '2026-10-24' }] });
  await app.waitFor(() => app.E(`session('s_sw').swings[0].analysedOn`) === '2026-10-24', { what: 'poll' });
});

/* ---------- video ranks below ball data ---------- */

test('a swing reading gains weight only when it agrees with the ball data', () => {
  const score = mbd => app.E(`(() => { const saved = S.sessions; S.sessions = [{ id: 'x', type: 'range', date: '2026-09-01', blocks: [],
    swings: [{ id: 'w', view: 'dtl', club: '7i', frames: [], analysis: { one_thing: 'z', matches_ball_data: ${JSON.stringify(mbd)},
      observations: [{ what: 'a', evidence: 'e', confidence: 'high' }, { what: 'b', evidence: 'e', confidence: 'high' }] } }] }];
    try { return swingItems()[0].score; } finally { S.sessions = saved; } })()`);
  assert.equal(score('This lines up with the runners.'), 1.8, 'agrees: 0.9 per high-confidence observation');
  assert.equal(score('This does not match the numbers.'), 0.9, 'disagrees: half weight');
  assert.equal(score('Consistent? Not really.'), 0.9, 'a hedge is not agreement');
  assert.equal(score(''), 0.9);
  const said = (bd, mbd) => app.E(`(() => { const saved = S.sessions; S.sessions = [{ id: 'x', type: 'range', date: '2026-09-01', blocks: [],
    swings: [{ id: 'w', view: 'dtl', club: '7i', frames: [], analysis: { one_thing: 'z', ball_data: ${JSON.stringify(bd)}, matches_ball_data: ${JSON.stringify(mbd)},
      observations: [{ what: 'a', evidence: 'e', confidence: 'high' }] } }] }];
    try { return swingItems()[0].agrees; } finally { S.sessions = saved; } })()`);
  assert.equal(said('agrees', 'Explains the runners, not the fats.'), true, 'a reading that says it agrees does, whatever its sentence says');
  assert.equal(said('unclear', 'Consistent with the runners.'), false);
  assert.equal(said('contradicts', 'This lines up.'), false);
});

test('video items render collapsed and labelled "read from video"', () => {
  const html = app.E(`practiceCard(swingItems()[0], 0)`);
  assert.match(html, /^<details class="pcard k-swing"[^>]*>/);
  assert.match(html, /read from video/);
});

/* ---------- removing frames and swings ---------- */

test('dropping a frame removes its asset; a swing keeps at least two frames', async () => {
  app.go('range', { sessionId: 's_sw' });
  const first = frames[0].asset;
  app.act('dropFrame', { sid: 's_sw', wid: 'sw_1', fi: '0' });
  await app.answer(true);
  await app.waitFor(async () => (await app.api.get('sessions', 's_sw')).swings[0].frames.length === 4, { what: 'frame dropped' });
  await app.waitFor(async () => (await app.api.blobStatus(first)) === 404, { what: 'asset deleted' });
  for (const n of [3, 2]) {
    app.act('dropFrame', { sid: 's_sw', wid: 'sw_1', fi: '0' });
    await app.answer(true);
    await app.waitFor(async () => (await app.api.get('sessions', 's_sw')).swings[0].frames.length === n, { what: `down to ${n}` });
  }
  await app.act('dropFrame', { sid: 's_sw', wid: 'sw_1', fi: '0' });
  assert.match(app.toast(), /at least two frames/);
  assert.equal(app.confirmOpen(), false, 'refused before asking');
  assert.equal((await app.api.get('sessions', 's_sw')).swings[0].frames.length, 2);
});

test('deleting a swing asks in-page, then removes its frames and video from the server', async () => {
  const s = await app.api.get('sessions', 's_sw');
  const assets = [...s.swings[0].frames.map(f => f.asset), videoId];
  app.act('deleteSwing', { sid: 's_sw', wid: 'sw_1' });
  await app.answer(false);
  assert.equal((await app.api.get('sessions', 's_sw')).swings.length, 1, 'Cancel keeps it');
  app.act('deleteSwing', { sid: 's_sw', wid: 'sw_1' });
  await app.answer(true);
  await app.waitFor(async () => (await app.api.get('sessions', 's_sw')).swings.length === 0, { what: 'swing gone' });
  for (const a of assets) await app.waitFor(async () => (await app.api.blobStatus(a)) === 404, { what: `asset ${a} deleted` });
});
