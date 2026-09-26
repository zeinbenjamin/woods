// The swing analyzer: frame extraction (never t=0, blank frames retried and
// dropped), the hand-rolled zip writer (opened with a real zip reader), one
// download rather than one per frame, pasting a chat reply back, analysis
// through the server, and video ranking below ball data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// Open a zip with Python's zipfile — a real reader, not ours.
function readZip(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'carry-zip-')), p = join(dir, 'x.zip');
  try {
    writeFileSync(p, bytes);
    const out = execFileSync('python3', ['-c', `
import zipfile, json, sys, base64
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({ "bad": bad, "entries": [ { "name": i.filename, "date": list(i.date_time), "method": i.compress_type,
  "data": base64.b64encode(z.read(i.filename)).decode() } for i in z.infolist() ] }))`, p]);
    return JSON.parse(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
    assert.ok(seeks.length >= 8);
    assert.ok(seeks.every(t => t >= 0.05), `every seek at or after 0.05s, got ${seeks.filter(t => t < 0.05)}`);
    assert.equal(ex.frames.length, 8);
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
  // 0.6–0.65s decodes blank once (recovers on the nudge); 1.4–1.9s is blank throughout.
  const log = installFakeMedia(app.win, { blank: t => (t >= 0.6 && t < 0.65) || (t >= 1.4 && t <= 1.9) });
  try {
    const ex = await app.win.eval(`extractFrames(new Blob(['v'], { type: 'video/mp4' }), {})`);
    assert.equal(ex.dropped, 1, 'the frame at ~1.44s stayed blank through three attempts');
    assert.equal(ex.frames.length, 7);
    assert.ok(ex.frames.some(f => f.t === 0.73), 'the ~0.61s frame was nudged to 0.73s');
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
    app.fill('view', 'face'); app.fill('club', '7i'); app.fill('note', 'test swing');
    assert.equal(await app.save(), true);
    const s = await app.api.get('sessions', 's_data');
    const added = s.swings[0];
    assert.equal(added.view, 'face');
    assert.equal(added.frames.length, 8);
    assert.ok(added.frames.every(f => f.t >= 0.05), JSON.stringify(added.frames.map(f => f.t)));
    for (const f of added.frames) assert.equal(await app.api.blobStatus(f.asset), 200);
    assert.ok(added.video, 'a small video is stored too');
    assert.equal(await app.api.blobStatus(added.video), 200);
  } finally { log.restore(); }
});

/* ---------- zip and download ---------- */

test('the hand-rolled zip opens cleanly in a real zip reader', async () => {
  const bytes = Buffer.from(await app.win.eval(`zipStore([
      { name: 'a.txt', bytes: new TextEncoder().encode('hello') },
      { name: 'b.bin', bytes: Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256) },
      { name: 'empty', bytes: new Uint8Array(0) },
    ], new Date(2026, 8, 26, 10, 30, 42)).arrayBuffer()`));
  const z = readZip(bytes);
  assert.equal(z.bad, null, 'CRCs check out');
  assert.deepEqual(z.entries.map(e => e.name), ['a.txt', 'b.bin', 'empty']);
  assert.equal(Buffer.from(z.entries[0].data, 'base64').toString(), 'hello');
  assert.deepEqual([...Buffer.from(z.entries[1].data, 'base64')], Array.from({ length: 5000 }, (_, i) => (i * 7) % 256));
  assert.equal(z.entries[2].data, '');
  assert.deepEqual(z.entries[0].date, [2026, 9, 26, 10, 30, 42]);
  assert.equal(z.entries[0].method, 0, 'stored, uncompressed');
});

test('saving frames is one download — a single zip — not one prompt per frame', async () => {
  app.downloads.length = 0;
  await app.act('swingFrames', { sid: 's_sw', wid: 'sw_1' });
  await sleep(100);
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, 'swing-dtl-7i-2026-09-02.zip');
  assert.match(app.toast(), /Frames saved as a zip/);
  const z = readZip(Buffer.from(await app.downloads[0].blob.arrayBuffer()));
  assert.equal(z.bad, null);
  assert.deepEqual(z.entries.map(e => e.name), ['swing-dtl-01.webp', 'swing-dtl-02.webp', 'swing-dtl-03.webp', 'swing-dtl-04.webp', 'swing-dtl-05.webp']);
  z.entries.forEach((e, i) => assert.deepEqual(Buffer.from(e.data, 'base64'), frameBytes(i), `frame ${i + 1} is the stored bytes`));
});

/* ---------- reading a chat reply back in ---------- */

test('a chat reply parses as bare JSON, fenced JSON, JSON inside prose, or plain prose', () => {
  const p = raw => app.J(`parseAnalysis(${JSON.stringify(raw)})`);
  assert.deepEqual(p('{"one_thing":"a"}'), { one_thing: 'a' });
  assert.deepEqual(p('Here you go:\n```json\n{"one_thing":"b"}\n```\nGood luck'), { one_thing: 'b' });
  assert.deepEqual(p('Reading: {"one_thing":"c"} — hope that helps'), { one_thing: 'c' });
  const prose = p('Your hips stall.\n\nTry the pump drill.');
  assert.equal(prose.parsed, false);
  assert.equal(prose.one_thing, 'Your hips stall.');
  assert.match(prose.notes, /pump drill/);
});

test('pasting a reply saves it on the swing, labelled as read in a chat and as a reading', async () => {
  app.go('range', { sessionId: 's_sw' });
  app.act('chatRoute', { sid: 's_sw', wid: 'sw_1' });
  app.fill('reply', '```json\n' + JSON.stringify({
    observations: [{ what: 'Early extension', evidence: 'frames 5-6', confidence: 'high' }],
    matches_ball_data: 'This lines up with the low runners in the strike mix.',
    one_thing: 'Keep the hips back through impact', drill: { name: 'Chair drill', why: 'keeps posture' }, cannot_tell: ['low point'],
  }) + '\n```');
  assert.equal(await app.save(), true);
  const got = (await app.api.get('sessions', 's_sw')).swings[0];
  assert.equal(got.analysis.one_thing, 'Keep the hips back through impact');
  assert.equal(got.analysedIn, 'chat');
  assert.match(got.analysedOn, /^\d{4}-\d{2}-\d{2}$/);
  const card = app.text('#view .swing');
  assert.match(card, /Keep the hips back through impact/);
  assert.match(card, /in a chat/);
  assert.match(card, /a reading, not a measurement/);
});

/* ---------- analysis through the server ---------- */

test('with no API key on the server, Analyse says so instead of failing silently', async () => {
  analyseReply = null;
  // The notice lives only in the DOM, so the re-render the poll does after
  // the previous test's save would wipe it. Let that poll land first.
  await sleep(600);
  app.go('range', { sessionId: 's_sw' });
  app.click('#view [data-act="analyseSwing"]');
  await app.waitFor(() => /cannot reach Claude/.test(app.text('#an_sw_1')), { what: 'unavailable notice' });
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
});

// KNOWN BUG, recorded rather than fixed (web/index.html stays identical to the
// artifact until that's decided): analysing in the app after a pasted chat
// reply keeps analysedIn: 'chat', so the card credits the new reading to a chat.
test('re-analysing in the app clears the "read in a chat" label', { todo: 'analysedIn is not reset by in-app analysis' }, async () => {
  const got = (await app.api.get('sessions', 's_sw')).swings[0];
  assert.equal(got.analysis.one_thing, 'Rotate through', 'this is the in-app reading');
  assert.equal(got.analysedIn, undefined);
});

test('each camera view gets its own brief; an unknown view is treated as "other"', () => {
  const p = view => app.E(`swingPrompt({ view: ${JSON.stringify(view)}, club: null, frames: [] }, { })`);
  assert.match(p('face'), /FACE ON/);
  assert.doesNotMatch(p('face'), /DOWN THE LINE \(camera/);
  assert.match(p('sideways'), /NEITHER down the line NOR face on/);
  assert.match(p('dtl'), /No club recorded for this swing/);
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
});

test('video items render collapsed and labelled "read from video"', () => {
  const html = app.E(`practiceCard(swingItems()[0], 0)`);
  assert.match(html, /^<details class="pcard k-swing">/);
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
