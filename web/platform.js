/* ============================================================
   Platform shim
   The app was written against the artifact runtime: claude.use('db'),
   'assets', 'sample', 'downloads'. This provides the same surface,
   backed by your own server, so the app code is unchanged.
   ============================================================ */
(function () {
  const TOKEN_KEY = 'carry.token';
  const token = () => localStorage.getItem(TOKEN_KEY) || new URLSearchParams(location.search).get('token') || '';
  // A ?token= link is remembered, then taken out of the address bar so it
  // doesn't linger in history, bookmarks or a shared screenshot.
  const q = new URLSearchParams(location.search);
  if (q.get('token')) {
    localStorage.setItem(TOKEN_KEY, q.get('token'));
    q.delete('token');
    try { history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) {}
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, { ...opts, headers: { ...(opts.headers || {}), ...(token() ? { 'x-carry-token': token() } : {}) } });
    if (res.status === 401) { const e = new Error('unauthorised'); e.code = 'unauthorised'; throw e; }
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
    try { const docs = (await api('/' + name)).docs; if (same(docs, cache[name])) return; cache[name] = docs; emit(name); }
    catch (e) { console.warn('refresh failed', name, e); }
  }

  let polling = false;
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const s = await api('/stamps');
      for (const name of Object.keys(listeners)) {
        if (s[name] !== lastStamps[name]) { lastStamps[name] = s[name]; await refresh(name); }
      }
    } catch (e) {
      // A rejected token is worth telling the app about (it asks for the
      // token); anything else is probably offline: keep showing what we have.
      if (e && e.code === 'unauthorised') errorHandlers.forEach(f => f(e));
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
          api('/' + name).then(r => { cache[name] = r.docs; emit(name); }).catch(e => onErr && onErr(e));
          return () => { listeners[name] = (listeners[name] || []).filter(f => f !== cb); };
        },
        doc(id) {
          return {
            async set(body) {
              const saved = await api(`/${name}/${encodeURIComponent(id)}`, {
                method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
              });
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
      err.code = e.status === 503 ? 'unavailable' : e.status === 429 ? 'rate_limited' : e.status === 401 ? 'unavailable' : 'failed';
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
