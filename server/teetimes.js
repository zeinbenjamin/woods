// Tee times (2.40.0): what a course's own booking site shows as free, read on
// request and never stored. Only MiClub so far: its public calendar lists the
// rates for each day (18 holes, 9 holes, a late rate…), and each rate's
// timesheet lists the tee times with every spot as Taken or Available. Both
// are public pages that need no login.
//
// Nothing is booked here and nothing about anyone is sent: a request to the
// club's site carries only the date and the rate. What comes back is kept in
// memory for a few minutes, so a phone flicking between filters doesn't ask
// the club again. A page that can't be read says so; it is never "no times".

const TTL = Number(process.env.TEETIMES_TTL_MS || 5 * 60 * 1000);
const ERROR_TTL = 60 * 1000;
// "Check again" (fresh) reads the club again, but not a page read under a minute ago.
const FRESH_MIN = Number(process.env.TEETIMES_FRESH_MS ?? 60 * 1000);
const TIMEOUT = Number(process.env.TEETIMES_TIMEOUT_MS || 10000);
const MAX_RATES = 6;          // rates fetched per course and day: a calendar can list a dozen specials
const UA = 'Carry/1 (personal golf tracker; reads public tee-time pages on request)';
// MiClub's usual id for the main course. Used only when the stored link has
// none (a /cms/public-bookings/ page); a calendar that doesn't parse under it
// is reported as unreadable, not as empty.
const DEFAULT_RESOURCE = '3000000';

const cache = new Map();      // url → { at, ttl, value | error }, or a pending promise

/* ---------- which site ---------- */

// The MiClub site behind a course's booking link, or null. MiClub runs on
// <club>.miclub.com.au and on clubs' own domains under /guests/bookings/.
export function miclubSource(bookingUrl) {
  let u;
  try { u = new URL(bookingUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const onMiclub = /(^|\.)miclub\.com\.au$/i.test(u.hostname);
  if (!onMiclub && !/\/guests\/bookings\//i.test(u.pathname)) return null;
  const given = u.searchParams.get('booking_resource_id') || u.searchParams.get('bookingResourceId');
  const resource = /^\d+$/.test(given || '') ? given : DEFAULT_RESOURCE;
  return { origin: u.origin, resource, guessed: resource !== given };
}

export const calendarUrl = (src, date) =>
  `${src.origin}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${src.resource}&selectedDate=${date}`;
export const timesheetUrl = (src, date, feeId) =>
  `${src.origin}/guests/bookings/ViewPublicTimesheet.msp?bookingResourceId=${src.resource}&selectedDate=${date}&feeGroupId=${feeId}`;

/* ---------- reading the pages ---------- */

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const money = s => { const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(s || ''); return m ? Number(m[1].replace(/,/g, '')) : null; };
const classes = tag => (/\bclass="([^"]*)"/.exec(tag) || [, ''])[1].split(/\s+/);

// Split html at each opening tag whose class list has `cls`, keeping each piece
// up to the next one. The pages nest divs, so this cuts by markers rather than
// matching closing tags.
function blocks(html, cls) {
  const re = new RegExp(`<div\\b[^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'g');
  const at = [...html.matchAll(re)].map(m => m.index);
  return at.map((i, k) => html.slice(i, at[k + 1] ?? html.length));
}

// The calendar: each rate (fee group) with, for each day it's offered, its
// price. A day the rate isn't offered has no cell date and is left out.
export function parseCalendar(html) {
  if (!/feeGroupRow|public-calendar/.test(html)) return null;
  return blocks(html, 'feeGroupRow').map(b => {
    const open = /^<div\b[^>]*>/.exec(b)[0];
    const cls = classes(open);
    const id = (/data-feeid="(\d+)"/.exec(open) || [])[1];
    const name = text((/<h3>([\s\S]*?)<\/h3>/.exec(b) || [, ''])[1]);
    // The name first: MiClub classes every rate that isn't 18 holes as
    // `nineHole`, so Moore Park's "12-Holes" carried it (2.40.1).
    const named = /\b(9|10|12|18)\s*-?\s*holes?\b/i.exec(name);
    const holes = named ? Number(named[1]) : cls.includes('eighteenHoles') ? 18 : cls.includes('nineHole') || cls.includes('nineHoles') ? 9 : null;
    const days = {};
    for (const m of b.matchAll(/<div\b([^>]*\bclass="[^"]*\bcell\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/g)) {
      const date = (/redirectToTimesheet\('\d+'\s*,\s*'(\d{4}-\d{2}-\d{2})'\)/.exec(m[1]) || [])[1];
      if (!date || /\bcell-na\b/.test(m[1])) continue;
      days[date] = { price: money(m[2]), special: /\bcell-promotion\b/.test(m[1]) };
    }
    return id ? { id, name, holes, days } : null;
  }).filter(Boolean);
}

// "01:04 pm" → "13:04"; null for anything else.
export function clock(s) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?m\b/i.exec(s || '') || /\b(\d{1,2}):(\d{2})\b()/.exec(s || '');
  if (!m) return null;
  let h = Number(m[1]); const pm = /p/i.test(m[3]), am = /a/i.test(m[3]);
  if (pm && h < 12) h += 12; if (am && h === 12) h = 0;
  return h < 24 && Number(m[2]) < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

// A timesheet: every tee time with how many of its spots are free.
export function parseTimesheet(html) {
  if (!/row-time|teetime-day-table|list-times/.test(html)) return null;
  return blocks(html, 'row-time').map(b => {
    const time = clock((/<h3>([\s\S]*?)<\/h3>/.exec(b) || [])[1]);
    if (!time) return null;
    const tee = text((/<h4>([\s\S]*?)<\/h4>/.exec(b) || [, ''])[1]) || null;
    const fees = [...b.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => ({ price: money(m[1]), who: text(m[1].replace(/<span\b[^>]*class="price"[^>]*>[\s\S]*?<\/span>/, '')) || null }))
      .filter(f => f.price != null);
    const spots = [...b.matchAll(/<div\b[^>]*\bclass="([^"]*\bcell\b[^"]*)"/g)].map(m => m[1]);
    const free = spots.filter(c => /\bcell-available\b/.test(c)).length;
    return { time, tee, free, of: spots.length, fees };
  }).filter(Boolean);
}

/* ---------- fetching ---------- */

// → { text, at }: the page and when it was read, so a cached answer says how old it is.
async function fetchPage(url, fresh = false) {
  const hit = cache.get(url);
  if (hit instanceof Promise) return hit;
  if (hit && Date.now() - hit.at < (fresh ? Math.min(hit.ttl, FRESH_MIN) : hit.ttl)) { if (hit.error) throw hit.error; return { text: hit.value, at: hit.at }; }
  const p = (async () => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw Object.assign(new Error(`the booking site answered ${res.status}`), { code: 'unreachable' });
      const value = await res.text(), at = Date.now();
      cache.set(url, { at, ttl: TTL, value });
      return { text: value, at };
    } catch (e) {
      const error = e.code ? e : Object.assign(new Error(e.name === 'TimeoutError' ? 'the booking site took too long to answer' : 'the booking site could not be reached'), { code: 'unreachable' });
      cache.set(url, { at: Date.now(), ttl: ERROR_TTL, error });
      throw error;
    }
  })();
  cache.set(url, p);
  return p;
}
export const clearTeeTimeCache = () => cache.clear();

/* ---------- filters ---------- */

// Times that suit: within [from, to] (HH:MM), the holes asked for, and enough
// spots free for the players. Each filter is optional.
export function suits(t, rate, { from, to, holes, players } = {}) {
  if (from && t.time < from) return false;
  if (to && t.time > to) return false;
  if (holes && rate.holes && rate.holes !== holes) return false;
  if (players && t.free < players) return false;
  return t.free > 0;
}

/* ---------- one course, one day ---------- */

// → { status: 'ok', date, calendar, rates: [{ name, holes, price, special, url, times, shown }], fetchedAt }
//   or { status: 'unsupported' | 'unreadable' | 'unreachable', message }.
export async function teeTimes(course, date, filters = {}, { fresh = false } = {}) {
  const src = miclubSource(course && course.bookingUrl);
  if (!src) return { status: 'unsupported', message: course && course.bookingUrl ? 'Carry can only read MiClub booking sites so far.' : 'This course has no booking link.' };
  const calendar = calendarUrl(src, date);
  try {
    const page = await fetchPage(calendar, fresh);
    let oldest = page.at;
    const cal = parseCalendar(page.text);
    if (!cal) return { status: 'unreadable', calendar, message: src.guessed ? 'The booking site\'s calendar could not be read (its course id was a guess: add the full calendar link to the course).' : 'The booking site\'s calendar could not be read.' };
    const offered = cal.filter(r => r.days[date] && (!filters.holes || !r.holes || r.holes === filters.holes)).slice(0, MAX_RATES);
    const rates = [];
    for (const r of offered) {
      const url = timesheetUrl(src, date, r.id);
      const got = await fetchPage(url, fresh);
      oldest = Math.min(oldest, got.at);
      const sheet = parseTimesheet(got.text);
      if (!sheet) { rates.push({ name: r.name, holes: r.holes, price: r.days[date].price, special: r.days[date].special, url, unreadable: true, times: [] }); continue; }
      const times = sheet.filter(t => suits(t, r, filters));
      rates.push({ name: r.name, holes: r.holes, price: r.days[date].price, special: r.days[date].special, url, times, listed: sheet.length });
    }
    // Nothing to show is said, never left as a bare empty list (2.40.1): a
    // calendar with no rates at all (Massey Park's shows times only to
    // registered public members) reads differently from a day with none.
    const note = rates.length ? null
      : !cal.length ? `The club's public calendar lists no rates at all: its times may only show after signing up on its site${src.guessed ? `, or the course id Carry assumed (${src.resource}) is not this course's` : ''}.`
      : !cal.some(r => r.days[date]) ? 'Nothing is open to the public on this day (often a members\' competition).'
      : 'No rate on this day matches the holes asked for.';
    return { status: 'ok', source: 'MiClub', date, calendar, rates, ...(note ? { note } : {}), fetchedAt: new Date(oldest).toISOString() };
  } catch (e) {
    return { status: e.code === 'unreachable' ? 'unreachable' : 'unreadable', calendar, message: e.message };
  }
}

// Query string → filters, refusing nonsense rather than guessing.
export function readFilters(q) {
  const hhmm = v => (/^\d{2}:\d{2}$/.test(v || '') ? v : null);
  const n = v => (/^\d+$/.test(v || '') ? Number(v) : null);
  const holes = n(q.holes);
  return { from: hhmm(q.from), to: hhmm(q.to), holes: [9, 10, 12, 18].includes(holes) ? holes : null, players: Math.min(4, n(q.players) || 0) || null };
}
