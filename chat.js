/* Aurelia Air — flight chat: messages, history and transports. No dependencies, no DOM.
 *
 * Two transports, chosen automatically:
 *   live  – AWS AppSync Events (WebSocket pub/sub). Used when chat-config.js (written by aws/chat-deploy.sh)
 *           provides { httpDomain, realtimeDomain, apiKey }.
 *   local – BroadcastChannel between tabs of the same browser. Used when there is no backend, so the chat
 *           still works on any static host (and in mobile.html next to index.html).
 *
 * Protocol reference: https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html
 * Every incoming message is validated and later rendered with textContent, never as HTML.
 */
(() => {
  'use strict';

  const CFG = window.AURELIA_CHAT || {};
  const LIVE = !!(CFG.apiKey && CFG.httpDomain && (CFG.realtimeUrl || CFG.realtimeDomain));
  const NAMESPACE = 'flights';            // must match the ChannelNamespace in aws/chat.yaml
  const MAX_TEXT = 500;
  const MAX_HISTORY = 100;
  const PUBLISH_TIMEOUT = 8000;
  const READY_TIMEOUT = 8000;

  /* ---------- small helpers ---------- */
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const newId = () => {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch {}
    return 'm-' + Date.now().toString(36) + '-' + rnd() + rnd();
  };
  const ID_RE = /^[A-Za-z0-9_+-]{6,128}$/;
  const ROOM_RE = /^[A-Z0-9]{2,10}-\d{8}$/;

  // per-tab id: tells "me" apart from another tab/device that has the same account name
  const sid = (() => {
    try {
      let v = sessionStorage.getItem('cathay.chatSid');
      if (!v) { v = newId(); sessionStorage.setItem('cathay.chatSid', v); }
      return v;
    } catch { return newId(); }
  })();

  /** Room id for one flight on one day, e.g. CX521-20261201. Same flight + date => same room for everybody. */
  function roomFor(flightNumber, depIso) {
    const num = String(flightNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const day = String(depIso || '').slice(0, 10).replace(/-/g, '');
    const room = num + '-' + day;
    return ROOM_RE.test(room) ? room : '';
  }

  /** Validate anything that arrives from the network / another tab. Returns a clean message or null. */
  function clean(raw, room) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const text = typeof raw.text === 'string' ? raw.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_TEXT) : '';
    if (!text) return null;
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    if (typeof raw.sid !== 'string' || !ID_RE.test(raw.sid)) return null;
    if (typeof raw.room !== 'string' || !ROOM_RE.test(raw.room)) return null;
    if (room && raw.room !== room) return null;
    const ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const str = (v, n, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d);
    return {
      id: raw.id, sid: raw.sid, room: raw.room, ts,
      name: str(raw.name, 40, 'Student'),
      uni: str(raw.uni, 30, ''),
      verified: raw.verified === true,
      text,
    };
  }

  function makeMessage({ room, name, uni, verified, text }) {
    return clean({ id: newId(), sid, room, ts: Date.now(), name, uni, verified: !!verified, text }, room);
  }

  /* ---------- history (this browser only) ---------- */
  const memHist = {};
  const histKey = (room) => 'cathay.chat.' + room;
  function loadHistory(room) {
    try {
      const arr = JSON.parse(localStorage.getItem(histKey(room)) || '[]');
      return (Array.isArray(arr) ? arr : []).map((m) => clean(m, room)).filter(Boolean);
    } catch { return (memHist[room] || []).slice(); }
  }
  function remember(room, msg) {
    const byId = new Map(loadHistory(room).map((m) => [m.id, m]));   // merge: another tab may have written too
    byId.set(msg.id, msg);
    const all = [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_HISTORY);
    memHist[room] = all;
    try { localStorage.setItem(histKey(room), JSON.stringify(all)); } catch {}
  }

  /* ---------- local transport (BroadcastChannel) ---------- */
  function localTransport(room, onMessage, onStatus) {
    let bc = null;
    try {
      bc = new BroadcastChannel('aurelia-chat');
      bc.onmessage = (e) => { const m = clean(e.data, room); if (m) onMessage(m); };
    } catch { bc = null; }
    onStatus({ state: 'local', detail: bc ? '' : 'This browser cannot share messages between tabs.' });
    return {
      send(msg) { if (bc) bc.postMessage(msg); return Promise.resolve(); },
      close() { if (bc) bc.close(); bc = null; },
    };
  }

  /* ---------- live transport (AppSync Events over WebSocket) ---------- */
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function liveTransport(room, onMessage, onStatus) {
    const channel = '/' + NAMESPACE + '/' + room;
    const url = CFG.realtimeUrl || `wss://${CFG.realtimeDomain}/event/realtime`;
    const auth = { host: CFG.httpDomain, 'x-api-key': CFG.apiKey };

    let ws = null, state = 'connecting', attempt = 0, closed = false;
    let subId = '', kaMs = 300000, kaTimer = 0, retryTimer = 0;
    const pending = new Map();    // publish id -> { res, rej, timer }
    let waiters = [];             // callbacks waiting for state === 'ready'

    const setState = (s, detail = '') => {
      state = s;
      onStatus({ state: s, detail });
      if (s === 'ready') { const w = waiters; waiters = []; w.forEach((f) => f(true)); }
    };

    function armKeepAlive() {
      clearTimeout(kaTimer);
      kaTimer = setTimeout(() => { try { ws && ws.close(); } catch {} }, kaMs + 5000);
    }

    function failPending(reason) {
      pending.forEach((p) => { clearTimeout(p.timer); p.rej(new Error(reason)); });
      pending.clear();
    }

    function scheduleRetry() {
      if (closed) return;
      clearTimeout(retryTimer);
      const base = Math.min(30000, 1000 * 2 ** attempt);          // 1s, 2s, 4s ... 30s, with jitter
      attempt++;
      retryTimer = setTimeout(connect, base * (0.5 + Math.random() / 2));
    }

    function connect() {
      if (closed) return;
      clearTimeout(retryTimer);
      setState(attempt ? 'reconnecting' : 'connecting');
      let sock;
      try { sock = new WebSocket(url, ['aws-appsync-event-ws', 'header-' + b64url(auth)]); }
      catch (e) { setState('error', 'Could not open the chat connection.'); scheduleRetry(); return; }
      ws = sock;
      let errorDetail = '';

      sock.onopen = () => { if (ws === sock) sock.send(JSON.stringify({ type: 'connection_init' })); };

      sock.onmessage = (ev) => {
        if (ws !== sock) return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;
        armKeepAlive();                                           // any traffic counts as alive
        switch (m.type) {
          case 'connection_ack':
            if (Number(m.connectionTimeoutMs) > 0) kaMs = Number(m.connectionTimeoutMs);
            armKeepAlive();
            subId = 's-' + rnd() + rnd();
            sock.send(JSON.stringify({ type: 'subscribe', id: subId, channel, authorization: auth }));
            break;
          case 'subscribe_success':
            if (m.id === subId) { attempt = 0; setState('ready'); }
            break;
          case 'data': {
            if (m.id !== subId) break;
            const evs = Array.isArray(m.event) ? m.event : [m.event];
            for (const e of evs) {
              let obj = e;
              if (typeof e === 'string') { try { obj = JSON.parse(e); } catch { continue; } }
              const msg = clean(obj, room);
              if (msg) onMessage(msg);
            }
            break;
          }
          case 'publish_success':
          case 'publish_error': {
            const p = pending.get(m.id);
            if (!p) break;
            pending.delete(m.id); clearTimeout(p.timer);
            const failed = Array.isArray(m.failed) && m.failed.length;
            if (m.type === 'publish_success' && !failed) p.res();
            else p.rej(new Error((m.errors && m.errors[0] && m.errors[0].message) || 'The chat service refused the message.'));
            break;
          }
          case 'ka': break;
          default:
            if (typeof m.type === 'string' && (m.type.endsWith('_error') || m.type === 'error')) {
              errorDetail = (m.errors && m.errors[0] && (m.errors[0].message || m.errors[0].errorType)) || m.type;
              if (m.type === 'subscribe_error' || m.type === 'connection_error' || m.type === 'error') setState('error', errorDetail);
            }
        }
      };

      sock.onerror = () => { /* onclose follows */ };
      sock.onclose = () => {
        if (ws !== sock) return;
        clearTimeout(kaTimer);
        failPending('Connection lost.');
        if (closed) return;
        if (state !== 'error') setState('reconnecting', errorDetail);
        scheduleRetry();
      };
    }

    // phones sleep and tabs get frozen: reconnect as soon as the page is usable again
    const wake = () => {
      if (closed || state === 'ready') return;
      if (document.visibilityState === 'hidden') return;
      attempt = 0; clearTimeout(retryTimer);
      try { ws && ws.close(); } catch {}
      ws = null; connect();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    function whenReady() {
      if (state === 'ready') return Promise.resolve();
      return new Promise((res, rej) => {
        const t = setTimeout(() => { waiters = waiters.filter((f) => f !== cb); rej(new Error('Not connected to the chat service yet.')); }, READY_TIMEOUT);
        const cb = () => { clearTimeout(t); res(); };
        waiters.push(cb);
      });
    }

    connect();
    return {
      send(msg) {
        return whenReady().then(() => new Promise((res, rej) => {
          const id = 'p-' + rnd() + rnd();
          const timer = setTimeout(() => { pending.delete(id); rej(new Error('The chat service did not answer.')); }, PUBLISH_TIMEOUT);
          pending.set(id, { res, rej, timer });
          try {
            ws.send(JSON.stringify({ type: 'publish', id, channel, events: [JSON.stringify(msg)], authorization: auth }));
          } catch (e) { pending.delete(id); clearTimeout(timer); rej(e); }
        }));
      },
      close() {
        closed = true;
        clearTimeout(retryTimer); clearTimeout(kaTimer);
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', wake);
        failPending('Closed.');
        waiters.forEach((f) => f(false)); waiters = [];
        const s = ws; ws = null;
        try { if (s && s.readyState === 1 && subId) s.send(JSON.stringify({ type: 'unsubscribe', id: subId })); } catch {}
        try { s && s.close(); } catch {}
      },
    };
  }

  /**
   * Join a flight room. handlers: { onMessage(msg), onStatus({state, detail}) }
   * Returns { history, send(msg) -> Promise, close() }. send() shows nothing by itself: the caller draws the
   * message straight away (optimistic) and the echo from the server is dropped by id.
   */
  function join(room, handlers) {
    const hist = loadHistory(room);
    const seen = new Set(hist.map((m) => m.id));
    const deliver = (m) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      remember(room, m);
      handlers.onMessage(m);
    };
    const t = (LIVE ? liveTransport : localTransport)(room, deliver, handlers.onStatus);
    return {
      history: hist,
      send(msg) {
        seen.add(msg.id);
        remember(room, msg);
        return t.send(msg);
      },
      close() { t.close(); },
    };
  }

  window.AureliaChat = { live: LIVE, sid, MAX_TEXT, roomFor, makeMessage, join, _clean: clean };
})();
