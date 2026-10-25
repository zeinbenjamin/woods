// Who is asking: Cloudflare Access, checked here.
//
// Carry is reached through a Cloudflare Tunnel with Access in front. Access
// signs every request that got past its login with a JWT (header
// Cf-Access-Jwt-Assertion, and the CF_Authorization cookie). We verify that
// signature against the team's published keys, the application's audience
// tag, the issuer and the expiry, and take the email from it. Nothing else
// is trusted: not the Cf-Access-Authenticated-User-Email header (anyone who
// can reach the port could send it), and not the network the request came
// from. A request without a valid token — for example straight to
// http://truenas:1818 on the LAN — gets nothing.
//
//   CF_ACCESS_TEAM   the team domain, e.g. elevengrant.cloudflareaccess.com
//   CF_ACCESS_AUD    the Access application's Audience (AUD) tag
//   CF_ACCESS_CERTS_URL  where the keys are (default: the team's own; tests override it)
//   DEV_USER         local development only: every request is this email,
//                    no Cloudflare needed. Never set it on the NAS.
//   CF_ACCESS_MONITOR_ID  the Client ID of the one service token allowed on
//                    /api/admin/* (the monitor chat, 2.14.0). Unset: no admin.
import { createPublicKey, verify as verifySig } from 'node:crypto';

const TEAM = (process.env.CF_ACCESS_TEAM || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const AUD = process.env.CF_ACCESS_AUD || '';
const CERTS_URL = process.env.CF_ACCESS_CERTS_URL || (TEAM ? `https://${TEAM}/cdn-cgi/access/certs` : '');
const DEV_USER = (process.env.DEV_USER || '').trim().toLowerCase();
const MONITOR_ID = (process.env.CF_ACCESS_MONITOR_ID || '').trim();
const SKEW = 60;                      // seconds of clock difference tolerated

// A value still reading REPLACE (the TrueNAS YAML pasted as-is) is no value.
const set = v => !!v && !/REPLACE/i.test(v);
export const authMode = () => (set(TEAM) && set(AUD) ? 'access' : DEV_USER ? 'dev' : 'none');
export const monitorConfigured = () => authMode() === 'access' && set(MONITOR_ID);

/* ---------- Cloudflare's keys ---------- */
let keys = new Map();                 // kid -> KeyObject
let fetchedAt = 0, triedAt = 0, fetching = null;
async function loadKeys(force) {
  if (!force && keys.size && Date.now() - fetchedAt < 3600e3) return;
  if (fetching) return fetching;
  // An unknown kid, Cloudflare not answering, or stale keys it won't refresh: at most one try every 30s.
  if (Date.now() - triedAt < 30e3) return;
  triedAt = Date.now();
  fetching = (async () => {
    try {
      const r = await fetch(CERTS_URL);
      if (!r.ok) throw new Error(`certs ${r.status}`);
      const { keys: list = [] } = await r.json();
      const next = new Map();
      for (const k of list) { if (k.kid && k.kty === 'RSA') next.set(k.kid, createPublicKey({ key: k, format: 'jwk' })); }
      if (next.size) { keys = next; fetchedAt = Date.now(); }
    } finally { fetching = null; }
  })();
  return fetching;
}

const b64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const fail = why => { const e = new Error(why); e.code = 'unauthorised'; throw e; };

// A valid Access token's payload (signature, audience, issuer, time), or an error saying why not.
async function verifyToken(jwt) {
  if (!jwt) fail('no Access token');
  const parts = String(jwt).split('.');
  if (parts.length !== 3) fail('malformed token');
  let header, payload;
  try { header = JSON.parse(b64url(parts[0])); payload = JSON.parse(b64url(parts[1])); } catch { fail('malformed token'); }
  if (header.alg !== 'RS256') fail('unexpected algorithm');
  // A failed refresh keeps the keys we have; with none at all, nobody can be checked.
  await loadKeys(false).catch(e => console.error(`Access keys: ${e.message}`));
  if (!keys.has(header.kid)) await loadKeys(true).catch(e => console.error(`Access keys: ${e.message}`));
  if (!keys.size) throw new Error(`no Access keys from ${CERTS_URL}`);
  const key = keys.get(header.kid);
  if (!key) fail('unknown signing key');
  if (!verifySig('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64url(parts[2]))) fail('bad signature');
  const now = Date.now() / 1000;
  if (typeof payload.exp !== 'number' || payload.exp < now - SKEW) fail('token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + SKEW) fail('token not valid yet');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(AUD)) fail('token is for another application');
  if (payload.iss !== `https://${TEAM}`) fail('token from another team');
  return payload;
}
// The email in a valid Access token: a person. A service token is refused here.
export async function emailFromToken(jwt) {
  const payload = await verifyToken(jwt);
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) fail('token has no email');       // e.g. a service token: not a person
  return email;
}
// The monitor's service token: valid, no email (not a person), and the one Client ID we were told about.
export async function monitorFromToken(jwt) {
  const payload = await verifyToken(jwt);
  if (payload.email) fail('a person\'s token is not accepted here');
  if (!payload.common_name || payload.common_name !== MONITOR_ID) fail('not the monitor\'s service token');
  return payload.common_name;
}

const cookie = (req, name) => {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
};

// Express middleware: sets req.user (an email) or refuses.
export function requireUser() {
  const mode = authMode();
  return async (req, res, next) => {
    if (mode === 'dev') { req.user = DEV_USER; return next(); }
    if (mode === 'none') return res.status(503).json({ error: 'auth_not_configured' });
    try {
      req.user = await emailFromToken(req.get('cf-access-jwt-assertion') || cookie(req, 'CF_Authorization'));
    } catch (e) {
      // Cloudflare's keys couldn't be fetched: not his fault, and not a yes.
      if (e.code !== 'unauthorised') return res.status(503).json({ error: 'auth_unavailable' });
      return res.status(401).json({ error: 'unauthorised', reason: e.message });
    }
    next();
  };
}

// Express middleware for /api/admin/*: GET only, the monitor's service token only.
// Nothing under it ever writes. DEV_USER reaches it locally, for the tests.
export function requireMonitor() {
  const mode = authMode();
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET').json({ error: 'read_only' });
    if (mode === 'dev') { req.monitor = 'dev'; return next(); }
    if (!monitorConfigured()) return res.status(503).json({ error: 'monitor_not_configured' });
    try {
      req.monitor = await monitorFromToken(req.get('cf-access-jwt-assertion') || cookie(req, 'CF_Authorization'));
    } catch (e) {
      if (e.code !== 'unauthorised') return res.status(503).json({ error: 'auth_unavailable' });
      return res.status(401).json({ error: 'unauthorised', reason: e.message });
    }
    next();
  };
}
