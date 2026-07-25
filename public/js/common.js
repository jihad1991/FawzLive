// Shared frontend helpers: API fetch, toast, language toggle, WS.
export const api = {
  async get(url) { const r = await fetch(url, { credentials: 'same-origin' }); return r.json(); },
  async send(url, method, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      // Only claim a JSON body when one exists — Fastify 400s on an empty JSON body.
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  },
  post(url, body) { return this.send(url, 'POST', body); },
  put(url, body) { return this.send(url, 'PUT', body); },
  patch(url, body) { return this.send(url, 'PATCH', body); },
  del(url) { return this.send(url, 'DELETE'); },
};

export function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2600);
}

const LANG_KEY = 'ld_lang';
export function initLang() {
  const lang = localStorage.getItem(LANG_KEY) || 'ar';
  document.body.setAttribute('data-lang', lang);
  document.documentElement.lang = lang;
  return lang;
}
export function toggleLang() {
  const next = document.body.getAttribute('data-lang') === 'ar' ? 'en' : 'ar';
  localStorage.setItem(LANG_KEY, next);
  document.body.setAttribute('data-lang', next);
  document.documentElement.lang = next;
  return next;
}

// Auto-reconnecting WebSocket. onMessage(evt) receives parsed objects.
export function connectWS(onMessage) {
  let ws, alive = true, retry = 0;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  function open() {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { if (alive) setTimeout(open, Math.min(5000, 500 * ++retry)); };
    ws.onerror = () => ws.close();
  }
  open();
  return { close() { alive = false; ws?.close(); } };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
