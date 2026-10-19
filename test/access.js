// A stand-in for Cloudflare Access, so the tests exercise the real check in
// server/auth.js: a real RSA key, its public half served the way Cloudflare
// serves a team's keys, and JWTs signed with it the way Access signs them.
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from 'node:http';

export const TEAM = 'carry-test.cloudflareaccess.com';
export const AUD = 'carry-test-aud';
export const KID = 'test-key-1';
export const ME = 'zein@example.com';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });   // a key Cloudflare never published
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

let certsUrl = null;
export async function certsServer() {
  if (certsUrl) return certsUrl;
  const srv = createServer((req, res) => {
    if (req.url === '/cdn-cgi/access/certs') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ keys: [jwk] })); }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  certsUrl = `http://127.0.0.1:${srv.address().port}/cdn-cgi/access/certs`;
  return certsUrl;
}

// The environment a Carry server needs to trust this stand-in.
export async function accessEnv() {
  return { CF_ACCESS_TEAM: TEAM, CF_ACCESS_AUD: AUD, CF_ACCESS_CERTS_URL: await certsServer(), DEV_USER: '' };
}

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
// A token as Access would issue it; every field can be overridden to forge a bad one.
export function sign(email, { aud = AUD, iss = `https://${TEAM}`, exp = Math.floor(Date.now() / 1000) + 3600, kid = KID, key = privateKey, alg = 'RS256', extra = {} } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64({ aud: [aud], email, exp, iat: Math.floor(Date.now() / 1000), iss, sub: 'u-' + email, type: 'app', ...extra });
  const s = createSign('RSA-SHA256'); s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(key).toString('base64url')}`;
}
export const forgedKey = other.privateKey;
export const header = email => ({ 'cf-access-jwt-assertion': sign(email) });
