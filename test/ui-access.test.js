// Who can play (2.39.0): public, private, closed or not known, shown on the
// Courses list and the course page. The form used to have one checkbox for
// "public booking", so saving any course whose access wasn't known stored
// `bookable: false`, which reads as members only. Now it's a choice with "Not
// known", and an unset `bookable` is never shown as private.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startApp, card } from './harness.js';

const course = (id, name, extra = {}) => ({ id, v: 2, name, tee: 'white', holes: card(9), ...extra });
let app;
before(async () => {
  app = await startApp({ seed: { clubs: [], sessions: [], courses: [
    course('c_pub', 'Public GC', { bookable: true, prereg: true, bookingUrl: 'https://pub.miclub.com.au/guests/bookings/ViewPublicCalendar.msp', bookingNote: 'Register as a public member first.' }),
    course('c_priv', 'Private GC', { bookable: false, bookingNote: 'Private: members and guests.' }),
    course('c_shut', 'Closed GC', { closed: true, prereg: true }),
    course('c_unk', 'Unknown GC'),
  ] } });
});
after(() => app && app.stop());
const row = name => app.$$('.item').find(b => b.textContent.includes(name));
const tags = name => [...row(name).querySelectorAll('.tag')].map(t => [t.textContent, t.className]);

test('the Courses list tags each course public, private or closed, and nothing when not known', () => {
  app.go('courses');
  // 2.60.0 (he asked): the map pins' colours, and 'private' in both places.
  assert.deepEqual(tags('Public GC'), [['public', 'tag acc-public'], ['pre-register', 'tag']]);
  assert.deepEqual(tags('Private GC'), [['private', 'tag acc-private']]);
  assert.deepEqual(tags('Closed GC'), [['closed', 'tag acc-closed']], 'a closed course does not say pre-register');
  const css = app.doc.querySelector('style').textContent;
  for (const [a, v] of Object.entries(app.J('CM_COLOUR'))) if (a !== 'unknown') assert.match(css, new RegExp(`\\.tag\\.acc-${a} \\{ background: var\\(${v}\\)`), `${a}: the pin's colour`);
  assert.deepEqual(tags('Unknown GC'), []);
});

test('the course page says who can play and how to book', () => {
  app.go('courses', { courseId: 'c_pub' });
  assert.match(app.text('#courseAccess'), /^Public: anyone can book\. Needs pre-registration Book$/);
  assert.equal(app.text('#courseBookingNote'), 'Register as a public member first.');
  assert.match(app.text('#courseInfo summary'), /public/);
  app.go('courses', { courseId: 'c_priv' });
  assert.equal(app.text('#courseAccess'), 'Private: members and guests');
  app.go('courses', { courseId: 'c_unk' });
  assert.equal(app.text('#courseAccess'), 'Not known');
  assert.equal(app.$('#courseBookingNote'), null);
});

test('saving a course whose access is not known keeps it not known', async () => {
  app.act('editCourse', { id: 'c_unk' });
  assert.equal(app.$('#sheetInner [name="access"]').value, '');
  assert.equal(await app.save(), true);
  const c = await app.api.get('courses', 'c_unk');
  assert.equal(c.bookable, null, 'not stored as private');
  assert.equal(c.closed, undefined);
});

test('the form sets public, private and closed, and the booking note', async () => {
  app.act('editCourse', { id: 'c_unk' });
  app.$('#sheetInner [name="access"]').value = 'private';
  app.fill('bookingNote', 'Guests of members only.');
  assert.equal(await app.save(), true);
  let c = await app.api.get('courses', 'c_unk');
  assert.equal(c.bookable, false); assert.equal(c.bookingNote, 'Guests of members only.');
  app.act('editCourse', { id: 'c_unk' });
  assert.equal(app.$('#sheetInner [name="access"]').value, 'private');
  app.$('#sheetInner [name="access"]').value = 'closed';
  assert.equal(await app.save(), true);
  c = await app.api.get('courses', 'c_unk');
  assert.equal(c.closed, true); assert.equal(c.bookable, null);
  app.act('editCourse', { id: 'c_unk' });
  app.$('#sheetInner [name="access"]').value = 'public';
  assert.equal(await app.save(), true);
  c = await app.api.get('courses', 'c_unk');
  assert.equal(c.closed, undefined, 'reopened'); assert.equal(c.bookable, true);
});

test('the imports say who can play wherever the 2026-10-29 audit found out, with where it was found', () => {
  const dir = new URL('../imports/', import.meta.url);
  const all = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir))).courses[0]]);
  const audited = all.filter(([, c]) => /booking: web search of 2026-10-29/.test(c.source));
  assert.equal(audited.length, 77);
  for (const [f, c] of audited) {
    assert.ok(c.bookable === true || c.bookable === false || c.bookable === undefined, `${f}: bookable is a yes, a no or absent`);
    assert.ok(!c.bookingUrl || /^https:\/\//.test(c.bookingUrl), `${f}: an https booking link`);
    assert.ok(!(c.closed && c.bookable != null), `${f}: a closed course is neither public nor private`);
  }
  const count = v => audited.filter(([, c]) => c.bookable === v).length;
  // Castle Hill moved to private on the recheck of 2026-11-01 (its own site: "one of Sydney's leading private golf clubs").
  assert.deepEqual([count(true), count(false), audited.filter(([, c]) => c.closed).length], [50, 21, 1]);
  const kogarah = all.find(([f]) => f === 'kogarah.json')[1];
  assert.equal(kogarah.closed, true);
});
