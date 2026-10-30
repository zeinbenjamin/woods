// The bay's other numbers per shot (2.51.0): carry side, total side, ball speed,
// club path and face angle, read from screenshots, kept on the shot they were
// read with, and filled into shots Carry already has (matched by carry and
// total) instead of adding them twice. The numbers are his five 5W shots from
// the Trackman shot list he sent on 2026-10-31. Claude's reply is stubbed at
// /api/analyse; the review sheet, the save and the stored screenshots are real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, club } from './harness.js';

// Shot, club speed, path, face, ball speed, carry, total, carry side, total side: as on his screen.
const SCREEN = [
  [1, 86.3, -2.1, -4.8, 122.7, 163.6, 175.1, '6.2L', '6.0L'],
  [2, 86.0, -0.4, -2.9, 123.9, 168.0, 176.2, '4.6L', '4.7L'],
  [3, 84.7, -2.3, 0.8, 119.2, 164.8, 178.2, '12.1R', '14.3R'],
  [4, 83.9, -2.4, -5.5, 114.5, 151.0, 175.6, '1.0L', '1.4R'],
  [5, 87.5, -2.1, -6.1, 120.8, 163.1, 176.9, '8.3L', '8.2L'],
];
const read = rows => rows.map(([, cs, path, face, ball, carry, total, side, tside]) =>
  ({ carry, total, clubSpeedMph: cs, ballSpeedMph: ball, clubPathDeg: path, faceAngleDeg: face, carrySide: side, totalSide: tside }));
// What Carry should store for them.
const STORED = [
  { carry: 163.6, total: 175.1, speed: 86.3, carrySide: -6.2, totalSide: -6, ballSpeed: 122.7, clubPath: -2.1, faceAngle: -4.8 },
  { carry: 168, total: 176.2, speed: 86, carrySide: -4.6, totalSide: -4.7, ballSpeed: 123.9, clubPath: -0.4, faceAngle: -2.9 },
  { carry: 164.8, total: 178.2, speed: 84.7, carrySide: 12.1, totalSide: 14.3, ballSpeed: 119.2, clubPath: -2.3, faceAngle: 0.8 },
  { carry: 151, total: 175.6, speed: 83.9, carrySide: -1, totalSide: 1.4, ballSpeed: 114.5, clubPath: -2.4, faceAngle: -5.5 },
  { carry: 163.1, total: 176.9, speed: 87.5, carrySide: -8.3, totalSide: -8.2, ballSpeed: 120.8, clubPath: -2.1, faceAngle: -6.1 },
];
// The same session typed in earlier: carry and total (club speed on four of them), nothing else.
const TYPED = STORED.map(({ carry, total, speed }, i) => i === 4 ? { carry, total } : { carry, total, speed });

let app, reply = null;
before(async () => {
  app = await startApp({
    seed: {
      clubs: [club('5W', 'wood', { name: '5 Wood', order: 2 }), club('7i', 'iron', { name: '7 Iron', order: 3 })],
      sessions: [
        { id: 's_new', v: 2, type: 'range', date: '2026-10-25', venue: 'Virtual Range', blocks: [] },
        { id: 's_old', v: 2, type: 'range', date: '2026-09-28', venue: 'Moore Park', blocks: [
          { id: 'b_5w', seq: 1, club: '5W', swing: 'full', target: 160, intent: 'smooth tempo', goals: ['tee:5W'], shots: TYPED },
          { id: 'b_7i', seq: 2, club: '7i', swing: 'full', shots: [{ carry: 110, total: 131 }] }] },
      ],
    },
    intercept: async (url) => {
      if (!url.endsWith('/api/analyse') || !reply) return null;
      return new Response(JSON.stringify({ text: '', json: reply, usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
});
after(() => app && app.stop());

const get = id => app.api.get('sessions', id);
const png = (text, name) => new app.win.File([text], name, { type: 'image/png' });
async function readScreens(sid, files) {
  app.go('range', { sessionId: sid });
  app.click('#view [data-act="shotsFromImages"]');
  Object.defineProperty(app.field('imgs'), 'files', { value: files });
  app.$('#sheetInner [data-save]').click();
  await app.waitFor(() => app.$('#sheetInner .readblock') || /\S/.test(app.text('#readNote')) && !/^Reading \d/.test(app.text('#readNote')), { what: 'read finished' });
}

test('his Trackman screen reads as signed metres, mph and degrees; L is minus, R is plus', () => {
  const r = app.J(`normaliseShotRead(${JSON.stringify({ units: 'm', blocks: [{ club: '5W', shots: read(SCREEN) }] })})`);
  assert.deepEqual(r.blocks[0].shots, STORED);
  assert.deepEqual(r.blocks[0].warnings, []);
  assert.deepEqual(app.J(`['6.2L', '12.1R', '-3.4', '0.0', ' 4,5 L', '−2.0', 7, 'left', '12.1X', ''].map(sideOf)`), [-6.2, 12.1, -3.4, 0, -4.5, -2, 7, null, null, null]);
});

test('sides in yards are converted with the distances; a number that cannot be one is left out of that shot only, and said', () => {
  const r = app.J(`normaliseShotRead(${JSON.stringify({ units: 'yd', blocks: [{ club: '5W', shots: [
    { carry: 180, total: 190, carrySide: '10L', totalSide: '11L', ballSpeedMph: 120 },
    { carry: 170, total: 185, carrySide: 'far left', faceAngleDeg: 45, clubPathDeg: -2 },
    { carry: 160, total: 170, carrySide: '150R', ballSpeedMph: 300 },
  ] }] })})`);
  const [a, b, c] = r.blocks[0].shots;
  assert.deepEqual(a, { carry: 164.6, total: 173.7, carrySide: -9.1, totalSide: -10.1, ballSpeed: 120 }, 'side converted, speed is not a distance');
  assert.deepEqual(b, { carry: 155.4, total: 169.2, clubPath: -2 }, 'the shot stays; the bad numbers go');
  assert.deepEqual(c, { carry: 146.3, total: 155.4 });
  const w = r.blocks[0].warnings.join(' | ');
  assert.match(w, /Shot 2: carry side "far left" couldn't be read; face angle 45° isn't plausible; left out of that shot/);
  assert.match(w, /Shot 3: carry side 137\.2R isn't plausible; ball speed 300 mph isn't plausible/);
});

test('the prompt asks for the columns by their labels, as shown, and never works one out from another', async () => {
  const p = app.E('shotImagePrompt(3)');
  assert.match(p, /"carrySide": "as shown/);
  assert.match(p, /Copy them exactly as shown, with the L or R or the sign/);
  assert.match(p, /Never work one out from another column/);
  assert.match(p, /ballSpeedMph only when labelled ball speed in mph/);
});

test('a new block keeps each shot\'s other numbers; a shot whose carry is changed keeps none of them', async () => {
  reply = { units: 'm', blocks: [{ club: '5W', shots: read(SCREEN) }] };
  await readScreens('s_new', [png('tm-5w', '5w.png')]);
  const table = app.$('#sheetInner .extras table');
  assert.ok(table, 'the other numbers are shown under the shots');
  assert.deepEqual(app.$$('th', table).map(t => t.textContent), ['#', 'Carry', 'Total', 'Carry side', 'Total side', 'Ball speed', 'Club path', 'Face angle']);
  assert.deepEqual(app.$$('td', app.$$('tbody tr', table)[2]).map(td => td.textContent), ['3', '164.8', '178.2', '12.1R', '14.3R', '119.2', '-2.3', '0.8']);
  assert.match(app.text('[data-count="0"]'), /5 shots, .*side for 5/);
  assert.ok(app.$('#sheetInner [data-fill="0"]').hidden, 'nothing like it in this session yet');
  app.fill('shots_0', app.field('shots_0').value.replace(/^151(\.0)?\s+175\.6/m, '152  175.6'));
  assert.match(app.text('[data-count="0"]'), /side for 4/);
  assert.equal(await app.save(), true);
  const b = (await get('s_new')).blocks[0];
  assert.deepEqual(b.shots, [...STORED.slice(0, 3), { carry: 152, total: 175.6, speed: 83.9 }, STORED[4]]);
  // The block page shows them.
  app.go('range', { blockId: b.id });
  const head = app.$$('#shotTable th').map(t => t.textContent);
  assert.deepEqual(head.slice(4, 10), ['Club speed', 'Carry side', 'Total side', 'Ball speed', 'Club path', 'Face angle']);
  assert.match(app.$$('#shotTable tbody tr')[0].textContent, /6\.2L.*6\.0L.*122\.7.*-2\.1.*-4\.8/);
  assert.match(app.$$('#shotTable tbody tr')[3].textContent, /152\.0.*–.*–/, 'not measured, never guessed');
});

test('unticking "Keep the other numbers" saves carry, total and club speed only', async () => {
  reply = { units: 'm', blocks: [{ club: '7i', shots: [{ carry: 120, total: 133, clubSpeedMph: 70, carrySide: '3L', faceAngleDeg: -1 }] }] };
  await readScreens('s_new', [png('tm-7i', '7i.png')]);
  app.fill('extras_0', false);
  assert.doesNotMatch(app.text('[data-count="0"]'), /side for/);
  assert.equal(await app.save(), true);
  const b = (await get('s_new')).blocks.find(x => x.club === '7i');
  assert.deepEqual(b.shots, [{ carry: 120, total: 133, speed: 70 }]);
});

test('shots Carry already has are filled in, not added twice: same block, carry and total untouched, the screenshot kept beside it', async () => {
  // Six read: his five, which the typed block has, and one it doesn't.
  reply = { units: 'm', blocks: [{ club: '5W', shots: [...read(SCREEN), { carry: 170.2, total: 180, carrySide: '2R' }] }] };
  await readScreens('s_old', [png('tm-old', 'old.png')]);
  const note = app.$('#sheetInner [data-fill="0"]');
  assert.ok(!note.hidden);
  assert.match(note.textContent, /These are shots Carry already has: 5 of 6 match your 5W block to 160m by carry and total/);
  assert.match(note.textContent, /fills in what those 5 shots lack; nothing else on the block changes/);
  assert.match(note.textContent, /1 shot here matches none of its shots and is left out/);
  // Picking another club takes the note away: those would be new shots.
  app.fill('club_0', '7i'); assert.ok(note.hidden);
  app.fill('club_0', '5W'); assert.ok(!note.hidden);
  assert.equal(await app.save(), true);
  const s = await get('s_old');
  assert.deepEqual(s.blocks.map(b => b.id), ['b_5w', 'b_7i'], 'no new block');
  const b = s.blocks[0];
  assert.deepEqual(b.shots, STORED, 'the other numbers added; club speed only where it was missing');
  assert.deepEqual([b.target, b.intent, b.goals, b.fromImages], [160, 'smooth tempo', ['tee:5W'], undefined], 'nothing else on the block changes');
  assert.equal(b.filledFrom.length, 1);
  assert.equal(b.filledFrom[0].shots, 5);
  assert.equal(await (await app.api.blob(b.filledFrom[0].assets[0])).text(), 'tm-old');
  assert.deepEqual(s.blocks[1].shots, [{ carry: 110, total: 131 }]);
  app.go('range', { blockId: 'b_5w' });
  assert.match(app.text('#view'), /5 shots filled in from 1 screenshot on .*matched to these shots by carry and total/);
  assert.ok(app.J('collectAssetIds()').includes(b.filledFrom[0].assets[0]), 'travels in exports');
});

test('the screenshots behind filled-in numbers are re-linked on import', async () => {
  const s = await get('s_old'), id = s.blocks[0].filledFrom[0].assets[0];
  const data = { format: 'carry-export', version: 1, clubs: [], courses: [], settings: {},
    sessions: [{ ...s, id: 's_old_copy' }], assets: { [id]: `data:image/png;base64,${Buffer.from('copied').toString('base64')}` } };
  await app.win.eval(`applyImport(${JSON.stringify(data)})`);
  const copy = (await get('s_old_copy')).blocks[0].filledFrom[0];
  assert.notEqual(copy.assets[0], id);
  assert.equal(await (await app.api.blob(copy.assets[0])).text(), 'copied');
  assert.equal(copy.shots, 5);
});

test('reading them again adds nothing: the block is skipped and nothing is stored', async () => {
  reply = { units: 'm', blocks: [{ club: '5W', shots: read(SCREEN) }] };
  const before = JSON.stringify(await get('s_old'));
  await readScreens('s_old', [png('tm-again', 'again.png')]);
  assert.match(app.text('#sheetInner [data-fill="0"]'), /They add nothing new, so this block is skipped/);
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /already in Carry with nothing new to add/);
  assert.equal(JSON.stringify(await get('s_old')), before);
  app.click('#sheetInner [data-close]');
});

test('editing a block in its form keeps the other numbers of every shot whose carry and total stay', async () => {
  app.act('editBlock', { sid: 's_old', bid: 'b_5w' });
  app.fill('outcome', 'tight left miss');
  app.fill('shots', app.field('shots').value.replace(/^151(\.0)?\s+175\.6/m, '150.5  175.6'));
  assert.equal(await app.save(), true);
  const b = (await get('s_old')).blocks[0];
  assert.equal(b.outcome, 'tight left miss');
  assert.deepEqual(b.shots.map(x => x.faceAngle), [-4.8, -2.9, 0.8, undefined, -6.1]);
  assert.equal(b.filledFrom.length, 1, 'where they came from is kept');
});

test('a screenshot read into two blocks stays until the last block using it is deleted', async () => {
  const s = await get('s_new');
  const [b5, b7] = s.blocks;
  // One reading fed both: make them share it, as a two-club read does.
  const shared = b5.fromImages.assets[0];
  await app.api.put('sessions', 's_new', { ...s, blocks: [b5, { ...b7, fromImages: { ...b7.fromImages, assets: [shared] } }] });
  await app.waitFor(() => app.E(`(session('s_new').blocks[1].fromImages.assets[0] === ${JSON.stringify(shared)})`), { what: 'poll' });
  app.act('deleteBlock', { sid: 's_new', bid: b5.id });
  await app.answer(true);
  await app.waitFor(async () => (await get('s_new')).blocks.length === 1, { what: 'deleted' });
  assert.equal((await app.api.blobStatus(shared)), 200, 'the other block still shows it');
  app.act('deleteBlock', { sid: 's_new', bid: b7.id });
  await app.answer(true);
  await app.waitFor(async () => (await app.api.blobStatus(shared)) === 404, { what: 'gone with the last block' });
});
