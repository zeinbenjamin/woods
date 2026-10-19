/* ============================================================
   Platform shim
   The app was written against the artifact runtime: claude.use('db'),
   'assets', 'sample', 'downloads'. This provides the same surface,
   backed by your own server, so the app code is unchanged.
   ============================================================ */
(function () {
  // Sign-in is Cloudflare Access (2.0.0): the browser carries Access's
  // cookie and Cloudflare adds a signed header the server checks, so this
  // file sends nothing of its own. The 1.x token is no longer used: forget
  // a stored one, and take an old ?token= link out of the address bar.
  try { localStorage.removeItem('carry.token'); } catch (e) {}
  const q = new URLSearchParams(location.search);
  if (q.has('token')) {
    q.delete('token');
    try { history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) {}
  }
  const fault = (code, message) => { const e = new Error(message || code); e.code = code; return e; };

  async function api(path, opts = {}) {
    // redirect: 'manual' — when the Access session has run out, Cloudflare
    // answers with a redirect to its login page instead of passing the
    // request on. Following it would fail as a cross-site request; seeing it
    // tells the app to send him to sign in again.
    const res = await fetch('/api' + path, { ...opts, redirect: 'manual' });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw fault('signed_out');
    // Carry itself refused (its own JSON says so): no valid Access token, so
    // this didn't come through Cloudflare — the home address, for instance.
    // Any other 401 is Cloudflare's, about an Access session that ran out.
    if (res.status === 401) {
      const body = await res.json().catch(() => null);
      throw fault(body && body.error === 'unauthorised' ? 'unauthorised' : 'signed_out');
    }
    if (!res.ok) { const e = new Error(await res.text().catch(() => res.statusText)); e.code = 'request_failed'; e.status = res.status; throw e; }
    return res.status === 204 ? null : res.json();
  }

  /* ---------- db ----------
     The artifact runtime pushes changes; here we poll a cheap stamp
     endpoint and refetch only what moved. Local writes notify listeners
     immediately, so the UI never waits for the next poll. */
  const cache = {};                 // collection -> array of docs
  const listeners = {};             // collection -> [cb]
  const errorHandlers = new Set();  // onSnapshot error callbacks
  let lastStamps = {};

  const emit = name => (listeners[name] || []).forEach(cb => cb({
    docs: (cache[name] || []).map(d => ({ id: d.id, exists: true, data: () => d })),
  }));

  // A poll that brings back exactly what we already hold (usually our own
  // write coming round again) doesn't redraw the app.
  const same = (a, b) => {
    const key = docs => JSON.stringify((docs || []).slice().sort((x, y) => String(x.id).localeCompare(String(y.id))));
    return key(a) === key(b);
  };
  async function refresh(name) {
    try { const docs = withPending(name, (await api('/' + name)).docs); if (same(docs, cache[name])) return; cache[name] = docs; emit(name); }
    catch (e) { console.warn('refresh failed', name, e); }
  }

  /* ---------- outbox ----------
     On the course there often isn't signal. A save that can't reach the
     server is kept on the phone (localStorage), shown as saved, and sent
     when the connection comes back: on every poll and when the browser says
     it's online. Only the latest copy of each document is kept; a newer save
     that does get through replaces a waiting one. Until a waiting copy is
     sent, it wins over what the server says, so a poll can't undo it. */
  const OUTBOX = 'carry.outbox';
  const readBox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '{}') || {}; } catch (e) { return {}; } };
  const writeBox = box => { try { if (Object.keys(box).length) localStorage.setItem(OUTBOX, JSON.stringify(box)); else localStorage.removeItem(OUTBOX); } catch (e) {} };
  const announce = () => { try { window.dispatchEvent(new CustomEvent('carry:outbox', { detail: { pending: Object.keys(readBox()).length } })); } catch (e) {} };
  function withPending(name, docs) {
    const mine = Object.values(readBox()).filter(e => e.col === name);
    if (!mine.length) return docs;
    const ids = new Set(mine.map(e => e.id));
    return (docs || []).filter(d => !ids.has(d.id)).concat(mine.map(e => e.body));
  }
  // No connection at all, or Cloudflare saying the NAS behind it can't be reached.
  const unreachable = e => (e && e.name === 'TypeError') || (e && e.code === 'request_failed' && [502, 504, 520, 521, 522, 523, 524, 530].includes(e.status));
  const put = (name, id, body) => api(`/${name}/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      for (const [key, e] of Object.entries(readBox())) {
        try { await put(e.col, e.id, e.body); }
        catch (err) {
          if (unreachable(err) || (err && (err.code === 'signed_out' || err.code === 'unauthorised'))) break;   // still offline, or sign in first
          console.warn('outbox: the server refused a waiting save; keeping it', key, err);
          continue;
        }
        const box = readBox();
        if (box[key] && box[key].t === e.t) { delete box[key]; writeBox(box); }
      }
      announce();
    })().finally(() => { flushing = null; });
    return flushing;
  }
  window.addEventListener('online', () => flush());
  window.carryOutbox = () => ({ pending: Object.keys(readBox()).length, flush });

  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      if (Object.keys(readBox()).length) await flush();
      const s = await api('/stamps');
      for (const name of Object.keys(listeners)) {
        if (s[name] !== lastStamps[name]) { lastStamps[name] = s[name]; await refresh(name); }
      }
    } catch (e) {
      // Being signed out is worth telling the app about (it offers to sign in
      // again); anything else is probably offline: keep showing what we have.
      if (e && (e.code === 'unauthorised' || e.code === 'signed_out')) errorHandlers.forEach(f => f(e));
    }
    finally { polling = false; }
  }
  setInterval(poll, Number(window.CARRY_POLL_MS || 5000));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  const dbApi = {
    collection(name) {
      return {
        onSnapshot(cb, onErr) {
          (listeners[name] = listeners[name] || []).push(cb);
          if (onErr) errorHandlers.add(onErr);
          api('/' + name).then(r => { cache[name] = withPending(name, r.docs); emit(name); }).catch(e => onErr && onErr(e));
          return () => { listeners[name] = (listeners[name] || []).filter(f => f !== cb); };
        },
        doc(id) {
          return {
            async set(body) {
              const key = name + '/' + id;
              let saved;
              // A waiting copy being sent right now must land before this newer one.
              if (flushing) await flushing.catch(() => {});
              try {
                saved = await put(name, id, body);
                // This newer copy got through: an older waiting one must never follow it.
                const box = readBox(); if (box[key]) { delete box[key]; writeBox(box); announce(); }
              } catch (e) {
                if (!unreachable(e)) throw e;
                // Kept on the phone until there's signal.
                const box = readBox(); box[key] = { col: name, id, body: { ...body, id }, t: Date.now() }; writeBox(box);
                saved = box[key].body; announce();
              }
              const list = cache[name] = (cache[name] || []).filter(d => d.id !== id);
              list.push(saved); emit(name);
              return saved;
            },
            async delete() {
              await api(`/${name}/${encodeURIComponent(id)}`, { method: 'DELETE' });
              cache[name] = (cache[name] || []).filter(d => d.id !== id); emit(name);
            },
          };
        },
      };
    },
  };

  /* ---------- assets ---------- */
  const assetsApi = {
    async upload(blob, { type } = {}) {
      return api('/assets', { method: 'POST', headers: { 'content-type': type || blob.type || 'application/octet-stream' }, body: blob });
    },
    async delete(id) { return api(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    async list() { return { assets: [], usage: {} }; },
  };

  /* ---------- sample ----------
     The reason for self-hosting: images work here, because the key is on
     the server. Same signature the app already calls. */
  const blobToBase64 = b => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('unreadable'));
    r.readAsDataURL(b);
  });
  async function callSample(prompt, opts = {}, wantJson) {
    const images = [];
    for (const img of (opts.images || [])) {
      images.push({ mediaType: img.type || 'image/webp', data: await blobToBase64(img) });
    }
    let out;
    try {
      out = await api('/analyse', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, images, json: !!wantJson, ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}) }),
      });
    } catch (e) {
      const err = new Error(e.message);
      err.code = e.status === 503 ? 'unavailable' : e.status === 429 ? 'rate_limited' : e.code === 'unauthorised' || e.code === 'signed_out' ? 'unavailable' : 'failed';
      throw err;
    }
    if (opts.onText) opts.onText({ text: out.text, delta: out.text });
    if (!wantJson) return { text: out.text };
    if (!out.json) { const e = new Error('not json'); e.code = 'invalid_json'; e.text = out.text; throw e; }
    return out.json;
  }
  const sampleApi = Object.assign(
    (prompt, opts) => callSample(prompt, opts, false),
    {
      json: (prompt, opts) => callSample(prompt, opts, true),
      // Your own server, your own key: images are available.
      limits: async () => ({ images: { maxCount: 20, maxBytes: 5 * 1024 * 1024, mediaTypes: ['image/webp', 'image/jpeg', 'image/png'] } }),
    });

  /* ---------- downloads ----------
     No consent prompt needed: it's the browser's own download. */
  const downloadsApi = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { status: 'saved', filename };
    },
  };

  // Anything left waiting from last time goes as soon as the page is up.
  setTimeout(() => { announce(); if (Object.keys(readBox()).length) flush(); }, 0);

  // Who is signed in (the email Cloudflare Access vouched for).
  window.carryMe = () => api('/me');

  window.claude = {
    async use(name) {
      if (name === 'db') return dbApi;
      if (name === 'assets') return assetsApi;
      if (name === 'sample') return sampleApi;
      if (name === 'downloads') return downloadsApi;
      return null;
    },
  };
})();
