// Import a backup takes many files at once (2.38.0, he had 77 course imports
// to load one by one): every file is checked first, one question covers them
// all, a file that isn't an export is named and skipped, and the counts add up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, card } from './harness.js';

let app;
before(async () => { app = await startApp({ seed: { clubs: [], courses: [], sessions: [] } }); });
after(() => app && app.stop());
const exportOf = (id, name) => ({ format: 'carry-export', version: 2, courses: [{ id, v: 2, name, tee: 'white', holes: card(9) }], sessions: [], clubs: [] });
const file = (name, body) => new app.win.File([typeof body === 'string' ? body : JSON.stringify(body)], name, { type: 'application/json' });

test('three course files and a stray become three courses, with the stray named and skipped', async () => {
  app.go('settings');
  app.click('#yourData [data-act="importData"]');
  const input = app.field('file');
  assert.ok(input.hasAttribute('multiple'), 'the picker takes many');
  Object.defineProperty(input, 'files', { value: [file('a.json', exportOf('c_a', 'Alpha GC')), file('notes.txt', 'hello'), file('b.json', exportOf('c_b', 'Bravo GC')), file('c.json', exportOf('c_c', 'Charlie GC'))] });
  const saving = app.save();
  await app.waitFor(() => app.confirmOpen(), { what: 'the one question' });
  assert.match(app.text('#confirmDlg'), /Import 3 courses, 0 sessions and 0 images from 3 files\?/);
  assert.match(app.text('#confirmDlg'), /1 file skipped: notes\.txt: not valid JSON/);
  await app.answer(true);
  assert.equal(await saving, true, 'the sheet closes');
  await app.waitFor(async () => (await app.api.list('courses')).length === 3, { what: 'courses saved' });
  assert.deepEqual((await app.api.list('courses')).map(c => c.name).sort(), ['Alpha GC', 'Bravo GC', 'Charlie GC']);
});

test('only wrong files: refused with the reason, nothing asked, nothing saved', async () => {
  app.go('settings');
  app.click('#yourData [data-act="importData"]');
  Object.defineProperty(app.field('file'), 'files', { value: [file('x.json', { format: 'other' }), file('y.json', '{')] });
  assert.equal(await app.save(), false);
  assert.equal(app.toast(), 'None of those are Carry export files');
  assert.match(app.text('#imProg'), /x\.json: not a Carry export · y\.json: not valid JSON/);
  assert.ok(!app.confirmOpen());
  app.click('#sheetInner [data-close]');
  app.click('#yourData [data-act="importData"]');
  Object.defineProperty(app.field('file'), 'files', { value: [file('x.json', { format: 'other' })] });
  assert.equal(await app.save(), false);
  assert.equal(app.toast(), 'Not a Carry export file', 'one file: the old wording');
  assert.equal((await app.api.list('courses')).length, 3);
});
