// Course pictures in the Courses list (2.46.0, from the hole-maps chat's
// icons.json): a course whose map is linked shows that map's picture at the
// left of its row once the file arrives; a course with no map link, or a map
// id icons.json doesn't have, shows its initials in the same tile. The
// picture is the map file's, so a course that only names a map it isn't
// linked to never borrows it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, card } from './harness.js';

let app;
before(async () => {
  app = await startApp({ seed: { clubs: [], sessions: [], courses: [
    { id: 'c_bex', v: 2, name: 'Bexley Golf Club', holes: card(9), map: { id: 'bexley', linked: '2026-10-01' } },
    { id: 'c_none', v: 2, name: 'Nowhere Park Golf Club', holes: card(9) },
    { id: 'c_gone', v: 2, name: 'Ghost Park', holes: card(9), map: { id: 'no-such-map', linked: '2026-10-01' } },
  ] } });
});
after(() => app && app.stop());

const row = name => app.$$('#view .list .item').find(b => b.querySelector('.t').textContent === name);

test('a linked course shows its map\'s picture, the rest their initials, left of the name', async () => {
  app.go('courses');
  await app.waitFor(() => row('Bexley Golf Club').querySelector('svg.hm-icon:not(.hm-icon-none)'), { what: 'icons.json arriving' });
  const bex = row('Bexley Golf Club'), pic = bex.querySelector('svg.hm-icon');
  assert.equal(pic.getAttribute('aria-label'), 'Bexley Golf Club');
  assert.ok(pic.querySelector('path.i-course') && pic.querySelectorAll('circle.i-green').length > 5, 'the outline and its greens');
  assert.equal(pic.getAttribute('width'), '56');
  assert.equal(bex.querySelector('.crow').firstElementChild, pic, 'at the left of the row');
  const none = row('Nowhere Park Golf Club').querySelector('svg.hm-icon-none');
  assert.equal(none.textContent, 'NP', 'initials, golf words left out');
  assert.ok(row('Ghost Park').querySelector('svg.hm-icon-none'), 'a map id with no picture falls back to initials');
});
