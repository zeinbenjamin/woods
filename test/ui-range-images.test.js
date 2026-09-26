// Range shots from screenshots, and the version shown in the app.
// Claude's reply is stubbed at /api/analyse (the prompt and images the app
// sends are captured and checked); everything else — the review sheet, the
// save, the stored screenshots — is the real app against the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, club, sleep } from './harness.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let app, reply = null, seen = null;

before(async () => {
  app = await startApp({
    seed: {
      clubs: [club('5W', 'wood', { name: '5 Wood', order: 2 }), club('7i', 'iron', { name: '7 Iron', order: 3 }),
        club('9i', 'iron', { name: '9 Iron', order: 4, retired: true }), club('PW', 'wedge', { name: 'Pitching Wedge', loft: 46, order: 5 }),
        club('P', 'putter', { name: 'Putter', order: 9 })],
      sessions: [{ id: 's_img', v: 2, type: 'range', date: '2026-09-25', venue: 'Test Range', blocks: [] }],
    },
    intercept: async (url, o) => {
      if (!url.endsWith('/api/analyse') || !reply) return null;
      seen = JSON.parse(o.body);
      return new Response(JSON.stringify({ text: '', json: reply, usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
});
after(() => app && app.stop());

const assetFiles = () => readdirSync(join(app.dataDir, 'assets')).length;
const session = () => app.api.get('sessions', 's_img');
const png = (text, name) => new app.win.File([text], name, { type: 'image/png' });

// Open "From screenshots", attach files, press Read (the sheet's Save).
async function readScreens(files) {
  app.go('range', { sessionId: 's_img' });
  app.click('#view [data-act="shotsFromImages"]');
  Object.defineProperty(app.field('imgs'), 'files', { value: files });
  app.$('#sheetInner [data-save]').click();
  await app.waitFor(() => app.$('#sheetInner .readblock') || /\S/.test(app.text('#readNote')) && !/^Reading \d/.test(app.text('#readNote')), { what: 'read finished' });
}

/* ---------- version ---------- */

test('the header shows the running version; the Bag screen shows version and commit', async () => {
  await app.waitFor(() => app.text('#sub') !== '', { what: 'version loaded' });
  assert.equal(app.text('#sub'), `v${pkg.version}`);
  app.go('bag');
  assert.match(app.text('#about'), new RegExp(`^Carry ${pkg.version.replace(/\./g, '\\.')}( · commit [0-9a-f]{7})?`));
});

test('an export records which version made it', async () => {
  const data = await app.win.eval(`buildExport({ withImages: false })`);
  assert.equal(data.appVersion, pkg.version);
});

/* ---------- reading what Claude returns ---------- */

test('yards are converted only when the screen says yards', () => {
  const n = raw => app.J(`normaliseShotRead(${JSON.stringify(raw)})`);
  const yd = n({ units: 'yd', blocks: [{ club: '7i', target: 140, shots: [{ carry: 150, total: 160 }], summary: { n: 20, fromPinCarry: 10 } }] });
  assert.equal(yd.converted, true);
  assert.deepEqual(yd.blocks[0].shots, [{ carry: 137.2, total: 146.3 }]);
  assert.equal(yd.blocks[0].target, 128);
  assert.deepEqual(yd.blocks[0].summary, { fromPinCarry: 9.1, n: 20 }, 'shot counts are not converted');
  const unknown = n({ units: 'metres?', blocks: [{ club: '7i', shots: [{ carry: 150, total: 160 }] }] });
  assert.equal(unknown.units, 'unknown');
  assert.equal(unknown.converted, false);
  assert.deepEqual(unknown.blocks[0].shots, [{ carry: 150, total: 160 }], 'shown exactly as read');
});

test('implausible, incomplete and odd shots are dropped or flagged, never smoothed over', () => {
  const r = app.J(`normaliseShotRead(${JSON.stringify({ units: 'm', blocks: [{ club: '7i', shots: [
    { carry: '120.5', total: '133' },          // numbers as strings: fine
    { carry: 900, total: 950 },                // not a range shot
    { carry: 110 },                            // no total
    { carry: 100, total: 96, unclear: true },  // unclear, and total < carry
    { carry: 105, total: 118, clubSpeedMph: 400 }, // impossible speed: kept, speed dropped
  ] }, { club: '9i', clubAsShown: '9 Iron', shots: [{ carry: 100, total: 110 }] }, { club: 'PW', shots: [] }] })})`);
  assert.deepEqual(r.blocks[0].shots, [{ carry: 120.5, total: 133 }, { carry: 100, total: 96 }, { carry: 105, total: 118 }]);
  const w = r.blocks[0].warnings.join('\n');
  assert.match(w, /Shot 2 left out: 900\.0 \/ 950\.0m isn't a plausible range shot/);
  assert.match(w, /Shot 3 left out: no total could be read/);
  assert.match(w, /Shot 2 \(100\.0 \/ 96\.0\) was hard to read/);
  assert.match(w, /Shot 2: total 96\.0 is less than carry 100\.0/);
  assert.equal(r.blocks[1].club, null, 'a retired club is not picked for new data');
  assert.match(r.blocks[1].warnings.join(), /Club shown as "9 Iron"/);
  assert.equal(r.blocks.length, 2, 'a block with nothing in it is dropped');
});

/* ---------- the flow ---------- */

test('screenshots go to Claude with the bag, the rules, and enough room for a long list', async () => {
  reply = { units: 'm', notes: 'Toptracer shot list', unreadable: ['one shot behind the pop-up'], blocks: [
    { club: '7i', clubAsShown: '7 Iron', target: 130, shots: [{ carry: 128.4, total: 141.2, clubSpeedMph: 78 }, { carry: 110, total: 131, unclear: true }, { carry: 95, total: 90 }, { carry: null, total: 100 }] },
    { club: 'H4', clubAsShown: 'Hybrid 4', shots: [{ carry: 150, total: 160 }] },
  ] };
  const before = assetFiles();
  await readScreens([png('screen-one', 'a.png'), png('screen-two', 'b.png')]);
  assert.equal(seen.maxTokens, 12000);
  assert.equal(seen.json, true);
  assert.deepEqual(seen.images.map(i => Buffer.from(i.data, 'base64').toString()), ['screen-one', 'screen-two'], 'both screenshots, in order');
  assert.match(seen.prompt, /These 2 images/);
  assert.match(seen.prompt, /7i = 7 Iron/);
  assert.match(seen.prompt, /PW = Pitching Wedge \(46°\)/);
  assert.doesNotMatch(seen.prompt, /9i = /, 'retired clubs are not offered');
  assert.doesNotMatch(seen.prompt, /P = Putter/);
  assert.match(seen.prompt, /Never estimate/);
  assert.match(seen.prompt, /do not guess from the size of the numbers/);
  assert.match(seen.prompt, /Ball speed is not club speed/);
  assert.equal(assetFiles(), before, 'nothing stored yet');
});

test('the review sheet shows the images, each block, and every warning', () => {
  assert.equal(app.$$('#sheetInner .shotimgs img').length, 2);
  assert.match(app.text('#sheetInner .notice'), /a reading, not a measurement/);
  assert.match(app.text('#sheetInner'), /Couldn't read: one shot behind the pop-up/);
  const blocks = app.$$('#sheetInner .readblock');
  assert.equal(blocks.length, 2);
  assert.equal(app.field('club_0').value, '7i');
  assert.equal(app.field('target_0').value, '130');
  assert.equal(app.field('shots_0').value.split('\n').length, 3);
  assert.match(app.text('[data-count="0"]'), /3 shots/);
  const w0 = app.$$('.warnlist li', blocks[0]).map(li => li.textContent);
  assert.ok(w0.some(t => /Shot 4 left out: no carry/.test(t)));
  assert.ok(w0.some(t => /Shot 2 .* was hard to read/.test(t)));
  assert.ok(w0.some(t => /total 90\.0 is less than carry 95\.0/.test(t)));
  assert.equal(app.field('club_1').value, '', 'an unrecognised club is left for him to pick');
  assert.match(blocks[1].textContent, /screen says “Hybrid 4”/);
});

test('saving needs a club for every ticked block', async () => {
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /Pick a club for block 2/);
  assert.equal((await session()).blocks.length, 0);
});

test('fixes made in the sheet are what gets saved, with the screenshots kept alongside', async () => {
  app.fill('keep_1', false);                                // not his club: leave it out
  app.fill('shots_0', app.field('shots_0').value.replace(/^95\s+90.*$/m, '95  104  -'));
  assert.match(app.text('[data-count="0"]'), /3 shots/);
  assert.equal(await app.save(), true);
  const s = await session();
  assert.equal(s.blocks.length, 1);
  const b = s.blocks[0];
  assert.deepEqual([b.club, b.swing, b.target, b.seq], ['7i', 'full', 130, 1]);
  assert.deepEqual(b.shots, [{ carry: 128.4, total: 141.2, speed: 78 }, { carry: 110, total: 131 }, { carry: 95, total: 104 }]);
  assert.equal(b.summary, null);
  assert.deepEqual([b.fromImages.units, b.fromImages.converted, b.fromImages.assets.length], ['m', false, 2]);
  assert.match(b.fromImages.readOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const [i, id] of b.fromImages.assets.entries()) {
    const r = await fetch(`${app.base}/_blob/${id}`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), ['screen-one', 'screen-two'][i], 'the original bytes');
  }
  assert.equal(app.E(`clubStats('7i').n`), 3, 'the new shots feed the analytics');
});

test('the block page says where its numbers came from and shows the screenshots', async () => {
  const b = (await session()).blocks[0];
  app.go('range', { blockId: b.id });
  assert.match(app.text('#view'), /Read from 2 screenshots on .*, then checked before saving/);
  assert.equal(app.$$('#view .shotimgs img').length, 2);
});

test('screenshots in yards are converted and the sheet says so; unknown units are flagged', async () => {
  reply = { units: 'yd', blocks: [{ club: '5W', shots: [{ carry: 170, total: 190 }] }] };
  await readScreens([png('yards', 'y.png')]);
  assert.match(app.text('#sheetInner'), /The screen shows yards, so every distance here has been converted to metres/);
  assert.equal(app.field('shots_0').value.trim(), '155.4  173.7  -');
  assert.equal(await app.save(), true);
  const b = (await session()).blocks.find(x => x.club === '5W');
  assert.equal(b.fromImages.converted, true);
  assert.equal(b.seq, 2, 'appended after the existing block');

  reply = { units: 'unknown', blocks: [{ club: 'PW', shots: [{ carry: 90, total: 97 }] }] };
  await readScreens([png('mystery', 'm.png')]);
  assert.match(app.text('#sheetInner .notice.warn'), /don't say whether these are metres or yards/);
  app.click('#sheetInner [data-close]');
});

test('cancelling the review saves nothing and stores nothing', async () => {
  const before = assetFiles(), blocks = (await session()).blocks.length;
  reply = { units: 'm', blocks: [{ club: 'PW', shots: [{ carry: 90, total: 97 }] }] };
  await readScreens([png('cancel-me', 'c.png')]);
  app.click('#sheetInner [data-close]');
  await sleep(100);
  assert.equal((await session()).blocks.length, blocks);
  assert.equal(assetFiles(), before);
});

test('without an API key on the server, it says what to fix and keeps the sheet open', async () => {
  reply = null;                                             // the real server answers: 503
  await readScreens([png('x', 'x.png')]);
  assert.match(app.text('#readNote'), /check ANTHROPIC_API_KEY on the server/);
  assert.equal(app.sheetOpen(), true);
  app.click('#sheetInner [data-close]');
});

test('an image with no readable shots says so instead of opening an empty review', async () => {
  reply = { units: 'unknown', blocks: [], unreadable: ['the screen is a menu, not a shot list'] };
  await readScreens([png('menu', 'menu.png')]);
  assert.match(app.text('#readNote'), /No shots could be read from that image\. the screen is a menu/);
  assert.equal(app.$('#sheetInner .readblock'), null);
  app.click('#sheetInner [data-close]');
});

test('more than six screenshots at once is refused before anything is sent', async () => {
  seen = null; reply = { units: 'm', blocks: [] };
  app.go('range', { sessionId: 's_img' });
  app.click('#view [data-act="shotsFromImages"]');
  Object.defineProperty(app.field('imgs'), 'files', { value: Array.from({ length: 7 }, (_, i) => png(`p${i}`, `${i}.png`)) });
  assert.equal(await app.save(), false);
  assert.match(app.toast(), /Up to 6 at a time/);
  assert.equal(seen, null);
  app.click('#sheetInner [data-close]');
});

test('screenshots travel in exports, are re-linked on import, and go when their block is deleted', async () => {
  const s = await session();
  const b = s.blocks[0], ids = b.fromImages.assets;
  const exported = app.J('collectAssetIds()');
  for (const id of ids) assert.ok(exported.includes(id), 'in the export');

  // Import a copy under a new session id: the screenshot is re-uploaded and re-linked.
  const data = { format: 'carry-export', version: 1, clubs: [], courses: [], settings: {},
    sessions: [{ ...s, id: 's_imported', blocks: [b] }],
    assets: { [ids[0]]: `data:image/png;base64,${Buffer.from('imported-bytes').toString('base64')}` } };
  await app.win.eval(`applyImport(${JSON.stringify(data)})`);
  const imp = await app.api.get('sessions', 's_imported');
  const newId = imp.blocks[0].fromImages.assets[0];
  assert.notEqual(newId, ids[0], 'rewritten to the re-uploaded copy');
  assert.equal(await (await fetch(`${app.base}/_blob/${newId}`)).text(), 'imported-bytes');

  app.act('deleteBlock', { sid: 's_img', bid: b.id });
  await app.answer(true);
  for (const id of ids) await app.waitFor(async () => (await app.api.blobStatus(id)) === 404, { what: 'screenshot deleted' });
});
