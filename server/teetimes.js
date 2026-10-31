// Tee times (2.40.0): what a course's own booking site shows as free, read on
// request and never stored. MiClub, and TeeItUp since 2.43.0 (below). MiClub's public calendar lists the
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
// <club>.miclub.com.au and on clubs' own domains under /guests/bookings/, or
// as /guests/<Page>.msp (Gordon's and Richmond's ListBookingEvents.msp links,
// 2.41.3: their standard calendar is there too, read 2026-10-30).
export const MICLUB_PATH = /\/guests\/(bookings\/|\w+\.msp$)/i;
export function miclubSource(bookingUrl) {
  let u;
  try { u = new URL(bookingUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const onMiclub = /(^|\.)miclub\.com\.au$/i.test(u.hostname);
  if (!onMiclub && !MICLUB_PATH.test(u.pathname)) return null;
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
  // A calendar with no public rates at all (Camden, Castle Hill, Cronulla and
  // Richmond, seen 2026-11-01) is a page of its own: "No rows meeting selected
  // criteria", no days, no rates. Nothing listed, not unreadable.
  if (!/feeGroupRow|public-calendar/.test(html)) return /No rows meeting selected criteria/i.test(html || '') ? [] : null;
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
    return id ? { id, name, holes, ...(named ? {} : { classed: true }), days } : null;
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
// `headers` are added to the request and to the cache key (TeeItUp's alias).
async function fetchPage(url, fresh = false, headers = null) {
  const key = headers ? url + ' ' + JSON.stringify(headers) : url;
  const hit = cache.get(key);
  if (hit instanceof Promise) return hit;
  if (hit && Date.now() - hit.at < (fresh ? Math.min(hit.ttl, FRESH_MIN) : hit.ttl)) { if (hit.error) throw hit.error; return { text: hit.value, at: hit.at }; }
  const p = (async () => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html', ...(headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`the booking site answered ${res.status}`), { code: 'unreachable', sample: body.slice(0, 600) });
      }
      const value = await res.text(), at = Date.now();
      cache.set(key, { at, ttl: TTL, value });
      return { text: value, at };
    } catch (e) {
      // Carry's own errors carry a string code; a timeout's DOMException has a
      // numeric one (23), which once passed it through raw as "unreadable" (Gordon, 2026-11-01).
      const error = typeof e.code === 'string' ? e : Object.assign(new Error(e.name === 'TimeoutError' ? 'the booking site took too long to answer' : 'the booking site could not be reached'), { code: 'unreachable' });
      cache.set(key, { at: Date.now(), ttl: ERROR_TTL, error });
      throw error;
    }
  })();
  cache.set(key, p);
  return p;
}
export const clearTeeTimeCache = () => cache.clear();

/* ---------- TeeItUp: GolfNow's booking engine for clubs ----------
   Read at Zein's decision (2026-10-30), knowing GolfNow's terms forbid
   automated reading ("software robots, spider, crawlers…", s.2); read as
   politely as MiClub: only when he searches, once per course and day, kept
   five minutes, nothing stored. A club's page (<alias>.book.teeitup.com/
   ?course=<facility id>, the GolfNow facility id) is built in the browser;
   the times come from GolfNow's booking API, asked with the club's alias.
   Seen live on the NAS (Georges River, 1 Nov 2026, searched 30 Oct): a day
   per facility, its `teetimes`, each with rates, as below. `maxPlayers` is
   the players still bookable, not the group's size (it equalled the spots
   free on every time), so the group's size isn't known and `of` is null.
   Still read defensively: an answer that doesn't fit comes back `unreadable`
   with the start of the reply in `sample`. */
const TEEITUP_API = (process.env.TEEITUP_API || 'https://phx-api-be-east-1b.kenna.io').replace(/\/$/, '');
export const TEEITUP_HOST = /^([a-z0-9-]+)\.book\.teeitup\.com$/i;
export function teeitupSource(bookingUrl) {
  let u;
  try { u = new URL(bookingUrl); } catch { return null; }
  const m = TEEITUP_HOST.exec(u.hostname), facility = u.searchParams.get('course');
  return m && /^\d+$/.test(facility || '') ? { alias: m[1].toLowerCase(), facility } : null;
}
export const teeitupPage = (src, date) => `https://${src.alias}.book.teeitup.com/?course=${src.facility}&date=${date}`;
export const teeitupApi = (src, date) => `${TEEITUP_API}/v2/tee-times?date=${date}&facilityIds=${src.facility}`;

// An ISO time with an offset is moved to Sydney's clock; one without is taken as written.
function localClock(iso, tz = 'Australia/Sydney') {
  if (typeof iso !== 'string') return null;
  if (/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const v = t => (p.find(x => x.type === t) || {}).value;
    return `${v('hour')}:${v('minute')}`;
  }
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}
// Fees may be in cents (4500) or dollars (45): a green fee of $1,000 or more
// is taken as cents. The live page shows dollars, which settles it.
const dollars = v => (typeof v !== 'number' || !isFinite(v) ? null : v >= 1000 ? v / 100 : v);
const ratePrice = r => dollars(r.greenFeeWalking ?? r.greenFee ?? r.price ?? r.greenFeeCart);
const rateHoles = r => { const h = Array.isArray(r.holes) ? Math.max(...r.holes) : Number(r.holes); return [9, 10, 12, 18].includes(h) ? h : null; };

// The API's answer → the same rates as a MiClub calendar gives, or null when
// it isn't the shape expected.
export function parseTeeitup(body, src, date) {
  let j;
  try { j = typeof body === 'string' ? JSON.parse(body) : body; } catch { return null; }
  const days = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : [j];
  if (!days.some(d => d && Array.isArray(d.teetimes))) return null;
  const groups = new Map();
  for (const tt of days.flatMap(d => (d && Array.isArray(d.teetimes) ? d.teetimes : []))) {
    const time = localClock(tt.teetime || tt.time);
    if (!time) continue;
    const left = Number.isFinite(Number(tt.maxPlayers)) && tt.maxPlayers != null ? Number(tt.maxPlayers) : null;
    for (const r of Array.isArray(tt.rates) && tt.rates.length ? tt.rates : [{}]) {
      const allowed = Array.isArray(r.allowedPlayers) && r.allowedPlayers.length ? Math.max(...r.allowedPlayers) : null;
      const free = allowed ?? left, name = String(r.name || 'Tee time'), holes = rateHoles(r), price = ratePrice(r);
      if (free == null) continue;
      const key = name + '|' + holes;
      if (!groups.has(key)) groups.set(key, { name, holes, price, special: false, url: teeitupPage(src, date), times: [] });
      const g = groups.get(key);
      if (price != null && (g.price == null || price < g.price)) g.price = price;
      g.times.push({ time, tee: tt.backNine ? 'Back nine' : null, free, of: null, fees: price != null ? [{ price, who: name }] : [] });
    }
  }
  return [...groups.values()].map(g => ({ ...g, times: g.times.sort((a, b) => (a.time < b.time ? -1 : 1)) })).sort((a, b) => (b.holes || 0) - (a.holes || 0));
}

async function teeitupTimes(src, date, filters, fresh) {
  const page = teeitupPage(src, date);
  try {
    const got = await fetchPage(teeitupApi(src, date), fresh, { 'x-be-alias': src.alias, accept: 'application/json' });
    const all = parseTeeitup(got.text, src, date);
    if (!all) return { status: 'unreadable', source: 'TeeItUp', calendar: page, message: 'GolfNow\'s booking engine answered, but not in a form Carry can read yet.', sample: got.text.slice(0, 1500) };
    const offered = all.filter(r => !filters.holes || !r.holes || r.holes === filters.holes);
    const rates = offered.map(r => { const times = r.times.filter(t => suits(t, r, filters)); return { ...r, times, listed: r.times.length }; });
    const note = rates.length ? null : !all.length ? 'Nothing is open to the public on this day.' : 'No rate on this day matches the holes asked for.';
    return { status: 'ok', source: 'TeeItUp', date, calendar: page, rates, ...(note ? { note } : {}), fetchedAt: new Date(got.at).toISOString() };
  } catch (e) {
    return { status: e.code === 'unreachable' ? 'unreachable' : 'unreadable', source: 'TeeItUp', calendar: page, message: e.message, ...(e.sample ? { sample: e.sample } : {}) };
  }
}

/* ---------- Quick18 (Sagacity Golf): Lane Cove ----------
   Seen 2026-11-01 (through a page reader; this container can't reach it):
   <club>.quick18.com/teetimes/searchmatrix?teedate=YYYYMMDD is a plain page,
   no login, a `matrixTable` with a column per rate (`matrixHdrSched`) and a
   row per time: `mtrxTeeTimes` ("6:00" + an AM/PM div), `matrixPlayers`
   ("1 to 4 players", "1 or 2 players", "1 player": the players it can still
   take) and a `matrixsched` cell per rate, its `mtrxPrice` and a Select link
   to book that time, or `mtrxInactive` when the rate isn't offered then.
   A time that's full isn't listed. Bookings open 14 days ahead. */
export const QUICK18_HOST = /^([a-z0-9-]+)\.quick18\.com$/i;
export const QUICK18_PATH = /^\/teetimes\/searchmatrix\b/i;
export function quick18Source(bookingUrl) {
  let u;
  try { u = new URL(bookingUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  return QUICK18_HOST.test(u.hostname) || QUICK18_PATH.test(u.pathname) ? { origin: u.origin } : null;
}
export const quick18Url = (src, date) => `${src.origin}/teetimes/searchmatrix?teedate=${date.replace(/-/g, '')}`;
const rateHolesByName = n => { const m = /\b(9|10|12|18)\s*-?\s*holes?\b/i.exec(n || ''); return m ? Number(m[1]) : null; };

// → [{ name, holes, price, special, url, times: [{ time, tee, free, of, fees, url }] }],
//   [] for a day with no times, or null for a page that isn't a tee-time matrix.
// Member rates are left out: they need a membership the search can't know of.
export function parseQuick18(html, src, date) {
  const table = /<table\b[^>]*\bclass="[^"]*\bmatrixTable\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html || '');
  if (!table) return /no tee times|no times available|not available for booking/i.test(text(html || '')) ? [] : null;
  const names = [...table[1].matchAll(/<th\b[^>]*\bclass="[^"]*\bmatrixHdrSched\b[^"]*"[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
  if (!names.length) return null;
  const page = quick18Url(src, date);
  const rates = names.map(name => ({ name, holes: rateHolesByName(name), price: null, special: false, url: page, times: [] }));
  for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    const tc = cells.find(c => /\bmtrxTeeTimes\b/.test(c[1])), pc = cells.find(c => /\bmatrixPlayers\b/.test(c[1]));
    if (!tc || !pc) continue;
    const time = clock(text(tc[2]));
    const free = Math.max(0, ...(text(pc[2]).match(/\d+/g) || []).map(Number));
    if (!time || !free) continue;
    cells.filter(c => /\bmatrixsched\b/.test(c[1])).forEach((c, i) => {
      const r = rates[i];
      if (!r || /\bmtrxInactive\b/.test(c[1])) return;
      const price = money((/class="[^"]*\bmtrxPrice\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(c[2]) || [])[1]);
      const href = (/<a\b[^>]*\bhref="([^"]+)"/i.exec(c[2]) || [])[1];
      let url = null;
      try { url = href ? new URL(href.replace(/&amp;/g, '&'), src.origin).href : null; } catch {}
      if (price != null && (r.price == null || price < r.price)) r.price = price;
      r.times.push({ time, tee: null, free, of: null, fees: price != null ? [{ price, who: r.name }] : [], ...(url ? { url } : {}) });
    });
  }
  return rates.filter(r => r.times.length && !/\bmembers?\b/i.test(r.name)).sort((a, b) => (b.holes || 0) - (a.holes || 0));
}

async function quick18Times(src, date, filters, fresh) {
  const page = quick18Url(src, date);
  try {
    const got = await fetchPage(page, fresh);
    const all = parseQuick18(got.text, src, date);
    if (!all) return { status: 'unreadable', source: 'Quick18', calendar: page, message: 'The booking site\'s tee sheet could not be read.' };
    const offered = all.filter(r => !filters.holes || !r.holes || r.holes === filters.holes);
    const rates = offered.map(r => { const times = r.times.filter(t => suits(t, r, filters)); return { ...r, times, listed: r.times.length }; });
    const note = rates.length ? null : !all.length ? 'No times are open to the public on this day.' : 'No rate on this day matches the holes asked for.';
    return { status: 'ok', source: 'Quick18', date, calendar: page, rates, ...(note ? { note } : {}), fetchedAt: new Date(got.at).toISOString() };
  } catch (e) {
    return { status: e.code === 'unreachable' ? 'unreachable' : 'unreadable', source: 'Quick18', calendar: page, message: e.message };
  }
}

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
  const tee = teeitupSource(course && course.bookingUrl);
  if (tee) return teeitupTimes(tee, date, filters, fresh);
  const q18 = quick18Source(course && course.bookingUrl);
  if (q18) return quick18Times(q18, date, filters, fresh);
  const src = miclubSource(course && course.bookingUrl);
  if (!src) return { status: 'unsupported', message: course && course.bookingUrl ? 'Carry can read MiClub, TeeItUp and Quick18 booking sites so far.' : 'This course has no booking link.' };
  const calendar = calendarUrl(src, date);
  try {
    const page = await fetchPage(calendar, fresh);
    let oldest = page.at;
    const cal = parseCalendar(page.text);
    if (!cal) return { status: 'unreadable', calendar, message: src.guessed ? 'The booking site\'s calendar could not be read (its course id was a guess: add the full calendar link to the course).' : 'The booking site\'s calendar could not be read.' };
    // A rate with no holes in its name has them from MiClub's class, which is
    // 18 for anything not called nine: on a shorter card (Newgreens
    // Chatswood's 12, whose "Twilight" read as 18, 2026-11-01) the card wins.
    const card = Array.isArray(course.holes) ? course.holes.length : 0;
    for (const r of cal) if (r.classed && r.holes === 18 && card && card < 18) r.holes = card;
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
      : !cal.length ? `The club's public calendar lists nothing from this day: bookings may not be open yet (Woollahra's open a few days ahead), or its times may only show after signing up on its site${src.guessed ? `, or the course id Carry assumed (${src.resource}) is not this course's` : ''}.`
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
