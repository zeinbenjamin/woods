// Swing analysis. The API key lives here and never reaches the browser:
// the page posts frames to /api/analyse and this makes the call.
// ANTHROPIC_BASE_URL is the standard override; the tests point it at a fake.
const API = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
const MODEL = process.env.CARRY_MODEL || 'claude-sonnet-4-6';

export async function analyse({ prompt, images = [], maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('ANTHROPIC_API_KEY is not set'); e.code = 'unconfigured'; throw e; }

  // Images before text: Claude reads them better that way.
  const content = [
    ...images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/webp', data: img.data },
    })),
    { type: 'text', text: prompt },
  ];

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    e.code = res.status === 429 ? 'rate_limited' : res.status === 401 ? 'bad_key' : 'upstream';
    throw e;
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { text, usage: data.usage };
}

// The app asks for JSON. Accept it fenced, bare, or buried in prose.
export function parseJson(text) {
  const attempt = t => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  let v = attempt(text);
  if (!v) { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) v = attempt(m[1].trim()); }
  if (!v) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a >= 0 && b > a) v = attempt(text.slice(a, b + 1)); }
  return v;
}
