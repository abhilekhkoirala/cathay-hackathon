/* Cathay Student — app. Accounts and bookings live on the server (accounts.js, live.js) with a localStorage cache. */
(() => {
  'use strict';
  const D = window.AURELIA;
  const { AIRPORTS, CABINS, FARES, generateFlights, distanceKm, basePrice, airport, hash, mulberry32, toISO, toDate } = D;
  let activeId = ''; /* signed-in account id ('' = nobody); set in loadState() */

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  /* Per-user keys are namespaced by account id. They are a local cache: for server accounts every change is
   * also saved to the server (cloudSave), so the same account works on any device. */
  const PER_USER = new Set(['trips', 'prefs', 'verified', 'perks', 'chatName']);
  const SYNCED = ['trips', 'prefs', 'verified', 'perks', 'chatName'];
  const skey = (k) => 'cathay.' + (PER_USER.has(k) ? (activeId || 'guest') + '.' : '') + k;
  const mem = {};
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(skey(k));
        return v === null ? d : JSON.parse(v);
      } catch { return skey(k) in mem ? mem[skey(k)] : d; }
    },
    set(k, v, quiet) {
      mem[skey(k)] = v;
      try { localStorage.setItem(skey(k), JSON.stringify(v)); } catch {}
      if (!quiet && activeId && SYNCED.includes(k)) cloudSave();
    },
  };

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (iso, o = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
    new Date(iso).toLocaleDateString('en-GB', o);
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const dur = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const city = (c) => (airport(c) ? airport(c).city : c);
  const shiftDate = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return toDate(d); };
  const todayStr = () => toDate(new Date());
  const hoursUntil = (iso) => (new Date(iso).getTime() - Date.now()) / 3600000;
  const gateFor = (seed) => ['A', 'B', 'C', 'D'][hash(seed) % 4] + (1 + (hash(seed + 'g') % 38));
  const termFor = (seed) => 1 + (hash(seed + 't') % 2);
  const refCode = () => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
  };

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ticket: '<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',
    bag: '<rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V3h6v3M9 10v6M15 10v6"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/>',
    hotel: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/>',
    car: '<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16M4 16h16v3h-2v-1H6v1H4z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    refund: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/><path d="M12 8v8M9.5 10.5c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.3-2.5 1.5-2.5.6-2.5 1.5 1 1.5 2.5 1.5 2.5-.5 2.5-1.5"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    seat: '<path d="M7 3l2 10h8l2 5M9 13l-1 6M12 18h7"/>',
    lounge: '<path d="M4 12v-2a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2"/><path d="M3 12a2 2 0 0 1 2 2v3h14v-3a2 2 0 0 1 4 0v5H1v-5a2 2 0 0 1 2-2z"/>',
    tv: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8c-2 0-4-1-4-3s3-2 4 3zm0 0c2 0 4-1 4-3s-3-2-4 3z"/>',
    swap: '<path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>',
    ext: '<path d="M7 17L17 7M8 7h9v9"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  };
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.info}</svg>`;

  const tick = (cls = '') => `<span class="tick ${cls}" title="Verified student" role="img" aria-label="Verified student"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  const API = String((window.AURELIA_CONFIG && window.AURELIA_CONFIG.apiBase) || '').replace(/\/$/, '');
  /* .edu rule: domain must contain an "edu" label after the first label (mit.edu, cuhk.edu.hk, ...) */
  const isEduEmail = (e) => {
    e = String(e || '').trim().toLowerCase();
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
    return e.split('@')[1].split('.').slice(1).includes('edu');
  };

  /* ---------- state ---------- */
  let user = null;
  let trips = [];
  let tripsTab = 'upcoming';
  const retrieved = new Set();
  const vs = { step: 'email', email: '', demo: false, demoCode: '', msg: '', busy: false, localCode: null, localExpires: 0, files: {}, form: {}, replace: false };
  let sv = null; /* the server's verification status for this account (student-verify.js view) */
  const search = { type: 'return', from: 'HKG', to: '', depart: shiftDate(todayStr(), 14), ret: shiftDate(todayStr(), 21), cabin: 'Economy', pax: 1, step: 'out', out: null, back: null };
  const SZ = window.AURELIA_SZ;
  const seatSel = { key: '', seat: '' };

  const DEFAULT_PREFS = { seat: 'No preference', meal: 'Standard', notifications: true };
  /* The signed-in account (cached in localStorage) + its data. New accounts start empty: no trips, 0 points. */
  function loadState() {
    const acct = store.get('account', null);
    activeId = acct ? acct.id : '';
    trips = acct ? store.get('trips', null) || [] : [];
    user = acct ? {
      ...acct, points: 0, asiaMiles: 0,
      prefs: { ...DEFAULT_PREFS, ...(store.get('prefs', null) || {}) },
      verified: store.get('verified', null),
    } : null;
    if (user && user.verified && user.verified.until && user.verified.until < todayStr()) user.verified = null; // ended: student features pause at once
    if (user) user.tier = user.verified ? 'Student' : 'Member';
  }

  /* ---------- accounts: server (shared across devices) or, without a server, this browser only ---------- */
  const session = () => store.get('session', '');
  const isLocalAccount = () => session() === 'local';
  async function authCall(method, path, body) {
    try {
      const res = await fetch(API + '/api' + path, {
        method, headers: { 'Content-Type': 'application/json', ...(session() && !isLocalAccount() ? { Authorization: 'Bearer ' + session() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && j.ok !== false, ...j };
    } catch { return { status: 0, ok: false, error: 'Could not reach the server.' }; }
  }
  /* Stores the account + its data locally and switches to it. */
  function useAccount(token, acct, data) {
    store.set('session', token);
    store.set('account', acct);
    activeId = acct.id; refsCache = null; fetchRefs.at = 0;
    Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null, files: {}, form: {}, replace: false });
    sv = null;
    if (data) for (const k of SYNCED) store.set(k, k in data ? data[k] : null, true);
    loadState();
  }
  let cloudTimer = null;
  function cloudSave() {
    if (!activeId || !session() || isLocalAccount()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      const data = {};
      for (const k of SYNCED) data[k] = store.get(k, null);
      authCall('PUT', '/me/data', { data }).then((r) => { if (r.status === 401) signOutLocal('Please sign in again.'); });
    }, 400);
  }
  /* Local accounts (no server): password stored as salted SHA-256 in this browser only. */
  async function sha(text) {
    if (!(window.crypto && crypto.subtle)) return hash(text).toString(16) + hash(text + '#').toString(16); // http:// pages have no SubtleCrypto
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function localSignup(b) {
    const users = store.get('localUsers', {});
    if (users[b.email]) return { ok: false, error: 'An account with this email already exists on this device.' };
    const salt = Math.random().toString(36).slice(2), id = 'l_' + Math.random().toString(36).slice(2, 12);
    const acct = { id, firstName: b.firstName, lastName: b.lastName, email: b.email, dob: b.dob, memberId: `CS ${new Date().getFullYear()} ${String(hash(id) % 10000).padStart(4, '0')}`, refCode: SZ.referralCode(b.firstName, b.email), invitedBy: '', memberSince: String(new Date().getFullYear()) };
    users[b.email] = { acct, salt, hash: await sha(salt + b.password) };
    store.set('localUsers', users);
    return { ok: true, token: 'local', user: acct, data: {} };
  }
  async function localLogin(email, password) {
    const u = store.get('localUsers', {})[email];
    if (!u || u.hash !== await sha(u.salt + password)) return { ok: false, error: "Those details don't match an account on this device." };
    return { ok: true, token: 'local', user: u.acct, data: null };
  }
  /* Sign-in and sign-up forms: the server when it's there, otherwise this browser only. */
  async function accountSubmit(id, f) {
    const signup = id === 'signupForm', err = $(signup ? '#signupErr' : '#signinErr'), btn = $(`#${id} button[type=submit]`);
    err.hidden = true; btn.disabled = true;
    const email = String(f.get('email') || '').trim().toLowerCase(), password = String(f.get('password') || '');
    let r;
    if (signup) {
      const b = { firstName: String(f.get('firstName')).trim(), lastName: String(f.get('lastName')).trim(), email, password, dob: f.get('dob'), invite: f.get('invite') || '' };
      r = LIVE.on ? await authCall('POST', '/auth/signup', b) : await localSignup(b);
    } else {
      r = LIVE.on ? await authCall('POST', '/auth/login', { email, password }) : await localLogin(email, password);
    }
    btn.disabled = false;
    if (!r.ok) { err.textContent = r.error || 'Something went wrong. Try again.'; err.hidden = false; return; }
    useAccount(r.token, r.user, r.data);
    if (signup) store.set('invite', '');
    toast(signup ? `Welcome, ${r.user.firstName}! Your member number is ${r.user.memberId}.` : `Signed in as ${r.user.firstName}`);
    location.hash = '#/home'; render();
    fetchVerification(true);
    if (signup && user.invitedBy) setTimeout(() => inviteInfo('invited'), 600); // invited friends first learn how the invite bonus works
    else if (!user.verified && !(user.student && user.student.status && user.student.status !== 'not_submitted')) setTimeout(studentPromo, 600); // guide new and returning members towards student verification
  }
  function signOutLocal(msg) {
    if (session() && !isLocalAccount()) authCall('POST', '/auth/logout', {});
    store.set('session', ''); store.set('account', null);
    loadState(); refsCache = null;
    if (msg) toast(msg);
    location.hash = '#/home'; render();
  }
  const saveTrips = () => store.set('trips', trips);
  const findTrip = (ref) => trips.find((t) => t.ref === ref);
  const lastDep = (t) => t.segments[t.segments.length - 1].dep;
  const isUpcoming = (t) => t.status === 'Confirmed' && new Date(lastDep(t)) > new Date();
  const upcoming = () => trips.filter(isUpcoming).sort((a, b) => a.segments[0].dep.localeCompare(b.segments[0].dep));
  const past = () => trips.filter((t) => !isUpcoming(t)).sort((a, b) => b.segments[0].dep.localeCompare(a.segments[0].dep));
  const canCheckIn = (t) => isUpcoming(t) && hoursUntil(t.segments[0].dep) <= 48;

  /* ---------- UI bits ---------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }
  const airportOptions = (sel, placeholder) =>
    (placeholder ? `<option value="">${placeholder}</option>` : '') +
    AIRPORTS.map((a) => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.city} (${a.code})</option>`).join('');
  const badge = (status) => {
    const cls = { Confirmed: 'ok', Completed: 'muted', Cancelled: 'bad' }[status] || 'muted';
    return `<span class="badge ${cls}">${esc(status)}</span>`;
  };
  const backLink = (to, label = 'Back') => `<a class="back" href="${to}">${icon('arrow', 'flip')} ${label}</a>`;
  const countdown = (iso) => {
    const h = hoursUntil(iso);
    if (h < 0) return 'Departed';
    if (h < 24) return `Departs in ${Math.max(1, Math.round(h))}h`;
    return `Departs in ${Math.round(h / 24)} days`;
  };
  const tripLabel = (t) => {
    const s = t.segments;
    return t.segments.length > 1 ? `${city(s[0].from)} ⇄ ${city(s[0].to)}` : `${city(s[0].from)} → ${city(s[0].to)}`;
  };

  function segmentCard(s, t, i) {
    const seed = t.ref + i;
    return `
    <div class="seg">
      <div class="seg-head"><span>${esc(s.number)} · ${esc(s.aircraft)}</span><span>${fmtDate(s.dep)}</span></div>
      <div class="seg-body">
        <div><div class="time">${fmtTime(s.dep)}</div><div class="code">${s.from}</div><div class="muted sm">${city(s.from)}</div></div>
        <div class="seg-mid"><div class="muted sm">${dur(s.durMin)}</div><div class="line">${icon('plane')}</div><div class="muted sm">${s.stops ? s.stops + ' stop' : 'Nonstop'}</div></div>
        <div class="right"><div class="time">${fmtTime(s.arr)}</div><div class="code">${s.to}</div><div class="muted sm">${city(s.to)}</div></div>
      </div>
      <div class="seg-foot">
        <div><span class="muted sm">Terminal</span><b>${termFor(seed)}</b></div>
        <div><span class="muted sm">Gate</span><b>${gateFor(seed)}</b></div>
        <div><span class="muted sm">Seat</span><b>${t.checkedIn || s.seat ? esc(s.seat) : '—'}</b></div>
        <div><span class="muted sm">Fare</span><b>${esc(fareName(t.cabin, t.fare))}</b></div>
      </div>
    </div>`;
  }

  function tripCard(t) {
    const s0 = t.segments[0];
    return `
    <a class="card trip-card" href="#/trip/${t.ref}">
      <div class="row between"><b>${tripLabel(t)}</b><span class="row gap-sm">${user && isUpcoming(t) && studentTrip(t) ? `<span class="sz-pill">${icon('cap')} Student</span>` : ''}${badge(t.status)}</span></div>
      <div class="muted sm">${fmtDate(s0.dep)} · ${fmtTime(s0.dep)}${t.segments.length > 1 ? ' · returns ' + fmtDate(t.segments[1].dep, { day: 'numeric', month: 'short' }) : ''}</div>
      <div class="row between small-row"><span class="muted sm">Ref <b class="mono">${t.ref}</b> · ${esc(fareName(t.cabin, t.fare))}</span>
      ${isUpcoming(t) ? `<span class="pill">${countdown(s0.dep)}</span>` : ''}</div>
    </a>`;
  }

  /* ---------- student seating ---------- */
  const coversDate = (iso) => Boolean(user && user.verified && (!user.verified.until || String(iso).slice(0, 10) <= user.verified.until));
  const studentOk = (iso) => Boolean(coversDate(iso) && SZ.isAdult(user.dob, iso));
  const studentEligible = (t) => t.cabin === 'Economy' && studentOk(t.segments[0].dep);
  /* Fares: Economy Light / Essential / Flex; premium cabins have one fare with seat selection included. */
  const withFare = (f, fare) => (fare && FARES[fare] ? { ...f, fare, price: Math.round(f.price * FARES[fare].mult) } : { ...f, fare: null });
  const fareName = (cabin, fare) => (cabin === 'Economy' && fare ? 'Economy ' + fare : cabin);
  const seatRule = (cabin, fare) => (cabin === 'Economy' && fare && FARES[fare] ? FARES[fare].seat : 'free');
  /* Only students who answered "yes" are seated next to students; "no" books like everyone else. */
  const studentTrip = (t) => studentEligible(t) && t.studentSeat === true;
  const verifiedLabel = () => `<div class="sz-verified">${tick()} Verified student</div>`;
  const SEAT_QUESTION = 'Do you want to be seated next to students?';

  /* Short floating tick confirmation; the page stays where it is. */
  function flashTick(text) {
    document.querySelector('.flash')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="flash" role="status">${tick()}<span>${esc(text)}</span></div>`);
    setTimeout(() => document.querySelector('.flash')?.remove(), 1700);
  }

  function showModal(title, text) {
    document.querySelector('.modal-bg')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" data-action="modal-close">
        <div class="modal" data-action="noop" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-ico">${icon('cap')}</div>
          <h2 id="modalTitle">${esc(title)}</h2>
          <p class="muted">${esc(text)}</p>
          <button class="btn btn-primary block" data-action="modal-close">OK</button>
        </div>
      </div>`);
    $('.modal .btn').focus();
  }
  const seatYesModal = () => showModal('Great choice!', "We will do our best to seat you next to other students on this flight. Your seat will be assigned automatically at check-in.");

  /* ---------- live demo: shared flights and seats (server.js → live.js, /api/live) ----------
   * When the server is reachable, every phone sees the same real flights (OAG) and the same seats,
   * updated within a second over Server-Sent Events. Without it, everything stays in localStorage. */
  const LIVE = { on: false, flights: {}, state: {}, seen: {}, es: {}, sent: {}, timer: null };
  const liveId = (s) => s.number.replace(/\s+/g, '') + '-' + s.dep.slice(0, 10);
  const segOut = (s) => ({ number: s.number, from: s.from, to: s.to, dep: s.dep, arr: s.arr, aircraft: s.aircraft, durMin: s.durMin, stops: s.stops });
  async function liveCall(path, body) {
    try {
      const headers = session() && !isLocalAccount() ? { Authorization: 'Bearer ' + session() } : {};
      const res = await fetch(API + '/api/live' + path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (j.state) liveApply(j.state);
      return { ok: res.ok, status: res.status, ...j };
    } catch { return { ok: false, status: 0, error: 'Could not reach the live server.' }; }
  }
  const LIVE_VIEWS = new Set(['results', 'trip', 'seats', 'planner', 'boarding']);
  function liveRerender() {
    if (!LIVE_VIEWS.has(route()[0]) || document.querySelector('.modal-bg')) return;
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  function liveApply(st) {
    const old = LIVE.state[st.id];
    if (old && old.v >= st.v) return;
    LIVE.seen[st.id] = old ? old.plan : st.plan;
    LIVE.state[st.id] = st;
    liveRerender();
    if (old && LIVE_VIEWS.has(route()[0]) && route()[0] !== 'results' && JSON.stringify(old.plan) + old.sales + JSON.stringify(old.pax) !== JSON.stringify(st.plan) + st.sales + JSON.stringify(st.pax)) flashTick('Seats updated live');
  }
  function liveWatch(id) {
    if (LIVE.es[id] || !window.EventSource) return;
    const es = LIVE.es[id] = new EventSource(API + '/api/live/flights/' + id + '/events');
    es.onmessage = (e) => { try { liveApply(JSON.parse(e.data)); } catch {} };
  }
  /* Tells the server about this user's bookings (idempotent; only changes are sent). */
  /* What the server needs to know about my booking on one flight. */
  const paxBody = (t, s, seat) => {
    const stu = studentTrip(t);
    return {
      seg: segOut(s), cabin: t.cabin,
      student: stu ? { uni: SZ.universityFromEmail(user.verified.email), share: Boolean(t.showUni) } : null,
      seat: stu ? null : seat || null, locked: stu && seat ? seat : null,
      active: t.status === 'Confirmed',
    };
  };
  const liveAccount = () => LIVE.on && user && session() && !isLocalAccount();
  function liveSync() {
    if (!liveAccount()) return;
    clearTimeout(LIVE.timer);
    LIVE.timer = setTimeout(() => {
      // One record per flight: if several bookings are on the same flight, the active (student) one wins.
      const rank = (t) => (t.status === 'Confirmed' ? 2 : 0) + (studentTrip(t) ? 1 : 0);
      const best = {};
      trips.forEach((t) => t.segments.forEach((s, i) => {
        const id = liveId(s);
        if (!best[id] || rank(t) > rank(best[id].t)) best[id] = { t, s };
      }));
      Object.values(best).forEach(({ t, s }) => {
        if (new Date(s.dep) < new Date()) return;
        const id = liveId(s), body = paxBody(t, s, studentTrip(t) && !t.checkedIn ? s.pick || null : s.seat);
        const k = JSON.stringify(body);
        if (LIVE.sent[id] === k) return;
        LIVE.sent[id] = k;
        liveCall('/flights/' + id + '/pax', body).then((r) => { if (r.ok) liveWatch(id); else delete LIVE.sent[id]; if (r.studentDenied) toast(r.studentDenied); });
      });
    }, 120);
  }
  /* The planner can open any flight, even one this user isn't on. */
  function liveEnsure(s) {
    const id = liveId(s);
    if (!LIVE.on || LIVE.state[id] || LIVE.sent['ensure' + id]) return;
    LIVE.sent['ensure' + id] = '1';
    liveCall('/flights/' + id + '/ensure', { seg: segOut(s) }).then((r) => { if (r.ok) { liveWatch(id); liveRerender(); } });
  }
  /* Nearby dates (±3 days) whose flights already have the most students (bands only: 3+, 5+, 10+). Students only. */
  function studentDates(from, to, date) {
    if (!LIVE.on || !isStudent()) return null;
    const k = [from, to, date].join('|');
    LIVE.sdates = LIVE.sdates || {};
    if (!(k in LIVE.sdates)) {
      LIVE.sdates[k] = null;
      liveCall(`/student-dates?from=${from}&to=${to}&date=${date}`).then((r) => { LIVE.sdates[k] = r.ok ? r.dates : []; liveRerender(); });
    }
    return LIVE.sdates[k];
  }
  function studentDatesCard(leg) {
    const list = studentDates(leg.from, leg.to, leg.date);
    if (!list || !list.length) return '';
    return `<div class="card sd-card">
      <div class="sd-head">${icon('cap')}<div><b>Fly with other students</b><span class="muted sm">Dates near yours with the most students already booked. Counts only: never who they are.</span></div></div>
      <div class="sd-chips">${list.map((d) => `<button class="sd-chip${d.date === leg.date ? ' on' : ''}" data-action="set-date" data-date="${d.date}">
        <span>${fmtDate(d.date + 'T12:00', { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>${esc(d.number)} · ${fmtTime(d.dep)}</b><small>${icon('cap')} ${esc(d.students)} students</small></button>`).join('')}</div>
    </div>`;
  }
  /* Real flights for a search: OAG via the server, cached per search; simulated until it answers. */
  function flightsFor(from, to, date, cabin) {
    const k = [from, to, date, cabin].join('|'), c = LIVE.flights[k];
    if (c && c.flights) return c.flights;
    if (LIVE.on && !c) {
      LIVE.flights[k] = { loading: true };
      liveCall(`/flights?from=${from}&to=${to}&date=${date}&cabin=${encodeURIComponent(cabin)}`).then((r) => {
        LIVE.flights[k] = r.ok && r.flights && r.flights.length ? r : { flights: generateFlights(from, to, date, cabin), source: 'sim' };
        liveRerender();
      });
    }
    return LIVE.flights[k] && LIVE.flights[k].loading ? null : generateFlights(from, to, date, cabin);
  }

  /* Re-runs the student seat planner for one flight with every seat sold so far, and remembers the
   * result so students only move when a seat planned for them is bought. */
  /* Privacy: other passengers appear only as "Student", with a university only if they chose to share it. */
  const uniTagOf = (u) => (u ? 'u' + hash(String(u).toLowerCase()).toString(36) : '');
  const myPid = (flightId) => 'p' + hash(user.id + '|' + flightId).toString(36); // my pseudonym on a shared flight (same as the server's)
  function decorate(p) {
    p.students.forEach((x) => {
      if (x.shownUni === undefined) x.shownUni = x.me ? x.uni : x.share ? x.uni : '';
      x.tag = x.uniTag || uniTagOf(x.uni);
    });
    p.groups.forEach((g) => { g.sameUni = g.members.length > 1 && g.members.every((m) => m.tag === g.members[0].tag); });
    return p;
  }
  const uniLabel = (x) => (x && x.shownUni ? x.shownUni : 'university not shared');
  function nearText(nb) {
    const shown = nb.filter((x) => x.shownUni);
    return `${nb.length === 1 ? 'a student' : nb.length + ' students'}${shown.length ? ' · ' + shown.map((x) => 'one from ' + esc(x.shownUni)).join(', ') : ''}`;
  }

  /* Re-runs the student seat planner for one flight (Economy) with every seat sold so far, and remembers the
   * result so students only move when a seat planned for them is bought. */
  function seatPlan(t, i) {
    const s = t.segments[i], key = SZ.flightKey(s);
    const st = LIVE.on && LIVE.state[liveId(s)];
    if (st) { // shared state: other phones' passengers (pseudonymous) and the server's plan
      const mine = studentTrip(t), pid = user ? myPid(st.id) : '';
      let real = st.pax.filter((x) => x.student).map((x) => ({ id: x.id, me: x.id === pid, name: 'Student', uni: x.uni || x.uniTag, uniTag: x.uniTag, share: x.share, shownUni: x.share ? x.uni : '', year: '', field: '', locked: x.locked }));
      if (mine) {
        const myUni = SZ.universityFromEmail(user.verified.email);
        real = real.map((x) => (x.me ? { ...x, uni: myUni, shownUni: myUni } : x));
        if (!real.some((x) => x.me)) real.push({ id: pid, me: true, name: user.firstName, uni: myUni, uniTag: uniTagOf(myUni), shownUni: myUni, year: '', field: '', locked: t.checkedIn ? s.seat : s.pick || null });
      } else real = real.filter((x) => !x.me);
      const sold = st.sales.concat(st.pax.filter((x) => !x.student && x.seat && x.id !== pid && (x.cabin || 'Economy') === 'Economy').map((x) => x.seat));
      if (!mine && s.seat && t.cabin === 'Economy') sold.push(s.seat);
      const p = SZ.plan(s, { real, sold, fixed: st.plan, prev: LIVE.seen[st.id] || st.plan });
      if (p.seatOf[pid]) p.seatOf.me = p.seatOf[pid];
      p.live = st;
      return decorate(p);
    }
    if (LIVE.on) liveEnsure(s);
    const me = studentTrip(t)
      ? { id: 'me', me: true, name: user.firstName, uni: SZ.universityFromEmail(user.verified.email), year: '', field: '', locked: t.checkedIn ? s.seat : s.pick || null }
      : null;
    const sold = [...(store.get('sales', {})[key] || [])];
    if (!me && s.seat && t.cabin === 'Economy') sold.push(s.seat);
    const plans = store.get('seatplans', {});
    const p = SZ.plan(s, { me, sold, prev: plans[key] });
    plans[key] = p.seatOf;
    store.set('seatplans', plans);
    return decorate(p);
  }

  /* Seat map state for my cabin: layout, taken seats (other passengers) and, in Economy, the student plan. */
  function seatState(t, i) {
    const s = t.segments[i];
    if (t.cabin === 'Economy') {
      const p = seatPlan(t, i), taken = new Set([...p.paid].filter((id) => id !== s.seat));
      Object.entries(p.at).forEach(([id, x]) => { if (!x.me && x.locked) taken.add(id); }); // seats only planned for students stay on sale
      return { c: p.cabin, p, taken };
    }
    const c = SZ.cabin(s, t.cabin), taken = new Set(SZ.paidSeats(s, t.cabin));
    const st = LIVE.on && LIVE.state[liveId(s)];
    if (st) st.pax.forEach((x) => { if (x.seat && x.cabin === t.cabin && x.id !== myPid(st.id)) taken.add(x.seat); });
    else if (LIVE.on) liveEnsure(s);
    taken.delete(s.seat);
    return { c, p: null, taken };
  }
  /* Economy Light: seat choice is a paid extra unless unlocked for this flight (student points or Asia Miles). */
  const seatUnlocked = (t, i) => (perks().seatBuys || []).some((b) => b.ref === t.ref && b.i === i);
  const seatLocked = (t, i) => seatRule(t.cabin, t.segments[i].fare || t.fare) === 'paid' && !seatUnlocked(t, i);

  /* Shown in the booking form and on the trip page when the user isn't a verified adult student. */
  function studentGate(iso) {
    if (!user) return '';
    if (!user.verified) {
      const st = vStatus();
      const msg = { pending_review: ["Your student ID is being reviewed", 'Student seating unlocks as soon as it is approved.'], rejected: ['We need more information', 'Check your student verification to unlock student seating.'], expired: ['Student verification expired', 'Re-verify to use student seating again.'], awaiting_document: ['Almost there: upload your student ID', 'Finish verifying and we\'ll seat you next to another student.'] }[st] || ['Fly next to other students', "Verify your student status and we'll seat you next to another student."];
      return `<a class="banner" href="#/verify" data-action="go-verify">${icon('cap')}<span><b>${msg[0]}</b><br><span class="muted sm">${msg[1]}</span></span>${icon('arrow')}</a>`;
    }
    if (!coversDate(iso)) return `<a class="banner" href="#/verify" data-action="go-verify">${icon('alert')}<span><b>Your student verification ends on ${esc(fmtDate(user.verified.until + 'T12:00', { day: 'numeric', month: 'short', year: 'numeric' }))}</b><br><span class="muted sm">That's before this flight. Re-verify with a document valid on the day you fly to use student features.</span></span>${icon('arrow')}</a>`;
    if (!SZ.isAdult(user.dob, iso)) return `<div class="card empty sm">Student seating is open to verified students aged 18+.</div>`;
    return '';
  }

  function studentCard(t) {
    if (!user || t.cabin !== 'Economy' || !isUpcoming(t)) return '';
    if (!studentEligible(t)) return studentGate(t.segments[0].dep); // the seating planner is a student feature
    const planner = plannerAllowed(t, 0) ? `<a class="btn btn-ghost block sm-btn" href="#/planner/${t.ref}/0">See student seating on this flight</a>` : '';
    const seated = studentTrip(t) && t.checkedIn ? t.segments.map((s, i) => {
      const p = seatPlan(t, i), nb = p.neighboursOf(p.students.find((x) => x.me));
      return nb.length ? `<p class="sm" style="margin:0">${esc(s.number)} · seat ${esc(s.seat)}, next to ${nearText(nb)}</p>` : '';
    }).join('') : '';
    return `
    <div class="card sz-card">
      ${verifiedLabel()}
      ${t.checkedIn ? seated : t.studentSeat === undefined ? seatPoll(undefined, t.ref) : seatChoice(t.studentSeat, t.ref)}
      ${adapterHint(t)}
      ${tripRewardsCard(t)}
      ${planner}
    </div>`;
  }

  /* Trip extras paid with student points, like travel extras in Manage booking. */
  function tripRewardsCard(t) {
    const p = perks(), left = spLeft(p), added = tripRewards(t);
    if (p.graduated && !added.length) return '';
    return `
    <div class="trip-rewards">
      <div class="row between"><b>Pay with student points</b><span class="rw-pts">${left.toLocaleString()} pts available</span></div>
      ${REWARDS.map((rw) => {
        const done = added.some((r) => r.id === rw.id), late = rw.id === 'seat' && t.checkedIn, off = left < rw.pts || late || p.graduated;
        return `<div class="perk-row reward"><div class="rw-info">${icon(rw.icon)}<div><b>${rw.name}</b><div class="muted sm">${rw.note}</div></div></div>
          ${done ? '<span class="badge ok">Added</span>' : `<button class="btn ${off ? 'btn-ghost' : 'btn-primary'} sm-btn" data-action="redeem" data-ref="${t.ref}" data-id="${rw.id}" ${off ? 'disabled' : ''}>${rw.pts.toLocaleString()} pts</button>`}</div>`;
      }).join('')}
      <a class="sm" href="#/rewards">How student points work</a>
    </div>`;
  }

  /* Separate box under "Verified student" once the question is answered: green for yes, red for no. */
  function seatChoice(yes, ref) {
    const change = ref ? `data-action="seat-change" data-ref="${ref}"` : 'data-action="seat-change-form"';
    const t = ref && findTrip(ref);
    const share = !yes ? '' : `<label class="check sm share-row"><input type="checkbox" ${ref ? `class="share-uni" data-ref="${ref}"` : 'name="szShowUni"'} ${t && t.showUni ? 'checked' : ''}> Show my university to students seated near me <span class="muted">(never your name)</span></label>`;
    return `<div class="sz-choice ${yes ? 'yes' : 'no'}">
      <span>${yes ? 'Student seating selected · your seat will be assigned at check-in' : 'Standard seating selected'}</span>
      <button type="button" class="link-btn" ${change}>Change</button></div>${share}${ref ? '' : `<input type="hidden" name="szSeat" value="${yes ? 'yes' : 'no'}">`}`;
  }

  /* Yes / No question. With a ref it saves on the trip; without (booking form) it's a radio input. */
  function seatPoll(answer, ref) {
    const opt = (v, label) => ref
      ? `<button type="button" class="poll-opt${answer === (v === 'yes') ? ' on' : ''}" data-action="seat-answer" data-ref="${ref}" data-v="${v}">${label}</button>`
      : `<label class="poll-opt"><input type="radio" name="szSeat" value="${v}"><span>${label}</span></label>`;
    return `<div class="poll"><p class="poll-q">${SEAT_QUESTION}</p><div class="poll-opts">${opt('yes', 'Yes')}${opt('no', 'No')}</div></div>`;
  }

  /* ---------- student perks ---------- */
  /* Free adapter (once per study programme), invite friends, graduation gift. All tied to the
   * verified student membership, no promo codes. */
  /* spRate: student points per Asia Mile a normal member would earn. spConvert: share converted to
   * Asia Miles at graduation (rest expires). With ~85% of students converting, Cathay pays
   * 1.5 × 0.70 × 0.85 ≈ 0.89 of normal miles while students get 1.05× (break-even up to 95% converting). */
  const PERKS = { referralCap: 10, gradMiles: 3000, boostMonths: 12, spRate: 1.5, spConvert: 0.7, welcome: 1500, seatSp: 1000, seatMiles: 2500, inviteAlpha: 0.2, inviteStudentShare: 0.25 };
  /* Invites: when the invited friend makes their first booking (cancelled bookings don't count), BOTH sides get a bonus.
   * A non-student side gets inviteAlpha (20%) of the Asia Miles a normal member earns on that booking, as Asia Miles.
   * A student side gets inviteStudentShare (1/4) of the student points that booking earns (1.5 per mile), as student points
   * (0.375 points per mile: students come out ahead). Up to referralCap friends. */
  const EARN_RATE = { Economy: 0.5, 'Premium Economy': 0.75, Business: 1.25, First: 1.5 };
  /* Asia Miles a normal member would earn on a flight (share of the distance in miles, by cabin). */
  const flightMiles = (seg, cabin) => Math.round((distanceKm(seg.from, seg.to) * 0.6214 * (EARN_RATE[cabin] || 0.5)) / 10) * 10;
  const spConverted = (sp) => Math.floor((sp || 0) * PERKS.spConvert);
  /* Student rewards, paid in student points during studies. Each price is above break-even:
   * a point costs Cathay at most 0.7 × 0.85 × US$0.006 ≈ US$0.0036 if converted at graduation. */
  const REWARDS = [
    { id: 'msg', icon: 'chat', name: 'Wi-Fi messaging pass', pts: 1000, note: 'WhatsApp, iMessage, WeChat… for the whole flight.' },
    { id: 'wifi', icon: 'wifi', name: 'Full-flight Wi-Fi', pts: 5000, note: 'Browse and stream for the whole flight.' },
    { id: 'seat', icon: 'seat', name: 'Preferred seat', pts: 1000, note: 'Front or extra-legroom seat, if still empty at check-in.' },
    { id: 'lounge', icon: 'lounge', name: 'Lounge pass', pts: 6000, note: 'One lounge visit before your flight.' },
  ]; // Economy trips only: premium cabins already include them.
  const spSpent = (p) => (p.redeemed || []).reduce((n, r) => n + r.pts, 0) + (p.seatBuys || []).filter((b) => b.with === 'sp').reduce((n, b) => n + b.amount, 0);
  const milesSpent = (p) => (p.seatBuys || []).filter((b) => b.with === 'miles').reduce((n, b) => n + b.amount, 0);
  const spLeft = (p) => (p.graduated ? 0 : (p.welcome || 0) + (p.sp || 0) + inviteSp() - spSpent(p));
  /* Pay for a reward on a trip with student points; returns an error message or ''. */
  function redeem(t, rw) {
    const p = perks();
    if (!t || t.cabin !== 'Economy') return 'Student rewards are for Economy trips.';
    if ((p.redeemed || []).some((r) => r.id === rw.id && r.ref === t.ref)) return `${rw.name} is already added to this trip.`;
    if (spLeft(p) < rw.pts) return 'Not enough student points.';
    p.redeemed = [...(p.redeemed || []), { id: rw.id, ref: t.ref, pts: rw.pts, at: toISO(new Date()) }];
    savePerks(p);
    return '';
  }
  const tripRewards = (t) => (user && user.verified ? (perks().redeemed || []).filter((r) => r.ref === t.ref) : []);
  const rewardName = (id) => REWARDS.find((r) => r.id === id).name;
  const perks = () => store.get('perks', null) || {};
  const savePerks = (p) => store.set('perks', p);
  const plugNeeded = (s) => Boolean(SZ.plugFor(s.to)) && SZ.plugFor(s.to) !== SZ.plugFor(s.from);
  const studyCountry = () => SZ.studyCountry(user.verified.email);
  const countryName = (c) => c.replace(/ SAR$/, '');
  /* The free adapter is a welcome gift: once per study programme (per verified university email),
   * on the first trip to the university's country where the plugs differ from home. */
  const adapterClaimed = (p = perks()) => Boolean(p.adapter && p.adapter.email === user.verified.email);
  function adapterTrip(p = perks()) {
    if (adapterClaimed(p)) return findTrip(p.adapter.ref) || null;
    return upcoming().find((t) => { const s = t.segments[0]; return (airport(s.to) || {}).country === studyCountry() && plugNeeded(s); }) || null;
  }
  function gradBoostUntil(p) {
    if (!p.graduated) return null;
    const until = new Date(p.graduated);
    until.setMonth(until.getMonth() + PERKS.boostMonths);
    return until > new Date() ? until : null;
  }
  /* Friends who signed up with my invite link (from the server; first-name initial only). */
  let refsCache = null;
  function fetchRefs() {
    if (!user || !session() || isLocalAccount() || Date.now() - (fetchRefs.at || 0) < 3000) return;
    fetchRefs.at = Date.now();
    authCall('GET', '/me/referrals').then((r) => {
      if (!r.ok) return;
      const next = { referrals: r.referrals || [], invited: r.invited || null };
      if (JSON.stringify(next) === JSON.stringify(refsCache)) return;
      refsCache = next; rerender();
    });
  }
  /* Miles a normal member earns on a whole booking. */
  const bookingMiles = (b) => b.segments.reduce((n, s) => n + flightMiles(s, b.cabin), 0);
  /* My side of an invite bonus for one booking: student points if I'm a verified student, Asia Miles otherwise. */
  const inviteBonus = (b) => (isStudent()
    ? { amount: Math.round(bookingMiles(b) * PERKS.spRate * PERKS.inviteStudentShare), unit: 'pts' }
    : { amount: Math.round(bookingMiles(b) * PERKS.inviteAlpha), unit: 'miles' });
  function inviteCredits() {
    if (!refsCache) return [];
    const out = [];
    refsCache.referrals.slice(0, PERKS.referralCap).forEach((r) => {
      if (r.booking) out.push({ ...inviteBonus(r.booking), title: `Friend ${r.name} booked their first flight`, date: r.booking.bought, note: 'Invite bonus' });
    });
    const inv = refsCache.invited;
    if (inv && inv.booking) out.push({ ...inviteBonus(inv.booking), title: 'Your first flight with an invite', date: inv.booking.bought, note: 'Invite bonus' });
    return out;
  }
  const inviteSp = () => inviteCredits().filter((c) => c.unit === 'pts').reduce((n, c) => n + c.amount, 0);
  /* Miles from perks: invite bonuses (non-student side) and the graduation gift. */
  function perkMiles(p = perks()) {
    return {
      credited: inviteCredits().filter((c) => c.unit === 'miles').reduce((n, c) => n + c.amount, 0) + (p.graduated ? PERKS.gradMiles + (p.gradConverted || 0) : 0),
      pending: 0,
    };
  }
  const asiaMiles = () => (user.asiaMiles || 0) + perkMiles().credited - milesSpent(perks());
  /* Everything that changed a balance, newest first (real events only). */
  function activity() {
    if (!user) return [];
    const p = perks(), out = [], day = (iso) => String(iso || '').slice(0, 10);
    trips.forEach((t) => { if (t.studentPoints) out.push({ title: `Flight · ${t.segments[0].from} to ${t.segments[t.segments.length - 1].to}`, date: day(t.checkedInAt || t.segments[0].dep), note: 'Student points at check-in', pts: t.studentPoints }); });
    if (p.welcome) out.push({ title: 'Student welcome bonus', date: day(p.welcomeAt), note: 'Verified student', pts: p.welcome });
    (p.redeemed || []).forEach((r) => out.push({ title: rewardName(r.id), date: day(r.at), note: 'Trip ' + r.ref, pts: -r.pts }));
    (p.seatBuys || []).forEach((b) => out.push({ title: 'Seat choice', date: day(b.at), note: 'Trip ' + b.ref, pts: -b.amount, unit: b.with === 'miles' ? 'miles' : 'pts' }));
    inviteCredits().forEach((c) => out.push({ title: c.title, date: day(c.date), note: c.note, pts: c.amount, unit: c.unit }));
    if (p.graduated) out.push({ title: 'Graduation gift', date: day(p.graduated), note: 'Bonus + converted points', pts: PERKS.gradMiles + (p.gradConverted || 0), unit: 'miles' });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  const earnedThisMonth = () => {
    const m = toISO(new Date()).slice(0, 7);
    return activity().filter((a) => a.pts > 0 && a.unit !== 'miles' && a.date.startsWith(m)).reduce((n, a) => n + a.pts, 0);
  };
  function breakdown() {
    const f = trips.reduce((n, t) => n + (t.studentPoints || 0), 0), b = perks().welcome || 0, tot = f + b;
    if (!tot) return { flights: 0, campus: 0, partners: 0 };
    const fl = Math.round((f * 100) / tot);
    return { flights: fl, campus: 100 - fl, partners: 0 };
  }
  const currentTier = () => (user.verified && gradBoostUntil(perks()) ? SZ.tierUp(user.tier) : user.tier);
  const refLink = () => `${location.origin}${location.pathname}#/r/${user.refCode}`;
  /* Re-render without jumping to the top of the page. */
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };

  function adapterHint(t) {
    if (!user || !user.verified) return '';
    const at = adapterTrip(), s = t.segments[0];
    if (!at || at.ref !== t.ref) return '';
    return adapterClaimed()
      ? `<div class="sz-choice yes"><span>${icon('plug')} Type ${esc(SZ.plugFor(s.to))} adapter claimed · collect it from the crew on board</span></div>`
      : `<div class="sz-choice yes"><span>${icon('plug')} Free Type ${esc(SZ.plugFor(s.to))} adapter for ${esc(city(s.to))}</span><button type="button" class="link-btn" data-action="claim-adapter" data-ref="${t.ref}">Claim</button></div>`;
  }

  /* ---------- views ---------- */
  const views = {};

  /* ---------- student home (Figma: "Cathay Student — Home" + "No Flight Booked" + mobile) ---------- */
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
  const daysUntil = (iso) => daysBetween(new Date(), iso);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dayMon = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const shortDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const longDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const pts = (n) => Number(n).toLocaleString('en-US');
  const kfmt = (n) => (Math.floor(n / 100) / 10).toFixed(1) + 'k';
  const link = (href, label, cls = 'link') => `<a class="${cls}" href="${href}">${label}${icon('ext')}</a>`;

  function donut(bd, total) {
    const R = 44, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = [['flights', '#c9e265'], ['campus', '#3f9a72'], ['partners', '#f1a25a']].map(([k, col]) => {
      const len = (C * bd[k]) / 100, vis = Math.max(0, len - 2.5);
      const el = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="24" stroke-dasharray="${vis.toFixed(2)} ${(C - vis).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += len;
      return el;
    }).join('');
    return `<div class="donut" role="img" aria-label="Points breakdown: ${bd.flights}% flights, ${bd.campus}% campus, ${bd.partners}% partners"><svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)">${arcs}</g></svg><div class="donut-c"><b>${kfmt(total)}</b><small>TOTAL</small></div></div>`;
  }

  function pointsCard() {
    const bd = breakdown(), earned = earnedThisMonth();
    const items = [['Flights', 'flights', 'lime'], ['Bonuses', 'campus', 'leaf'], ['Partners', 'partners', 'amber']];
    return `<section class="points">
      <div class="pts-main">
        <span class="lab">Your student points</span>
        <div class="pts-num">${pts(spLeft(perks()))}</div>
        <div class="pts-sub">points available</div>
        <span class="earned">${icon('up')} ${pts(earned)} earned this month</span>
        <p class="pts-note">${pts(earned)} earned this month</p>
      </div>
      <div class="bd-wrap">
        <span class="lab d-only">Points breakdown</span>
        <div class="bd">${donut(bd, spLeft(perks()))}
          <ul class="legend d-only">${items.map(([n, k, c]) => `<li><i class="dot ${c}"></i>${n}<b>${bd[k]}%</b></li>`).join('')}</ul></div>
        <p class="m-legend m-only">${bd.flights}% flights · ${bd.campus}% campus<br>${bd.partners}% partners</p>
        <p class="foot-note d-only">Refreshed just now</p>
      </div>
    </section>`;
  }

  function nextFlightCard(next) {
    const s = next.segments[0], n = daysUntil(s.dep), view = `#/trip/${next.ref}`;
    return `<div class="nf-label m-only"><span class="lab">Next flight</span>${link(view, 'View booking')}</div>
    <section class="card nf">
      <div class="nf-top"><span class="lab d-only">Next flight</span><span class="pillc">Confirmed</span></div>
      <div class="nf-date">${dayMon(s.dep)}</div>
      <div class="nf-route"><div><b>${s.from}</b><span class="d-only">${esc(city(s.from))}</span></div>${icon('arrow')}<div><b>${s.to}</b><span class="d-only">${esc(city(s.to))}</span></div></div>
      <p class="nf-cities m-only">${esc(city(s.from))} · ${esc(city(s.to))}</p>
      <div class="nf-foot d-only"><div><span class="lab">Your flight in</span><b>${n <= 0 ? 'today' : plural(n, 'day')}</b></div>${link(view, 'View booking')}</div>
      <p class="nf-days m-only">${n <= 0 ? 'Departs today' : plural(n, 'day') + ' to go'}</p>
    </section>`;
  }

  const noFlightCard = () => `<section class="card nf d-only"><span class="lab">Next flight</span>
    <div class="nf-empty"><b>No flight booked yet</b><span>Your next booking will appear here.</span></div>${link('#/book', 'Book a flight')}</section>`;

  function companionCard(next) {
    if (!next) {
      return `<section class="card companion">
        <div class="ch d-only"><div><h3>Your flight companion</h3><p>Your trip support, all in one place.</p></div></div>
        <div class="chat empty">
          <span class="ibadge">${icon('plane')}</span>
          <div><h4>Ready when you are</h4>
            <p>Book a Cathay flight to unlock your personal flight chat.<br>Already booked? <a href="#/retrieve">Add your booking</a> to your student account.</p>
            <a class="btn btn-primary" href="#/book">Book a flight ${icon('ext')}</a></div>
        </div>
        <p class="lock-note">Your chat opens 7 days before departure.</p></section>`;
    }
    const dep = next.segments[0].dep, n = daysUntil(dep);
    const unlock = new Date(dep); unlock.setDate(unlock.getDate() - 7);
    const open = n <= 7;
    const span = Math.max(1, daysBetween(next.bought, unlock)), done = daysBetween(next.bought, new Date());
    const pct = Math.max(6, Math.min(100, Math.round((done / span) * 100)));
    const body = open
      ? `<div class="chat"><div class="chat-row"><span class="ibadge">${icon('sparkle')}</span><div><h4>Your flight chat is open</h4><p>Ask about your trip, baggage, check-in and more.</p></div></div>
          <div><a class="btn btn-primary" href="#/chat/${next.ref}/0">Open chat ${icon('ext')}</a></div></div>`
      : `<div class="chat">
          <div class="chat-row"><span class="ibadge">${icon('clock')}</span><div>
            <h4><span class="d-only">Your chat unlocks 7 days before departure</span><span class="m-only">Chat unlocks 7 days before</span></h4>
            <p class="d-only">We’ll open your personal flight chat on ${longDay(unlock)}. Until then, explore student travel tips and offers.</p>
            <p class="m-only">${shortDay(unlock)} · ${plural(n, 'day')} until your flight</p></div></div>
          <div class="prog" role="progressbar" aria-label="Time until your chat unlocks" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          <p class="days-left d-only">${plural(n, 'day')} to go</p>
          <p class="m-note m-only muted sm">Until then, explore travel tips and offers.</p>
          <p class="sm">${link('#/chat-safety', 'How the student chat keeps you safe')}</p></div>`;
    return `<section class="card companion">
      <div class="ch d-only"><span class="ibadge">${icon('sparkle')}</span><div><h3>Your flight companion</h3><p>Ask about your trip, baggage, check-in and more.</p></div></div>
      ${body}
      ${open ? '' : '<p class="lock-note d-only">Chat is locked until your 7-day window begins.</p>'}
    </section>`;
  }

  const exclCard = (next) => `<a class="excl" href="#/offers">
    <span class="lab d-only">Cathay Student exclusives</span>
    <h3><span class="d-only">More ways to make every mile count.</span><span class="m-only">Student-exclusive offers</span></h3>
    <span class="go"><span class="d-only">Explore offers</span><span class="m-only">${next ? 'Explore' : 'Explore student deals'}</span><span class="m-only">${icon('ext')}</span></span>
    <span class="arrow d-only">${icon('ext')}</span><span class="spark m-only">${icon('sparkle')}</span></a>`;

  const quickLinks = () => `<section class="card ql d-only"><h4>Quick links</h4>
    <a class="qrow" href="#/baggage">${icon('bag')}<div><b>Student baggage</b><span class="s">Know your allowance</span></div></a>
    <a class="qrow" href="#/rewards">${icon('gift')}<div><b>Student perks</b><span class="s">Free adapter, invites, graduation gift</span></div></a>
    <button class="qrow" type="button" data-action="soon" data-label="Campus community">${icon('ring')}<div><b>Campus community</b><span class="s">Connect with student travellers</span></div></button></section>`;

  const activityRow = (a) => (!a ? `<div class="card act"><span class="ibadge">${icon('sparkle')}</span><div><b>No activity yet</b><span class="s">Points appear after you verify as a student and check in to flights.</span></div></div>`
    : `<div class="card act"><span class="ibadge">${icon('sparkle')}</span>
    <div><b>${esc(a.title)}</b><span class="s">${a.date ? fmtDate(a.date + 'T12:00', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' : ''}${esc(a.note)}</span></div>
    <b class="pts${a.pts < 0 ? ' neg' : ''}">${a.pts < 0 ? '−' : '+'}${pts(Math.abs(a.pts))} ${a.unit === 'miles' ? 'miles' : 'pts'}</b></div>`);

  /* ---------- public Cathay interface (signed out / not a verified student) ---------- */
  const isStudent = () => Boolean(user && user.verified);
  function signedOutHome() {
    return `<div class="home noflight">
      <header class="pagehead"><div><p class="crumb">Overview</p><h1>Welcome to Cathay</h1>
        <p class="sub">Book flights, manage your trips and earn Asia Miles.</p></div></header>
      ${quickBookCard()}
      <div class="g2 mid" style="margin-top:20px">
        <section class="card companion"><h3>Already booked?</h3><p class="sub" style="margin-bottom:16px">Find your booking with its reference and your family name.</p>
          <a class="btn btn-primary" href="#/retrieve">Manage booking</a></section>
        <section class="card companion"><h3>Join Cathay</h3><p class="sub" style="margin-bottom:16px">Create a free account to book, check in online and earn Asia Miles on every flight.</p>
          <div class="row gap-sm"><a class="btn btn-primary" href="#/signup">Create account</a><a class="btn btn-ghost" href="#/signin">Sign in</a></div></section>
      </div></div>`;
  }
  /* Asia Miles card for members who aren't verified students. */
  function milesCard() {
    return `<section class="card miles-card">
      <span class="lab">Asia Miles</span><div class="pts-num">${pts(asiaMiles())}</div>
      <div class="muted sm">Member ${esc(user.memberId)} · since ${esc(user.memberSince || '')}</div>
      <a class="link" href="#/rewards">Points &amp; rewards${icon('ext')}</a></section>`;
  }
  /* Gentle, dismissible guide towards student verification. */
  const studentBanner = () => `<a class="banner student-banner" href="#/discover">${icon('cap')}<span><b>University student?</b><br><span class="muted sm">Verify with your university email and student ID to unlock student seating, student points and perks.</span></span>${icon('arrow')}</a>`;
  /* Where the member is in student verification, with the next step (home pages). '' when there's nothing to do. */
  function verifyNotice() {
    if (!user) return '';
    const st = vStatus(), v = user.verified;
    const b = (ic, title, text, tone = '') => `<a class="banner vf-banner ${tone}" href="#/verify" data-action="go-verify">${icon(ic)}<span><b>${title}</b><br><span class="muted sm">${text}</span></span>${vBadge(st)}${icon('arrow')}</a>`;
    if (v && sv && sv.expiresSoon) return b('alert', `Your student verification ends on ${esc(fmtDay(v.until))}`, 'Re-verify now to keep student seating, chat and perks.', 'warn');
    if (v && sv && (sv.flightsNotCovered || []).length) return b('alert', 'Your verification ends before a booked flight', `Re-verify with a document valid on ${esc(fmtDay(sv.flightsNotCovered[0]))} to use student features on that trip.`, 'warn');
    if (v) return '';
    return { awaiting_document: b('ticket', 'Almost there: upload your student ID', 'Your university email is verified. Add your student ID to unlock student features.', 'warn'),
      pending_review: b('clock', 'Your student ID is being reviewed', "Usually within 1–2 working days. We'll show the result here.", 'warn'),
      rejected: b('alert', 'We need more information', "We couldn't confirm your student status. See why and upload a new document.", 'bad'),
      expired: b('alert', 'Student verification expired', 'Student features are paused. Re-verify with a current student ID or enrolment letter.', 'bad') }[st] || '';
  }
  function memberHome() {
    const next = upcoming()[0];
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `<div class="home ${next ? '' : 'noflight'}">
      <header class="pagehead"><div><p class="crumb">Overview</p><h1><span class="g">${greet},</span> <span class="n">${esc(user.firstName)}</span></h1>
        <p class="sub">Your trips and Asia Miles in one place.</p></div></header>
      ${verifyNotice() || studentBanner()}
      <div class="g2">${milesCard()}${next ? nextFlightCard(next) : noFlightCard()}</div>
      ${quickBookCard()}
      <div class="sect-head" style="margin-top:20px"><h3>Recent activity</h3>${link('#/rewards', 'View all')}</div>${activityRow(activity()[0])}
    </div>`;
  }
  /* Shown once after signing in when the member isn't a verified student yet. */
  function studentPromo() {
    document.querySelector('.modal-bg')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" data-action="modal-close">
        <div class="modal promo" data-action="noop" role="dialog" aria-modal="true" aria-labelledby="promoTitle">
          <div class="promo-hero"><span class="promo-badge">${icon('cap')} Cathay Student</span>
            <h2 id="promoTitle">Studying at university?</h2>
            <p>Verify your university email and student ID and your membership becomes a student membership. Free, in a few minutes.</p></div>
          <ul class="promo-list">
            <li>${icon('seat')}<span><b>Fly next to students</b> from your university, seated automatically</span></li>
            <li>${icon('gift')}<span><b>${PERKS.welcome.toLocaleString()} welcome points</b>, enough to choose your seat on Economy Light</span></li>
            <li>${icon('up')}<span><b>1.5 student points</b> per mile on every trip home, 70% become Asia Miles when you graduate</span></li>
            <li>${icon('plug')}<span><b>Free plug adapter</b> on your first flight to your university's country</span></li>
          </ul>
          <a class="btn btn-primary block" href="#/verify" data-action="modal-close">Verify my student status</a>
          <a class="btn btn-ghost block" href="#/discover" data-action="modal-close">Discover student benefits</a>
          <button class="link-btn block-link" data-action="modal-close">Not now</button>
        </div>
      </div>`);
    $('.modal.promo .btn').focus();
  }
  /* Student benefits explainer (public). */
  views.discover = () => `
    <div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">Cathay Student</p><h1>One membership from your first flight to your first job</h1>
        <p class="sub">For university students aged 18+, verified with a university email and a student ID. Benefits are linked to your membership, not to promo codes, and stay active while your student status is valid.</p></div></header>
      <div class="disc-grid">
        ${[
          ['seat', 'Student seating', 'Say yes once: at check-in you sit next to other students, from your university when possible. Names are never shown; universities only if a student chooses.'],
          ['gift', 'Welcome bonus', `${PERKS.welcome.toLocaleString()} student points when you verify: enough to choose your seat on an Economy Light fare.`],
          ['up', 'Student points', 'Earn 1.5 student points per mile on your flights. Spend them on Wi-Fi, seats and lounges; 70% of what is left becomes Asia Miles at graduation.'],
          ['plug', 'Free travel adapter', "On your first flight to your university's country, handed to you by the crew. Once per study programme."],
          ['share', 'Invite friends', `When a friend joins with your link and books their first flight, you both get a bonus: ${Math.round(PERKS.spRate * PERKS.inviteStudentShare * 1000) / 1000} student points per mile for students, ${Math.round(PERKS.inviteAlpha * 100)}% of the flight's Asia Miles otherwise.`],
          ['cap', 'Graduation gift', `One tier up for ${PERKS.boostMonths} months and ${PERKS.gradMiles.toLocaleString()} bonus miles, for your first work trips.`],
          ['chat', 'Student flight chat', 'A moderated group chat for verified students on your flight, open 7 days before departure. Group only, no private messages.'],
          ['tag', 'Student card (proposed)', 'A student card with our card partner: no income requirement, earns student points on everyday spending, upgrades at graduation. Concept only, not available.'],
        ].map(([ic, h, p]) => `<div class="card disc">${icon(ic)}<h3>${h}</h3><p class="muted sm">${p}</p></div>`).join('')}
      </div>
      <div class="row gap-sm">${user ? (user.verified ? `<a class="btn btn-primary" href="#/rewards">See my student perks</a>` : `<a class="btn btn-primary" href="#/verify">Verify my student status</a>`) : `<a class="btn btn-primary" href="#/signup">Create an account</a>`}
        <a class="btn btn-ghost" href="#/chat-safety">Chat safety &amp; privacy</a><a class="btn btn-ghost" href="#/parents">For parents</a></div>
    </div>`;

  views.home = () => {
    if (!user) return signedOutHome();
    if (!isStudent()) return memberHome();
    const next = upcoming()[0];
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const ini = esc(user.firstName[0] + user.lastName[0]);
    return `<div class="home ${next ? '' : 'noflight'}">
      <header class="pagehead">
        <div>
          <p class="crumb d-only">Overview / Student home</p>
          <h1 class="${next ? '' : 'd-only'}"><span class="g">${greet},</span> <span class="n">${esc(user.firstName)}</span>${user.verified ? ' ' + tick('tick-lg') : ''}</h1>
          ${next ? '' : '<h1 class="m-only">Your next journey</h1>'}
          <p class="sub d-only">Your next journey starts here. Here’s your student snapshot.</p>
          <p class="sub m-only">${next ? 'Your next journey starts here.' : 'Your flight companion lives here.'}</p>
        </div>
        <div class="head-actions d-only"><a class="circle" href="#/home" aria-label="Overview">${icon('home')}</a><a class="pillbtn" href="#/profile" aria-label="Account settings">${ini} ${icon('ext')}</a></div>
      </header>
      ${verifyNotice()}
      <div class="g2">${pointsCard()}${next ? nextFlightCard(next) : noFlightCard()}</div>
      ${quickBookCard()}
      <div class="sect d-only"><h2>Made for your next journey</h2><p class="sub">Student-only tools, ready when you are.</p></div>
      <div class="sect m-only"><h2>Your flight companion</h2>${next ? '<p class="sub">Your personal trip support</p>' : ''}</div>
      <div class="g2 mid">${companionCard(next)}<div class="rcol">${exclCard(next)}${quickLinks()}</div></div>
      <div class="d-only"><div class="sect-head"><h3>Recent activity</h3>${link('#/rewards', 'View all')}</div>${activityRow(activity()[0])}</div>
    </div>`;
  };

  /* ---------- invites ---------- */
  const EXAMPLE = { cabin: 'Economy', segments: [{ from: 'HKG', to: 'LHR' }] };
  function inviteCard() {
    fetchRefs();
    const refs = (refsCache || {}).referrals || [];
    const rows = refs.map((r, i) => {
      const b = r.booking && i < PERKS.referralCap ? inviteBonus(r.booking) : null;
      return `<div class="perk-row"><div><b>Friend ${esc(r.name)}</b><div class="muted sm">Joined ${fmtDate(r.joined + 'T12:00', { day: 'numeric', month: 'short' })} · ${r.booking ? `booked ${esc(r.booking.segments[0].from)} → ${esc(r.booking.segments[r.booking.segments.length - 1].to)}` : 'no booking yet'}</div></div>
        ${b ? `<span class="badge ok">+${b.amount.toLocaleString()} ${b.unit === 'pts' ? 'student points' : 'miles'}</span>` : '<span class="badge">Waiting for first booking</span>'}</div>`;
    }).join('') || (isLocalAccount() ? '<p class="muted sm">Invites need an online account (this one is stored on this device only).</p>' : '<p class="muted sm">No friends have joined with your link yet.</p>');
    return `<div class="card perk" id="inviteCard">
      <div class="perk-head">${icon('share')}<div><h3>Invite friends</h3><p class="muted sm">When a friend joins with your link and books their first flight, you both get a bonus. Up to ${PERKS.referralCap} friends. <button type="button" class="link-btn" data-action="invite-info" data-who="inviter">How it works</button></p></div></div>
      <div class="ref-link"><span class="mono">${esc(refLink())}</span><button class="btn btn-primary sm-btn" data-action="ref-copy">${navigator.share ? 'Share' : 'Copy'}</button></div>
      ${rows}
    </div>`;
  }
  /* Explains the invite rules. who: 'inviter' (my link) or 'invited' (I came through a friend's link). */
  function inviteInfo(who) {
    const miles = bookingMiles(EXAMPLE);
    const stu = Math.round(miles * PERKS.spRate * PERKS.inviteStudentShare), non = Math.round(miles * PERKS.inviteAlpha);
    document.querySelector('.modal-bg')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" data-action="modal-close">
        <div class="modal promo" data-action="noop" role="dialog" aria-modal="true" aria-labelledby="invTitle">
          <div class="promo-hero"><span class="promo-badge">${icon('share')} Invite friends</span>
            <h2 id="invTitle">${who === 'invited' ? 'A friend invited you' : 'Fly together, earn together'}</h2>
            <p>${who === 'invited' ? 'Book your first Cathay flight with this account and you and your friend both get a bonus.' : 'Share your link. When a friend joins with it and books their first Cathay flight, you both get a bonus.'}</p></div>
          <ul class="promo-list">
            <li>${icon('check')}<span><b>As soon as the first flight is booked.</b> If that booking is cancelled, the bonus is removed.</span></li>
            <li>${icon('plane')}<span><b>Not a student:</b> ${Math.round(PERKS.inviteAlpha * 100)}% of the Asia Miles that flight earns, as Asia Miles.</span></li>
            <li>${icon('cap')}<span><b>Verified student:</b> ¼ of the student points that flight earns (students earn ${PERKS.spRate} student points per mile), as student points. That's more: ${PERKS.spRate * PERKS.inviteStudentShare} points per mile.</span></li>
            <li>${icon('info')}<span><b>Example:</b> Hong Kong → London in Economy earns about ${miles.toLocaleString()} miles. Non-student: +${non.toLocaleString()} Asia Miles. Student: +${stu.toLocaleString()} student points.</span></li>
            ${who === 'invited' ? '' : `<li>${icon('share')}<span>Up to ${PERKS.referralCap} friends. Each side gets their own bonus.</span></li>`}
          </ul>
          ${who === 'invited' && !user ? '<a class="btn btn-primary block" href="#/signup" data-action="modal-close">Create my account</a>' : '<button class="btn btn-primary block" data-action="modal-close">Got it</button>'}
          <div style="height:16px"></div>
        </div>
      </div>`);
    $('.modal.promo .btn').focus();
  }
  /* The first time the invite card scrolls into view, explain why inviting is worth it (once per account). */
  let inviteObs = null;
  function watchInviteCard() {
    if (inviteObs) { inviteObs.disconnect(); inviteObs = null; }
    const card = $('#inviteCard');
    if (!card || !user || perks().inviteInfoSeen || !('IntersectionObserver' in window)) return;
    inviteObs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || document.querySelector('.modal-bg')) return;
      inviteObs.disconnect(); inviteObs = null;
      const p = perks(); p.inviteInfoSeen = true; savePerks(p);
      inviteInfo('inviter');
    }, { threshold: 0.6 });
    inviteObs.observe(card);
  }

  /* Overview: book a flight without leaving the page first. */
  function quickBookCard() {
    return `<form id="quickBook" class="card quick-book">
      <div class="qb-head">${icon('plane')}<div><h3>Book a flight</h3><p class="muted sm">${isStudent() ? 'Real Cathay schedules · student seating and points included' : 'Search real Cathay schedules'}</p></div></div>
      <div class="qb-fields">
        <label class="field"><span>From</span><select name="from">${airportOptions(search.from || 'HKG')}</select></label>
        <label class="field"><span>To</span><select name="to" required>${airportOptions(search.to, 'Going to…')}</select></label>
        <label class="field"><span>Departing</span><input type="date" name="depart" min="${todayStr()}" value="${search.depart}" required></label>
        <label class="field"><span>Cabin</span><select name="cabin">${CABINS.map((c) => `<option ${c === search.cabin ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <button class="btn btn-primary" type="submit">Search flights</button>
      </div>
      <p id="qbErr" class="err" hidden></p>
    </form>`;
  }

  function memberCard() {
    return `<div class="member">
      <div class="row between"><span class="lab">${isStudent() ? 'Student member' : 'Member'}</span>${currentTier() !== user.tier ? `<span class="tier">${esc(currentTier())} · graduation gift</span>` : ''}</div>
      <div class="member-name">${esc(user.firstName)} ${esc(user.lastName)}${user.verified ? ' ' + tick() : ''}</div>
      <div class="mono">${esc(user.memberId)}</div>
      <div class="row between stats"><div><span class="lab">Student points</span><b>${pts(spLeft(perks()))}</b></div>
        <div><span class="lab">Asia Miles</span><b>${pts(asiaMiles())}</b></div>
        <div><span class="lab">Earned this month</span><b>+${pts(earnedThisMonth())}</b></div></div>
    </div>`;
  }

  views.rewards = () => (isStudent() ? studentRewards() : `
    <div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">Points &amp; rewards</p><h1>Your Asia Miles</h1>
        <p class="sub">Earn on every Cathay flight and spend on flights, upgrades and more.</p></div></header>
      ${milesCard()}
      ${studentBanner()}
      ${inviteCard()}
      <div class="sect-head"><h3>Recent activity</h3></div>
      <div class="stack" style="margin-top:0">${activity().length ? activity().map(activityRow).join('') : activityRow()}</div>
    </div>`);
  const studentRewards = () => `
    <div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">Points &amp; rewards</p><h1>Your student points</h1>
        <p class="sub">Earn on flights, campus and partners; spend on student rewards; 70% of what's left becomes Asia Miles when you graduate.</p></div></header>
      ${pointsCard()}
      ${perksBody()}
      <div class="sect-head"><h3>Recent activity</h3></div>
      <div class="stack" style="margin-top:0">${activity().length ? activity().map(activityRow).join('') : activityRow()}</div>
    </div>`;

  const OFFER_TONES = [['#0b4a35', '#2f8a62'], ['#164b36', '#3f9a72'], ['#27502f', '#8aa83a'], ['#3a4f1d', '#a9c24a'], ['#0f3d4a', '#3f8f9a'], ['#5a3a14', '#d98b3f']];
  views.offers = () => {
    const cards = ['SIN', 'NRT', 'ICN', 'BKK', 'SYD', 'LHR'].map((c, i) => `
      <button class="offer" data-action="offer" data-code="${c}" style="background:linear-gradient(145deg,${OFFER_TONES[i][0]},${OFFER_TONES[i][1]})">
        <span>From Hong Kong</span><b>${esc(city(c))}</b><span>Fares from ${money(basePrice('HKG', c))}</span></button>`).join('');
    const verify = !user ? '' : user.verified
      ? `<div class="banner">${tick()}<span><b>Student status verified</b><br><span class="muted sm">Verified with ${esc(user.verified.email)}${user.verified.until ? ' · valid until ' + esc(fmtDay(user.verified.until)) : ''}.</span></span></div>`
      : verifyNotice() || `<a class="banner" href="#/verify">${tick('tick-off')}<span><b>Verify your student status</b><br><span class="muted sm">Use your university email and student ID to unlock student offers and earn a green tick.</span></span>${icon('arrow')}</a>`;
    return `<div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">${isStudent() ? 'Student offers' : 'Offers'}</p><h1>${isStudent() ? 'Student offers' : 'Offers'}</h1>
        <p class="sub">${isStudent() ? 'Fares and perks picked for students flying from Hong Kong.' : 'Fares from Hong Kong.'}</p></div></header>
      ${verify}<div class="offers" style="margin-top:0">${cards}</div></div>`;
  };

  views.book = () => {
    const s = search;
    return `
    <div class="narrow">
      <h1>Book a flight</h1>
      <form id="searchForm" class="card form">
        <div class="tabs">
          ${['return', 'one way'].map((t) => `<button type="button" class="${s.type === t ? 'on' : ''}" data-action="set-type" data-type="${t}">${t === 'return' ? 'Return' : 'One way'}</button>`).join('')}
        </div>
        <div class="route">
          <label class="field"><span>From</span><select name="from">${airportOptions(s.from)}</select></label>
          <button type="button" class="swap" data-action="swap" aria-label="Swap origin and destination">${icon('swap')}</button>
          <label class="field"><span>To</span><select name="to">${airportOptions(s.to, 'Going to…')}</select></label>
        </div>
        <div class="two">
          <label class="field"><span>Departing</span><input type="date" name="depart" min="${todayStr()}" value="${s.depart}" required></label>
          ${s.type === 'return' ? `<label class="field"><span>Returning</span><input type="date" name="ret" min="${todayStr()}" value="${s.ret}" required></label>` : '<div></div>'}
        </div>
        <div class="two">
          <label class="field"><span>Cabin</span><select name="cabin">${CABINS.map((c) => `<option ${c === s.cabin ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Passengers</span><select name="pax">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === s.pax ? 'selected' : ''}>${n} adult${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
        </div>
        <p id="searchErr" class="err" hidden></p>
        <button class="btn btn-primary block" type="submit">Search flights</button>
      </form>
    </div>`;
  };

  views.results = () => {
    const s = search;
    if (!s.to) return redirect('#/book');
    const outbound = s.step === 'out';
    const leg = outbound ? { from: s.from, to: s.to, date: s.depart } : { from: s.to, to: s.from, date: s.ret };
    const flights = flightsFor(leg.from, leg.to, leg.date, s.cabin);
    const live = LIVE.flights[[leg.from, leg.to, leg.date, s.cabin].join('|')];
    const srcNote = !LIVE.on ? '' : !flights ? '<div class="card sm live-src">Loading the real Cathay schedule…</div>'
      : live && live.source === 'oag' ? `<div class="card sm live-src on">${icon('check')} Real Cathay schedule · OAG</div>`
      : `<div class="card sm live-src">Simulated schedule${live && live.note ? ' · ' + esc(live.note) : ''}</div>`;
    const strip = [-2, -1, 0, 1, 2].map((n) => shiftDate(leg.date, n)).filter((d) => d >= todayStr()).map((d) => {
      const min = Math.min(...generateFlights(leg.from, leg.to, d, s.cabin).map((f) => f.price));
      return `<button class="day ${d === leg.date ? 'on' : ''}" data-action="set-date" data-date="${d}"><span>${fmtDate(d + 'T12:00', { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>${money(min * s.pax)}</b></button>`;
    }).join('');
    return `
    <div class="narrow wide">
      ${backLink(outbound ? '#/book' : '#/results" data-action="back-out', outbound ? 'Change search' : 'Change outbound')}
      <p class="eyebrow">${outbound ? 'Step 1 · Outbound' : 'Step 2 · Return'} · ${s.pax} adult${s.pax > 1 ? 's' : ''} · ${esc(s.cabin)}</p>
      <h1>${city(leg.from)} → ${city(leg.to)}</h1>
      ${!outbound ? `<div class="card chosen sm">Outbound selected: <b>${s.out.number}</b> ${fmtDate(s.out.dep)} ${fmtTime(s.out.dep)}</div>` : ''}
      <div class="days">${strip}</div>
      ${srcNote}
      ${studentDatesCard(leg)}
      <div class="flights">
        ${(flights || []).map((f, i) => `
        <div class="card flight">
          <div class="f-main">
            <div><b class="time">${fmtTime(f.dep)}</b><div class="muted sm">${f.from}</div></div>
            <div class="f-mid"><span class="muted sm">${dur(f.durMin)}</span><div class="line thin"></div><span class="muted sm">${f.stops ? '1 stop' : 'Nonstop'}</span></div>
            <div><b class="time">${fmtTime(f.arr)}</b><div class="muted sm">${f.to}</div></div>
          </div>
          <div class="f-side">
            <div class="muted sm">${f.number} · ${f.aircraft}</div>
            ${f.students && isStudent() && s.cabin === 'Economy' ? `<div class="sd-badge">${icon('cap')} ${esc(f.students)} students on this flight</div>` : ''}
            ${s.cabin === 'Economy'
              ? `<div class="fares">${Object.entries(FARES).map(([name, fr]) => `<button class="fare" data-action="pick" data-idx="${i}" data-fare="${name}" title="${esc(fr.note)}"><span>Economy ${name}</span><b>${money(Math.round(f.price * fr.mult) * s.pax)}</b><small>${fr.seat === 'paid' ? 'Seat choice extra' : 'Seat choice included'}</small></button>`).join('')}</div>`
              : `<div class="price">${money(f.price * s.pax)}</div><button class="btn btn-primary sm-btn" data-action="pick" data-idx="${i}">Select</button>`}
            ${f.seatsLeft <= 4 ? `<div class="warn sm">${f.seatsLeft} seats left</div>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <p class="muted sm">Fares are illustrative. Times are local at each airport.</p>
    </div>`;
  };

  views.confirm = () => {
    const s = search;
    if (!s.out || (s.type === 'return' && !s.back)) return redirect('#/book');
    const fare = (s.out.price + (s.back ? s.back.price : 0)) * s.pax;
    const taxes = Math.round(fare * 0.14);
    const pax = Array.from({ length: s.pax }, (_, i) => `
      <div class="two">
        <label class="field"><span>Passenger ${i + 1} · given name</span><input name="first${i}" required value="${i === 0 && user ? esc(user.firstName) : ''}"></label>
        <label class="field"><span>Family name</span><input name="last${i}" required value="${i === 0 && user ? esc(user.lastName) : ''}"></label>
      </div>`).join('');
    const flightLine = (f) => `<div class="sum-row"><b>${f.number}</b><span>${city(f.from)} → ${city(f.to)}</span><span>${fmtDate(f.dep, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(f.dep)}</span></div>
      <div class="sum-row sm"><span class="muted">${esc(fareName(s.cabin, f.fare))}</span><span class="${seatRule(s.cabin, f.fare) === 'paid' ? 'warn' : 'muted'}">${seatRule(s.cabin, f.fare) === 'paid' ? `Seat selection: extra (${PERKS.seatSp.toLocaleString()} student points or ${PERKS.seatMiles.toLocaleString()} Asia Miles)` : 'Seat selection included'}</span></div>`;
    return `
    <div class="narrow">
      ${backLink('#/results', 'Back to flights')}
      <h1>Review & pay</h1>
      <div class="card">${flightLine(s.out)}${s.back ? flightLine(s.back) : ''}
        <hr><div class="sum-row"><span>Fare (${s.pax} × ${esc(s.cabin)})</span><b>${money(fare)}</b></div>
        <div class="sum-row"><span>Taxes & charges</span><b>${money(taxes)}</b></div>
        <div class="sum-row total"><span>Total</span><b>${money(fare + taxes)}</b></div></div>
      <form id="confirmForm" class="card form">
        <h3>Passengers</h3>${pax}
        ${s.cabin === 'Economy' ? (studentOk(s.out.dep) ? `<div class="sz-card card">${verifiedLabel()}<div class="sz-choice-wrap">${seatPoll()}</div></div>` : studentGate(s.out.dep)) : ''}
        <label class="field"><span>Contact email</span><input type="email" name="email" required value="${user ? esc(user.email) : ''}"></label>
        <label class="field"><span>Payment</span><input value="Demo card •••• 4242 (no real payment)" disabled></label>
        <button class="btn btn-primary block" type="submit">Confirm booking · ${money(fare + taxes)}</button>
      </form>
    </div>`;
  };

  views.trips = () => {
    const list = tripsTab === 'upcoming' ? upcoming() : past();
    return `
    <div class="narrow">
      <div class="row between"><h1>My flights</h1><a class="btn btn-primary sm-btn" href="#/book">Book a flight</a></div>
      <div class="tabs">
        <button class="${tripsTab === 'upcoming' ? 'on' : ''}" data-action="trips-tab" data-tab="upcoming">Upcoming (${upcoming().length})</button>
        <button class="${tripsTab === 'past' ? 'on' : ''}" data-action="trips-tab" data-tab="past">Past & cancelled (${past().length})</button>
      </div>
      <div class="stack">${list.map(tripCard).join('') || '<div class="card empty">Nothing here yet.</div>'}</div>
      <div class="two"><a class="btn btn-ghost" href="#/retrieve">Retrieve a booking</a><a class="btn btn-ghost" href="#/tools">Travel tools</a></div>
    </div>`;
  };

  views.trip = (ref) => {
    const t = findTrip(ref);
    if (!t) return notFound();
    const up = isUpcoming(t);
    return `
    <div class="narrow">
      ${backLink(user ? '#/trips' : '#/retrieve', 'Back')}
      <div class="row between"><h1>${tripLabel(t)}</h1>${badge(t.status)}</div>
      <p class="muted">Booking reference <b class="mono">${t.ref}</b> · ${t.pax.map((p) => esc(p.first + ' ' + p.last)).join(', ')}</p>
      ${t.segments.map((s, i) => segmentCard(s, t, i)).join('')}
      <div class="card">
        <div class="sum-row"><span>Total paid</span><b>${money(t.total)}</b></div>
        <div class="sum-row"><span>Baggage</span><b>${t.cabin === 'Economy' ? '1 × 23 kg' : t.cabin === 'Premium Economy' ? '2 × 23 kg' : '2 × 32 kg'}</b></div>
      </div>
      ${studentCard(t)}
      ${up ? `<div class="stack">
        ${t.checkedIn
          ? t.segments.map((s, i) => `<a class="btn btn-primary block" href="#/boarding/${t.ref}/${i}">Boarding pass · ${s.from} → ${s.to}</a>`).join('')
          : canCheckIn(t)
            ? `<button class="btn btn-primary block" data-action="checkin" data-ref="${t.ref}">${studentTrip(t) ? 'Check in · get your seat' : t.cabin === 'Economy' ? 'Check in & choose seat' : 'Check in online'}</button>`
            : `<div class="card empty sm">Online check-in opens 48 hours before departure.</div>`}
        <button class="btn btn-danger block" data-action="cancel" data-ref="${t.ref}">Cancel booking</button></div>` : ''}
    </div>`;
  };

  views.boarding = (ref, idx) => {
    const t = findTrip(ref);
    const s = t && t.segments[Number(idx)];
    if (!t || !s) return notFound();
    if (!t.checkedIn) return redirect('#/trip/' + ref);
    const seed = ref + idx;
    const p = t.pax[0];
    const plan = studentTrip(t) ? seatPlan(t, Number(idx)) : null;
    const me = plan && plan.students.find((x) => x.me), nb = me ? plan.neighboursOf(me) : [];
    return `
    <div class="narrow">
      ${backLink('#/trip/' + ref, 'Back to trip')}
      <div class="pass">
        <div class="pass-top"><span>Cathay Student · Boarding pass</span><span class="row gap-sm">${me ? `<span class="pass-tag">${icon('cap')} STUDENT</span>` : ''}${esc(t.cabin)}</span></div>
        <div class="pass-name">${esc((p.last + '/' + p.first).toUpperCase())}</div>
        <div class="pass-route"><div><b>${s.from}</b><span>${city(s.from)}</span></div>${icon('plane', 'big')}<div class="right"><b>${s.to}</b><span>${city(s.to)}</span></div></div>
        <div class="pass-grid">
          <div><span>Flight</span><b>${esc(s.number)}</b></div><div><span>Date</span><b>${fmtDate(s.dep, { day: '2-digit', month: 'short' })}</b></div>
          <div><span>Boarding</span><b>${fmtTime(new Date(new Date(s.dep).getTime() - 45 * 60000))}</b></div><div><span>Departs</span><b>${fmtTime(s.dep)}</b></div>
          <div><span>Gate</span><b>${gateFor(seed)}</b></div><div><span>Terminal</span><b>${termFor(seed)}</b></div>
          <div><span>Seat</span><b>${esc(s.seat)}</b></div><div><span>Group</span><b>${t.cabin === 'Economy' ? '4' : '1'}</b></div>
        </div>
        ${me ? `<div class="pass-zone">${icon('cap')} ${nb.length ? 'Seated next to ' + nearText(nb) : 'Student seating'}</div>` : ''}
        ${tripRewards(t).map((r) => `<div class="pass-zone">${icon(REWARDS.find((x) => x.id === r.id).icon)} ${esc(rewardName(r.id))} · student points</div>`).join('')}
        ${Number(idx) === 0 && user && user.verified && adapterClaimed() && perks().adapter.ref === t.ref ? `<div class="pass-zone">${icon('plug')} Travel adapter Type ${esc(SZ.plugFor(s.to))} · collect it from the crew on board</div>` : ''}
        <div class="pass-cut"></div>
        <div class="qr">${barcode(seed)}</div>
        <div class="muted center sm">DEMO PASS — not valid for travel · ${t.ref}</div>
      </div>
    </div>`;
  };

  let seatCtx = null; // trip, segment index and student seat plan of the open seat map / planner

  /* Economy seat map; cell(id) returns the markup for one seat. */
  function seatGrid(c, cell) {
    const aisle = '<span class="aisle"></span>';
    const rows = [`<div class="srow letters"><span class="rnum"></span>${c.blocks.map((b) => b.map((L) => `<span class="seat-l">${L}</span>`).join('')).join(aisle)}</div>`];
    for (let r = c.first; r <= c.last; r++) rows.push(`<div class="srow"><span class="rnum">${r}</span>${c.blocks.map((b) => b.map((L) => cell(r + L)).join('')).join(aisle)}</div>`);
    return `<div class="seatmap">${rows.join('')}</div>`;
  }
  /* tip: text for the floating hover panel (student seats); otherwise the native title tooltip. */
  const seatEl = (id, cls, inner = '', action = '', label = '', tip = '') => {
    const attrs = `data-seat="${id}" aria-label="Seat ${id}${esc(label)}" ${tip ? `data-tip="${esc(id + ' · ' + tip)}"` : `title="${id}${esc(label)}"`}`;
    return action ? `<button class="seat ${cls}" data-action="${action}" ${attrs}>${inner}</button>` : `<span class="seat ${cls}" ${attrs} tabindex="${tip ? 0 : -1}">${inner}</span>`;
  };
  const legend = (items) => `<div class="seat-legend">${items.map(([cls, label]) => `<span><i class="${cls}"></i>${label}</span>`).join('')}</div>`;

  views.seats = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx), s = t && t.segments[i];
    if (!t || !s) return notFound();
    if (t.checkedIn || !canCheckIn(t)) return redirect('#/trip/' + ref);
    const { c, p, taken } = seatState(t, i);
    const me = p && p.students.find((x) => x.me);
    seatCtx = { t, i, p, c, taken };
    const head = `${backLink('#/trip/' + ref, 'Back to trip')}
      <p class="eyebrow">Check-in · flight ${i + 1} of ${t.segments.length} · ${esc(fareName(t.cabin, s.fare || t.fare))}</p>
      <h1>${me || seatLocked(t, i) ? 'Your seat' : 'Choose your seat'}</h1>
      <p class="muted">${esc(s.number)} · ${city(s.from)} → ${city(s.to)} · ${fmtDate(s.dep)} · ${esc(s.aircraft)} · ${esc(t.cabin)}</p>`;

    if (me && p.seatOf.me) {
      // Students don't choose: the planner has already put them next to other students (any Economy fare).
      const mine = p.seatOf.me, nb = p.neighboursOf(me), near = new Set(nb.map((x) => p.seatOf[x.id]));
      seatSel.seat = mine;
      const cell = (id) => id === mine ? seatEl(id, 'mine', id.slice(-1), '', ', your seat')
        : near.has(id) ? seatEl(id, 'stu', '★', '', ', Student · ' + uniLabel(p.at[id]))
        : p.paid.has(id) || p.at[id] ? seatEl(id, 'taken') : seatEl(id, 'free');
      return `
      <div class="narrow wide">${head}
        <div class="seat-layout">
          <div>${legend([['lg-mine', 'You'], ['lg-stu', 'Student next to you'], ['lg-taken', 'Taken'], ['lg-free', 'Free']])}${seatGrid(c, cell)}</div>
          <div class="seat-side">
            <div class="card sz-card">
              <p class="eyebrow">We've seated you in</p>
              <div class="seat-big">${mine}</div>
              ${nb.length
                ? `<p class="sm" style="margin:0">Next to ${nearText(nb)}</p>
                   ${nb.some((x) => x.shownUni && x.tag === me.tag) ? `<p class="sz-same sm">${icon('check')} Same university as you</p>` : ''}`
                : `<p class="sm" style="margin:0">No other student could be seated next to you yet. We keep trying until check-in closes.</p>`}
              <p class="muted sm" style="margin:8px 0 0">${p.students.length - 1} other students are on this flight. Names are never shown; universities only when a student chooses to share theirs.</p>
            </div>
            <div class="seat-bar"><button id="seatConfirm" class="btn btn-primary block" data-action="confirm-seat">Check in · seat ${mine}</button>
              ${studentCanPick(t, i) ? `<a class="btn btn-ghost block sm-btn" href="#/planner/${t.ref}/${i}">Economy Flex: choose a different seat</a>` : ''}</div>
          </div>
        </div>
      </div>`;
    }

    if (seatSel.key !== ref + i) { seatSel.key = ref + i; seatSel.seat = s.seat || ''; }
    const locked = seatLocked(t, i);
    const cell = (id) => id === seatSel.seat ? seatEl(id, 'mine', id.slice(-1), locked ? '' : 'pick-seat')
      : taken.has(id) ? seatEl(id, 'taken')
      : locked ? seatEl(id, 'free locked')
      : seatEl(id, 'free', id.slice(-1), 'pick-seat', ', free');
    const pp = perks(), sp = user.verified ? spLeft(pp) : 0, miles = asiaMiles();
    const bought = (pp.seatBuys || []).find((x) => x.ref === t.ref && x.i === i);
    const side = locked
      ? `<div class="card seat-lock">
          <p class="eyebrow">${icon('seat')} Economy Light</p>
          <h3>Seat selection isn't included</h3>
          <p class="muted sm">We'll assign you a seat for free, or you can unlock seat choice for this flight.</p>
          <button class="btn btn-primary block sm-btn" data-action="seat-unlock" data-with="sp" ${!user.verified || sp < PERKS.seatSp ? 'disabled' : ''}>Choose my seat · ${PERKS.seatSp.toLocaleString()} student points</button>
          <p class="muted sm unlock-note">${!user.verified ? 'Verify your student status to pay with student points.' : `You have ${sp.toLocaleString()} student points.`}</p>
          <button class="btn btn-ghost block sm-btn" data-action="seat-unlock" data-with="miles" ${miles < PERKS.seatMiles ? 'disabled' : ''}>Choose my seat · ${PERKS.seatMiles.toLocaleString()} Asia Miles</button>
          <p class="muted sm unlock-note">You have ${miles.toLocaleString()} Asia Miles.</p>
          ${t.cabin === 'Economy' && studentEligible(t) && t.studentSeat !== true ? `<p class="muted sm unlock-note">Verified student? Answer <b>Yes</b> to student seating on the trip page and we'll seat you next to students for free.</p>` : ''}
        </div>
        <div class="seat-bar">
          <button id="seatConfirm" class="btn btn-primary block" data-action="confirm-seat" ${seatSel.seat ? '' : 'disabled'}>${seatSel.seat ? 'Check in · seat ' + seatSel.seat : 'Assign a seat first'}</button>
          <button class="btn btn-ghost block sm-btn" data-action="auto-seat">Assign me a seat (free)</button>
        </div>`
      : `<div class="card sm">${bought ? `${icon('check')} Seat choice unlocked with ${bought.with === 'sp' ? 'student points' : 'Asia Miles'}. ` : `Seat selection is included with ${esc(fareName(t.cabin, s.fare || t.fare))}. `}Pick any free seat.</div>
        <div class="seat-bar">
          <button id="seatConfirm" class="btn btn-primary block" data-action="confirm-seat" ${seatSel.seat ? '' : 'disabled'}>${seatSel.seat ? 'Confirm seat ' + seatSel.seat : 'Pick a seat'}</button>
          <button class="btn btn-ghost block sm-btn" data-action="auto-seat">Assign me a seat</button>
        </div>`;
    return `
    <div class="narrow wide">${head}
      <div class="seat-layout">
        <div>${legend(locked ? [['lg-free locked', 'Free (choice locked)'], ['lg-taken', 'Taken'], ['lg-mine', 'Your seat']] : [['lg-free', 'Free'], ['lg-taken', 'Taken'], ['lg-mine', 'Your seat']])}${seatGrid(c, cell)}</div>
        <div class="seat-side">${side}</div>
      </div>
    </div>`;
  };

  /* Live, read-only view of student seating on one flight: real passengers only. Students are ★ (never a name);
   * hover shows their university only if they chose to share it. Not offered on Economy Light. */
  const planner = { key: '', log: [], moved: new Set() };
  const plannerAllowed = (t, i) => t.cabin === 'Economy' && seatRule(t.cabin, t.segments[i].fare || t.fare) !== 'paid';
  /* Economy Flex includes seat choice: a student who said yes may pick their own seat here (until check-in). */
  const studentCanPick = (t, i) => studentTrip(t) && !t.checkedIn && (t.segments[i].fare || t.fare) === 'Flex';
  views.planner = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx || 0), s = t && t.segments[i];
    if (!t || !s) return notFound();
    if (!plannerAllowed(t, i) || !studentEligible(t)) return redirect('#/trip/' + ref);
    const p = seatPlan(t, i), c = p.cabin;
    seatCtx = { t, i, p, c };
    if (planner.key !== SZ.flightKey(s)) Object.assign(planner, { key: SZ.flightKey(s), log: [], moved: new Set() });
    if (p.live) { planner.log = p.live.log.map(esc); planner.moved = new Set(p.moved.map((m) => p.seatOf[m.id])); }
    const groupOf = {};
    p.groups.forEach((g) => g.seats.forEach((id) => { groupOf[id] = g; }));
    const canPick = studentCanPick(t, i);
    const cell = (id) => {
      const x = p.at[id], moved = planner.moved.has(id) ? ' moved' : '';
      if (x) {
        const g = groupOf[id], kind = x.me ? 'mine' : g.members.length < 2 ? 'solo' : g.sameUni ? 'stu' : 'mix';
        return seatEl(id, kind + moved, x.me ? 'You' : '★', '', x.me ? ', you' : ', Student · ' + uniLabel(x), x.me ? 'You' + (x.locked ? ' · checked in' : ' · planned seat') : 'Student · ' + uniLabel(x) + (x.locked ? ' · checked in' : ''));
      }
      return p.paid.has(id) ? seatEl(id, 'taken', '', '', ', passenger') : seatEl(id, 'free', '', canPick ? 'plan-pick' : '', ', free');
    };
    const multi = p.groups.filter((g) => g.members.length > 1);
    const alone = p.students.filter((x) => p.seatOf[x.id] && !p.neighboursOf(x).length).length;
    const range = (g) => g.seats.length > 1 ? `${g.seats[0]}–${g.seats[g.seats.length - 1].slice(-1)}` : g.seats[0];
    return `
    <div class="narrow wide">
      ${backLink('#/trip/' + ref, 'Back to trip')}
      <p class="eyebrow">${p.live ? 'Live · updates as passengers book and check in' : 'This device only (offline)'}</p>
      <h1>Student seating on this flight</h1>
      <p class="muted">${esc(s.number)} · ${city(s.from)} → ${city(s.to)} · ${fmtDate(s.dep)}${t.segments.length > 1 ? ' · ' + t.segments.map((x, j) => j === i ? `<b>${x.from}→${x.to}</b>` : `<a href="#/planner/${t.ref}/${j}">${x.from}→${x.to}</a>`).join(' | ') : ''}</p>
      <div class="seat-layout">
        <div>${legend([['lg-stu', 'Students, same university'], ['lg-mix', 'Students, mixed'], ['lg-solo', 'Student alone'], ['lg-mine', 'You'], ['lg-taken', 'Other passenger'], ['lg-free', 'Free']])}${seatGrid(c, cell)}</div>
        <div class="seat-side">
          ${canPick ? `<div class="card sz-card sm"><b>${icon('seat')} Economy Flex: choose your own seat</b>
            <span class="muted">Tap any free seat to take it (students near you are shown as ★). ${s.pick ? `You chose <b>${esc(s.pick)}</b>. <button type="button" class="link-btn" data-action="plan-auto">Go back to automatic seating</button>` : 'Or keep the seat we chose for you, next to other students.'}</span></div>` : ''}
          <div class="card sm"><b>Real bookings only.</b>
            <span class="muted">Verified students who said yes are seated in groups of 2–3 side by side, from the same university when possible. Every other seat stays on sale: if another passenger chooses a seat planned for a student, only that student's group moves. Hover a ★ to see a university, if the student chose to share it.</span></div>
          <div class="card plan-stats">
            <div><b>${p.students.length}</b><span>students</span></div><div><b>${multi.length}</b><span>groups</span></div>
            <div><b>${multi.filter((g) => g.sameUni).length}</b><span>same uni</span></div><div><b>${alone}</b><span>alone</span></div>
          </div>
          <div class="card"><h3>Changes</h3>
            ${planner.log.length ? planner.log.map((l) => `<p class="sm plan-log">${l}</p>`).join('') : '<p class="muted sm">No re-seating so far.</p>'}</div>
          <div class="card"><h3>Student groups</h3>
            ${p.groups.length ? p.groups.map((g) => `<div class="sum-row sm"><span class="mono">${range(g)}</span><span>${g.members.map((m) => (m.me ? 'You' : '★')).join(' ')}</span><b>${g.members.length < 2 ? 'alone' : g.sameUni ? esc((g.members.find((m) => m.shownUni) || {}).shownUni || 'same university') : 'mixed'}</b></div>`).join('') : '<p class="muted sm">No students on this flight yet.</p>'}</div>
        </div>
      </div>
    </div>`;
  };

  function barcode(seed) {
    const r = mulberry32(hash(seed)), n = 29, c = 7;
    let out = '';
    const finder = (x, y) => x < 7 && y < 7 || x > n - 8 && y < 7 || x < 7 && y > n - 8;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let on;
      if (finder(x, y)) {
        const fx = x < 7 ? x : x - (n - 7), fy = y < 7 ? y : y - (n - 7);
        on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
      } else on = r() > 0.52;
      if (on) out += `<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}"/>`;
    }
    return `<svg viewBox="0 0 ${n * c} ${n * c}" fill="currentColor" role="img" aria-label="Demo QR code">${out}</svg>`;
  }

  views.profile = () => {
    const p = user.prefs;
    return `
    <div class="narrow">
      <h1>Settings</h1>
      ${memberCard()}
      <div class="card">
        <h3>Personal details</h3>
        <div class="sum-row"><span>Name</span><b>${esc(user.firstName)} ${esc(user.lastName)}</b></div>
        <div class="sum-row"><span>Email</span><b>${esc(user.email)}</b></div>
        <div class="sum-row"><span>Date of birth</span><b>${esc(user.dob)}</b></div>
        <div class="sum-row"><span>Member since</span><b>${esc(user.memberSince)}</b></div>
        <div class="sum-row"><span>Student status</span>${vBadge()}</div>
      </div>
      <div class="card">
        <h3>Student verification</h3>
        ${user.verified
          ? `<p class="muted" style="margin-top:0">${tick()} Verified with <b>${esc(user.verified.email)}</b>${user.verified.until ? `, valid until <b>${esc(fmtDay(user.verified.until))}</b>` : ''}.</p>
             ${verifyNotice()}
             <a class="btn btn-primary block" href="#/rewards">${icon('gift')} Student perks</a>
             <button class="btn btn-ghost block sm-btn" data-action="unverify" style="margin-top:8px">Remove my student verification</button>`
          : vStatus() === 'not_submitted'
            ? `<p class="muted" style="margin-top:0">Confirm your university email (.edu) and upload your student ID to get a green tick next to your name.</p>
               <a class="btn btn-primary block" href="#/verify">Verify student status</a>`
            : `<div class="row between"><span class="muted sm">${esc((sv && sv.explanation) || '')}</span></div>${verifyNotice()}
               <a class="btn btn-primary block" href="#/verify">${vStatus() === 'pending_review' ? 'See verification' : 'Continue verification'}</a>`}
      </div>
      ${user.moderator ? `<a class="btn btn-ghost block" href="#/moderation">${icon('info')} Chat reports (moderator)</a>` : ''}
      ${user.reviewer ? `<a class="btn btn-ghost block" href="#/review">${icon('shield')} Student verification queue (verification team)</a>` : ''}
      <form id="prefsForm" class="card form">
        <h3>Travel preferences</h3>
        <div class="two">
          <label class="field"><span>Seat</span><select name="seat">${['Window', 'Aisle', 'No preference'].map((o) => `<option ${o === p.seat ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
          <label class="field"><span>Meal</span><select name="meal">${['Standard', 'Vegetarian', 'Vegan', 'Halal', 'Kosher'].map((o) => `<option ${o === p.meal ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="notifications" ${p.notifications ? 'checked' : ''}> Flight alerts & offers</label>
        <button class="btn btn-ghost block" type="submit">Save preferences</button>
      </form>
      <div class="stack">
        <button class="btn btn-ghost block" data-action="signout">${icon('logout')} Sign out</button>
        <button class="btn btn-ghost block sm-btn" data-action="reset-demo">Clear my bookings and perks</button>
      </div>
    </div>`;
  };

  /* ---------- student verification journey: 1 university email → 2 student ID → 3 review → 4 verified ----------
   * The server (student-verify.js) owns the status; this page only shows it and collects the upload. */
  const V_LABEL = { not_submitted: 'Not submitted', awaiting_document: 'Awaiting document upload', pending_review: 'Pending review', verified: 'Verified', rejected: 'Rejected — additional information required', expired: 'Expired — re-verification required' };
  const V_TONE = { not_submitted: 'muted', awaiting_document: 'warn', pending_review: 'warn', verified: 'ok', rejected: 'bad', expired: 'bad' };
  const vStatus = () => (!user ? 'not_submitted' : !liveAccount() ? (user.verified ? 'verified' : 'not_submitted') : (sv && sv.status) || (user.student && user.student.status) || 'not_submitted');
  const vBadge = (st = vStatus()) => `<span class="badge ${V_TONE[st]}">${esc(V_LABEL[st])}</span>`;
  const fmtDay = (d) => (d ? fmtDate(d + 'T12:00', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const ACCEPT = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'application/pdf': 'PDF' };

  function vStepper(cur) {
    const steps = ['University email', 'Student ID', 'Review', 'Verified'];
    return `<ol class="vf-steps" aria-label="Verification progress">${steps.map((s, i) => `<li class="${i + 1 < cur ? 'done' : i + 1 === cur ? 'on' : ''}"${i + 1 === cur ? ' aria-current="step"' : ''}><span class="n">${i + 1 < cur ? icon('check') : i + 1}</span><span class="t">${s}</span></li>`).join('')}</ol>`;
  }
  /* A file picked for upload: kept in memory (never in localStorage) until it is sent. */
  function vPick(slot, file) {
    const old = vs.files[slot];
    if (old && old.url) URL.revokeObjectURL(old.url);
    delete vs.files[slot]; vs.msg = '';
    if (!file) return render();
    const type = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' }[String(file.name).split('.').pop().toLowerCase()] || '');
    if (!ACCEPT[type]) { vs.msg = `“${file.name}” isn't a JPG, PNG or PDF. ${/hei[cf]/i.test(file.name) ? 'On iPhone, take a screenshot of the photo or choose “Most Compatible” in camera settings.' : 'Choose a photo, screenshot or PDF.'}`; return render(); }
    if (file.size > 5 * 1048576) { vs.msg = `That file is ${kb(file.size)}. The limit is 5 MB: take a new photo or save it at a smaller size.`; return render(); }
    const f = vs.files[slot] = { file, type, url: URL.createObjectURL(file), warn: '' };
    if (type !== 'application/pdf') {
      const img = new Image();
      img.onload = () => { if (Math.min(img.naturalWidth, img.naturalHeight) < 600) { f.warn = 'This image is quite small and may be hard to read. If you can, take a closer photo in good light.'; render(); } };
      img.src = f.url;
    }
    render();
  }
  function vDrop(slot, title, hint) {
    const f = vs.files[slot];
    if (f) {
      const pv = f.type === 'application/pdf'
        ? `<object class="vf-pdf" data="${f.url}#toolbar=0" type="application/pdf" aria-label="PDF preview"><p class="muted sm">${icon('ticket')} PDF ready to send. Preview isn't available in this browser.</p></object>`
        : `<img class="vf-img" src="${f.url}" alt="Preview of your ${esc(title.toLowerCase())}">`;
      return `<div class="vf-file"><div class="vf-prev">${pv}</div>
        <div class="row between vf-meta"><span class="sm"><b>${esc(f.file.name)}</b><br><span class="muted">${ACCEPT[f.type]} · ${kb(f.file.size)}</span></span>
          <span class="row gap-sm"><label class="btn btn-ghost sm-btn">Replace<input type="file" class="vf-input" data-slot="${slot}" accept="image/jpeg,image/png,application/pdf" hidden></label>
          <button type="button" class="btn btn-ghost sm-btn" data-action="vf-remove" data-slot="${slot}">Remove</button></span></div>
        ${f.warn ? `<p class="vf-warn sm">${icon('alert')} ${esc(f.warn)}</p>` : ''}</div>`;
    }
    return `<div class="vf-drop" data-slot="${slot}">
      ${icon(slot === 'id' ? 'ticket' : 'info', 'big')}<b>${esc(title)}</b><span class="muted sm">${hint}</span>
      <div class="row gap-sm vf-btns"><label class="btn btn-primary sm-btn">Choose file<input type="file" class="vf-input" data-slot="${slot}" accept="image/jpeg,image/png,application/pdf" hidden></label>
      <label class="btn btn-ghost sm-btn">${icon('sparkle')} Take a photo<input type="file" class="vf-input" data-slot="${slot}" accept="image/*" capture="environment" hidden></label></div>
      <span class="muted xs">JPG, PNG or PDF · up to 5 MB</span></div>`;
  }
  function vDocStep(head) {
    const fm = vs.form, noExp = fm.noExpiry;
    return `${head}
      <section class="card vf-why"><h3>${icon('shield')} Why we ask for your student ID</h3>
        <p class="muted sm">Your university email shows you can use a university mailbox. Your student ID shows that this account belongs to a <b>currently enrolled</b> student, on the dates you fly. We use it only to check eligibility and <b>delete it as soon as it has been checked</b>: we keep just the result and the date your student status is valid until.</p></section>
      <form id="verifyDocForm" class="card form" novalidate>
        <h3>Upload your student ID</h3>
        <div class="vf-need"><p class="sm"><b>Make sure we can read:</b></p>
          <ul class="vf-list sm">
            <li>${icon('check')}<span>Your <b>full name</b></span></li><li>${icon('check')}<span>Your <b>university or institution</b></span></li>
            <li>${icon('check')}<span>The <b>expiry or “valid until” date</b>, if your card has one</span></li><li>${icon('check')}<span>Your <b>photo</b>, if your card has one</span></li>
          </ul>
          <p class="muted xs">The whole card, in focus, without glare. A screenshot of a digital student ID is fine. You can cover your student ID number: we don't need it. Please don't upload a passport or other ID.</p></div>
        ${vDrop('id', 'Student ID', 'Front of your card, or a screenshot from your university app')}
        <div class="two">
          <label class="field"><span>Full name as shown</span><input name="fullName" class="vf-in" value="${esc(fm.fullName)}" autocomplete="name" required></label>
          <label class="field"><span>University or institution</span><input name="institution" class="vf-in" value="${esc(fm.institution)}" required></label>
        </div>
        <label class="field"><span>Expiry or “valid until” date</span><input type="date" name="expiry" class="vf-in" value="${esc(fm.expiry)}" ${noExp ? 'disabled' : ''}></label>
        <label class="check sm"><input type="checkbox" name="noExpiry" class="vf-in" ${noExp ? 'checked' : ''}> My card doesn't show an expiry date</label>
        ${noExp ? `<div class="vf-alt"><p class="sm" style="margin:0 0 8px"><b>No expiry date? No problem.</b> Add proof that you're enrolled this academic year: an <b>enrolment letter</b> or an <b>official digital student-status record</b> (e.g. a certificate from your student portal). It's optional, but it speeds up the review. Without it, our team checks your card and sets your student status until the end of the academic year.</p>
          ${vDrop('proof', 'Proof of current enrolment (optional)', 'Enrolment letter or official student-status record, issued this academic year')}</div>` : ''}
        ${vs.msg ? `<p class="err" role="alert">${esc(vs.msg)}</p>` : ''}
        <p class="muted sm vf-review-note">${icon('clock')} Most documents need a quick check by our verification team, usually within 1–2 working days. We'll show the result here.</p>
        <button class="btn btn-primary block" type="submit" ${vs.busy ? 'disabled' : ''}>${vs.busy ? 'Uploading securely…' : 'Submit for verification'}</button>
      </form>
      <p class="muted xs">Your document is encrypted and stored privately. Only Cathay's trained verification team can open it; other passengers and students never see it. Every access is logged.</p>`;
  }
  function vEmailStep(back, cur, note = '') {
    const err = vs.msg ? `<p class="err" role="alert">${esc(vs.msg)}</p>` : '';
    if (vs.step === 'code') {
      return `<div class="narrow vf-page">${back}${vStepper(cur)}
        <h1>Enter your code</h1>
        <p class="muted">We sent a 6-digit code to <b>${esc(vs.email)}</b>. It expires in 10 minutes.</p>
        ${vs.demo ? `<div class="card demo-note"><b>Demo mode:</b> no email server is connected, so your code is shown here.<div class="demo-code mono">${esc(vs.demoCode)}</div></div>` : ''}
        <form id="verifyCodeForm" class="card form" autocomplete="off">
          <label class="field"><span>6-digit code</span><input name="code" class="code-input mono" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" required autofocus></label>
          ${err}
          <button class="btn btn-primary block" type="submit">Verify email</button>
          <div class="two"><button class="btn btn-ghost" type="button" data-action="verify-resend">Resend code</button>
          <button class="btn btn-ghost" type="button" data-action="verify-change">Change email</button></div>
        </form></div>`;
    }
    return `<div class="narrow vf-page">${back}${vStepper(cur)}
      <h1>Verify student status</h1>
      ${note}
      ${user.invitedBy ? `<div class="sz-choice yes"><span>${icon('share')} A friend invited you (${esc(user.invitedBy)}). When you book your first flight you both get a bonus, and as a verified student yours comes as student points (¼ of the flight's student points).</span></div>` : ''}
      <p class="muted">Two quick steps: confirm your <b>university email</b> with a one-time code, then upload your <b>student ID</b>. Any address whose domain includes <b>.edu</b> works (e.g. <span class="mono">name@uni.edu</span>, <span class="mono">name@uni.edu.hk</span>).</p>
      <form id="verifyEmailForm" class="card form" novalidate>
        <label class="field"><span>University email</span><input type="email" name="email" placeholder="name@university.edu" value="${esc(vs.email || (sv && sv.email) || '')}" required autocomplete="email"></label>
        ${err}
        <button class="btn btn-primary block" type="submit">Send code</button>
      </form>
      <p class="muted sm">Your address is used only to send the code and to check that you study at that institution.</p>
    </div>`;
  }
  /* The status box shown at the top of the journey: what it means and what to do next. */
  const vStatusBox = (v, extra = '') => `<div class="card vf-status ${V_TONE[v.status]}"><div class="row between"><b>Status</b>${vBadge(v.status)}</div>
    <p class="sm" style="margin:8px 0 4px">${esc(v.explanation || '')}</p>
    ${(v.nextSteps || []).length ? `<ul class="vf-next sm">${v.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}${extra}</div>`;

  views.verify = () => {
    const back = vs.returnTo ? backLink(vs.returnTo, 'Back') : backLink('#/profile', 'Settings');
    if (!liveAccount()) return vOffline(back);
    if (!sv) { fetchVerification(true); return `<div class="narrow vf-page">${back}<div class="card empty">Loading your verification status…</div></div>`; }
    const st = sv.status;
    if (st === 'not_submitted' || vs.step === 'code' || (sv.needsEmail && vs.step !== 'doc')) {
      const note = sv.needsEmail ? `<div class="card vf-status warn sm">${icon('info')} Your university email was last confirmed over a year ago. Confirm it again, then upload a current document.</div>` : '';
      return vEmailStep(back, 1, note);
    }
    const head = `<div class="narrow vf-page">${back}${vStepper(2)}<h1>${st === 'expired' ? 'Re-verify your student status' : 'Upload your student ID'}</h1>
      <p class="muted">${icon('check')} University email verified: <b>${esc(sv.email)}</b>${sv.institution ? ` · ${esc(sv.institution.name)}` : ''}</p>`;
    if (st === 'pending_review' && !vs.replace) {
      const s = sv.submission || { documents: [], notices: [] };
      return `<div class="narrow vf-page">${back}${vStepper(3)}<h1>We're checking your document</h1>
        ${vStatusBox(sv)}
        <div class="card"><h3>What you sent</h3>
          ${s.documents.map((d) => `<div class="sum-row"><span>${d.role === 'student_id' ? 'Student ID' : 'Proof of enrolment'}</span><b class="sm">${esc(d.name)} · ${ACCEPT[d.mime] || ''} · ${kb(d.bytes)}</b></div>`).join('')}
          <div class="sum-row"><span>Name on document</span><b>${esc(s.declared && s.declared.fullName)}</b></div>
          <div class="sum-row"><span>Valid until</span><b>${s.declared && s.declared.expiry ? fmtDay(s.declared.expiry) : 'No expiry date on card'}</b></div>
          <div class="sum-row"><span>Sent</span><b>${s.submittedAt ? fmtDate(s.submittedAt) : ''}</b></div>
          ${s.notices.length ? `<div class="vf-warn sm">${icon('alert')} <span><b>Our team will look closely at:</b> ${s.notices.map(esc).join(' · ')}. If you sent the wrong file or a blurry photo, replace it now to avoid a delay.</span></div>` : ''}
          <div class="two" style="margin-top:12px"><button class="btn btn-ghost" data-action="vf-replace">Replace document</button><button class="btn btn-ghost" data-action="vf-withdraw">Remove document</button></div></div>
        <a class="btn btn-primary block" href="${vs.returnTo || '#/home'}">Done</a></div>`;
    }
    if (st === 'verified' && !vs.replace) {
      const notCovered = sv.flightsNotCovered || [];
      return `<div class="narrow vf-page">${back}${vStepper(5)}
        <div class="card verify-done">${tick('tick-xl')}<h1>You're a verified student</h1>
          <p class="muted">${esc(user.firstName)} ${esc(user.lastName)} · ${esc(sv.institution ? sv.institution.name : '')}<br>Student features are unlocked until <b>${fmtDay(sv.validUntil)}</b>.</p>
          ${sv.expiresSoon ? `<p class="vf-warn sm">${icon('alert')} Your verification ends in ${sv.daysLeft} day${sv.daysLeft === 1 ? '' : 's'}. Re-verify now to keep student seating, chat and perks.</p>` : ''}
          ${notCovered.length ? `<p class="vf-warn sm">${icon('alert')} Your verification ends before your flight${notCovered.length > 1 ? 's' : ''} on ${notCovered.map(fmtDay).join(', ')}. Re-verify with a document valid on that date to use student features on ${notCovered.length > 1 ? 'them' : 'it'}.</p>` : ''}
          ${sv.expiresSoon || notCovered.length ? '<button class="btn btn-ghost block" data-action="vf-replace">Re-verify now</button>' : ''}
          <a class="btn btn-primary block" href="${vs.returnTo || '#/home'}">${vs.returnTo ? 'Continue' : 'Back to home'}</a></div></div>`;
    }
    if (!vs.form.init) vs.form = { init: true, fullName: `${user.firstName} ${user.lastName}`, institution: (sv.institution && sv.institution.name) || '', expiry: '', noExpiry: false };
    let top = '';
    if (st === 'rejected' && sv.rejection) top = vStatusBox(sv, `<div class="vf-reason sm"><b>Why:</b> ${esc(sv.rejection.reason)}${sv.rejection.message ? `<br><b>Note from our team:</b> ${esc(sv.rejection.message)}` : ''}</div>`);
    else if (st === 'expired' || st === 'awaiting_document') top = vStatusBox(sv);
    else if (st === 'pending_review') top = `<div class="card vf-status warn sm">Your new document replaces the one we're reviewing.</div>`;
    else if (st === 'verified') top = `<div class="card vf-status ok sm">You stay verified until ${fmtDay(sv.validUntil)} while we check your new document.</div>`;
    return vDocStep(head + top) + (vs.replace ? '<button class="btn btn-ghost block" data-action="vf-cancel-replace">Cancel</button>' : '') + '</div>';
  };

  /* Without the server (static hosting) documents can't be checked securely: simulate, clearly labelled. */
  function vOffline(back) {
    if (user.verified) {
      return `<div class="narrow vf-page">${back}${vStepper(5)}<div class="card verify-done">${tick('tick-xl')}<h1>Verified (offline demo)</h1>
        <p class="muted">Simulated on this device until ${fmtDay(user.verified.until)}. Real verification needs the Cathay server.</p>
        <a class="btn btn-primary block" href="${vs.returnTo || '#/home'}">Continue</a></div></div>`;
    }
    if (vs.step !== 'doc') return vEmailStep(back, 1);
    return `<div class="narrow vf-page">${back}${vStepper(2)}<h1>Upload your student ID</h1>
      <div class="card demo-note"><b>Offline demo.</b> Student ID checks run on the Cathay verification server, which isn't connected here, so nothing can be uploaded or verified for real. You can simulate an approval on this device to explore student features.</div>
      <button class="btn btn-primary block" data-action="vf-simulate">Simulate approval (offline demo only)</button></div>`;
  }

  async function fetchVerification(rerenderAfter) {
    if (!liveAccount() || fetchVerification.busy) return;
    fetchVerification.busy = true;
    const r = await authCall('GET', '/student/status');
    fetchVerification.busy = false; fetchVerification.at = Date.now();
    if (r.status === 401) return signOutLocal('Please sign in again.');
    if (!r.ok) { if (!sv) sv = { status: (user.student && user.student.status) || 'not_submitted', explanation: r.error || 'Could not load your verification status.' }; }
    else applyVerification(r.verification);
    if (rerenderAfter) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }
  /* The server's verdict is the only source of "verified": update the local copy (display cache) from it. */
  function applyVerification(v) {
    sv = v;
    if (user.student) user.student.status = v.status;
    const was = Boolean(user.verified);
    const now = v.active ? { email: v.email, at: v.verifiedAt, until: v.validUntil, institution: v.institution && v.institution.name } : null;
    store.set('verified', now, true); user.verified = now; user.tier = now ? 'Student' : 'Member';
    if (now && !was) grantWelcome();
  }
  function grantWelcome() {
    const p = perks();
    if (p.welcome) return;
    p.welcome = PERKS.welcome; p.welcomeAt = toISO(new Date()); savePerks(p);
    toast(`Student status verified · +${PERKS.welcome.toLocaleString()} welcome points`);
  }
  const readB64 = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => bad(r.error); r.readAsDataURL(file); });
  async function submitDocuments() {
    if (vs.busy) return;
    const fm = vs.form, id = vs.files.id;
    vs.msg = '';
    if (!id) vs.msg = 'Add a photo, screenshot or PDF of your student ID.';
    else if (String(fm.fullName).trim().length < 2) vs.msg = 'Enter your full name as it appears on the document.';
    else if (String(fm.institution).trim().length < 2) vs.msg = 'Enter the university or institution shown on the document.';
    else if (!fm.noExpiry && !fm.expiry) vs.msg = "Enter the expiry or 'valid until' date, or tick 'My card doesn't show an expiry date'.";
    if (vs.msg) return render();
    vs.busy = true; render();
    try {
      const documents = [{ role: 'student_id', mime: id.type, name: id.file.name, data: await readB64(id.file) }];
      if (fm.noExpiry && vs.files.proof) documents.push({ role: 'enrolment_proof', mime: vs.files.proof.type, name: vs.files.proof.file.name, data: await readB64(vs.files.proof.file) });
      const r = await authCall('POST', '/student/submission', { declared: { fullName: fm.fullName, institution: fm.institution, expiry: fm.noExpiry ? null : fm.expiry, noExpiry: Boolean(fm.noExpiry) }, documents });
      vs.busy = false;
      if (!r.ok) { vs.msg = r.error || 'Upload failed. Try again.'; if (r.needsEmail) { vs.step = 'email'; await fetchVerification(); } return render(); }
      Object.values(vs.files).forEach((f) => f.url && URL.revokeObjectURL(f.url)); vs.files = {}; vs.replace = false;
      applyVerification(r.view);
      toast(r.view.status === 'verified' ? 'Verified' : 'Document sent for review');
      window.scrollTo(0, 0); render();
    } catch { vs.busy = false; vs.msg = 'We could not read that file. Try choosing it again.'; render(); }
  }

  const TOOLS = [
    ['Travel essentials', [['ticket', 'Boarding pass', '#/trips'], ['info', 'Travel information'], ['calendar', 'Flight timetable', '#/timetable'], ['clock', 'Flight status', '#/status'], ['refund', 'Rebook and refund', '#/trips'], ['calc', 'Baggage calculator', '#/baggage'], ['alert', 'Delays and cancellations', '#/status']]],
    ['Prepare your trip', [['hotel', 'Book a hotel'], ['plane', 'Book a package'], ['shield', 'Travel insurance'], ['car', 'Rent a car'], ['ticket', 'Book activities'], ['bag', 'Shop curated picks']]],
    ['Flying with us', [['seat', 'Cabin classes'], ['tv', 'Inflight experience'], ['lounge', 'Lounges'], ['pin', 'Airport information'], ['plane', 'Aircraft and fleet'], ['heart', 'Passenger assistance']]],
    ['Travel inspiration', [['pin', 'Where we fly', '#/book'], ['bulb', 'Inspiration'], ['tag', 'Discover the best fares', '#/book']]],
  ];
  views.tools = () => `
    <div class="narrow wide"><h1>Travel tools</h1>
      ${TOOLS.map(([title, items]) => `<h2>${title}</h2><div class="tools">${items.map(([ic, label, to]) =>
        to ? `<a class="tool" href="${to}">${icon(ic)}<span>${label}</span></a>`
           : `<button class="tool" data-action="soon" data-label="${esc(label)}">${icon(ic)}<span>${label}</span></button>`).join('')}</div>`).join('')}
    </div>`;

  views.timetable = () => `
    <div class="narrow">${backLink('#/tools', 'Travel tools')}<h1>Flight timetable</h1>
      <form id="timetableForm" class="card form">
        <div class="two"><label class="field"><span>From</span><select name="from">${airportOptions('HKG')}</select></label>
        <label class="field"><span>To</span><select name="to">${airportOptions('SIN')}</select></label></div>
        <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}"></label>
        <button class="btn btn-primary block" type="submit">Show timetable</button></form>
      <div id="timetableOut" class="stack"></div></div>`;

  views.status = () => `
    <div class="narrow">${backLink('#/tools', 'Travel tools')}<h1>Flight status</h1>
      <form id="statusForm" class="card form">
        <label class="field"><span>Flight number</span><input name="num" placeholder="e.g. CX 751" required value="${upcoming()[0] ? esc(upcoming()[0].segments[0].number) : ''}"></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}"></label>
        <button class="btn btn-primary block" type="submit">Check status</button></form>
      <div id="statusOut"></div></div>`;

  views.baggage = () => `
    <div class="narrow">${backLink('#/tools', 'Travel tools')}<h1>Baggage calculator</h1>
      <form id="baggageForm" class="card form">
        <label class="field"><span>Cabin</span><select name="cabin">${CABINS.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <div class="two"><label class="field"><span>Bags you plan to check</span><input type="number" name="bags" min="0" max="8" value="1"></label>
        <label class="field"><span>Weight per bag (kg)</span><input type="number" name="kg" min="1" max="45" value="26"></label></div>
        <div id="baggageOut"></div></form></div>`;

  views.retrieve = () => `
    <div class="narrow">
      <h1>Retrieve booking</h1>
      <p class="muted">To check in, get boarding passes and manage flights.</p>
      ${user ? '' : `<a class="btn btn-ghost block" href="#/signin">Member sign-in</a>`}
      <form id="retrieveForm" class="card form">
        <h3>Find a booking</h3>
        <label class="field"><span>Family name</span><input name="last" required></label>
        <label class="field"><span>Booking reference</span><input name="ref" required maxlength="6" class="mono" placeholder="e.g. ABC123"></label>
        <p id="retrieveErr" class="err" hidden></p>
        <button class="btn btn-primary block" type="submit">Continue</button>
      </form>

    </div>`;

  views.signin = () => `
    <div class="signin">
      <div class="signin-brand"><h1>Cathay</h1><p>Book flights, manage your trips and earn Asia Miles.</p></div>
      <div class="narrow">
        <h1 class="mob-only">Sign in</h1>
        <form id="signinForm" class="card form">
          <label class="field"><span>Email or member number</span><input name="email" autocomplete="username" required></label>
          <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          <p id="signinErr" class="err" hidden></p>
          <button class="btn btn-primary block" type="submit">Sign in</button>
          <a class="btn btn-ghost block" href="#/signup">Create an account</a>
        </form>
        ${!LIVE.on ? '<p class="muted sm center">Offline mode: accounts are stored in this browser only.</p>' : ''}
      </div></div>`;

  views.signup = () => {
    if (user) return redirect('#/home');
    const invite = store.get('invite', '');
    return `
    <div class="signin">
      <div class="signin-brand"><h1>Join Cathay</h1><p>A free membership: book flights, check in online and earn Asia Miles.</p></div>
      <div class="narrow">
        <h1 class="mob-only">Create an account</h1>
        <form id="signupForm" class="card form">
          ${invite ? `<div class="sz-choice yes"><span>${icon('share')} Invited by a friend (${esc(invite)}). Book your first flight and you both get a bonus. <button type="button" class="link-btn" data-action="invite-info" data-who="invited">How it works</button></span></div>` : ''}
          <div class="two">
            <label class="field"><span>Given name</span><input name="firstName" autocomplete="given-name" maxlength="30" required></label>
            <label class="field"><span>Family name</span><input name="lastName" autocomplete="family-name" maxlength="40" required></label>
          </div>
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
          <label class="field"><span>Password (8+ characters)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Date of birth</span><input type="date" name="dob" max="${todayStr()}" required></label>
          <input type="hidden" name="invite" value="${esc(invite)}">
          <p id="signupErr" class="err" hidden></p>
          <button class="btn btn-primary block" type="submit">Create account</button>
          <a class="btn btn-ghost block" href="#/signin">I already have an account</a>
        </form>
        <p class="muted sm center">University student? You can verify your student status after signing up.${!LIVE.on ? ' Offline mode: this account is stored in this browser only.' : ''}</p>
      </div></div>`;
  };

  /* Student perks section of the Points & rewards page. */
  function perksBody() {
    if (!user.verified) return studentGate(toISO(new Date()));
    const p = perks(), m = perkMiles(p);
    fetchRefs();
    const country = studyCountry(), plug = SZ.countryPlug(country), at = adapterTrip(p), claimed = adapterClaimed(p);
    const adapterRow = (t, right) => `<div class="perk-row"><div><b>${esc(city(t.segments[0].from))} → ${esc(city(t.segments[0].to))}</b><div class="muted sm">${fmtDate(t.segments[0].dep, { day: 'numeric', month: 'short', year: 'numeric' })} · Type ${esc(plug)}</div></div>${right}</div>`;
    const adapter = !country ? '<p class="muted sm">We couldn\'t tell your university\'s country from your email.</p>'
      : claimed ? adapterRow(at, '<span class="badge ok">Claimed · collect on board</span>')
      : at ? adapterRow(at, `<button class="btn btn-primary sm-btn" data-action="claim-adapter" data-ref="${at.ref}">Claim free</button>`)
      : `<p class="muted sm">It will appear here when you book your first flight to ${esc(countryName(country))}.</p>`;
    const boost = gradBoostUntil(p), nextTier = SZ.tierUp(user.tier);
    const gradMonth = p.gradMonth || (user.verified.until || '').slice(0, 7);
    return `
    <div class="perks-body">
      <div class="sect-head"><h3>Student perks</h3>${verifiedLabel()}</div>
      <p class="muted sm">Unlocked by your verified student membership. No promo codes.</p>
      <div class="card balances">
        <div><span class="eyebrow">Student points</span><b class="sp">${spLeft(p).toLocaleString()}</b>
          <p class="muted sm">Earned on flights (${PERKS.spRate}× the miles), campus and partners while you study. Spend them on student rewards; ${Math.round(PERKS.spConvert * 100)}% of what's left becomes Asia Miles when you graduate.</p></div>
        <div><span class="eyebrow">Asia Miles</span><b>${asiaMiles().toLocaleString()}</b>
          <p class="muted sm">Usable now: invites, the graduation gift and miles from before you joined${m.pending ? ` (+${m.pending.toLocaleString()} pending)` : ''}.</p></div>
      </div>

      <div class="card perk">
        <div class="perk-head">${icon('plug')}<div><h3>Free travel adapter</h3><p class="muted sm">${country ? `New to ${esc(countryName(country))}? Get a free Type ${esc(plug)} adapter on your first flight there, handed to you on board by the crew.` : 'A free adapter for your university\'s country, handed to you on board.'} Once per study programme.</p></div></div>
        ${adapter}
      </div>

      ${inviteCard()}

      <div class="card perk">
        <div class="perk-head">${icon('tag')}<div><h3>Student points</h3><p class="muted sm">Your flights earn ${PERKS.spRate} student points for every Asia Mile a normal member would earn (instead of miles). Spend them on student rewards now; when you graduate, ${Math.round(PERKS.spConvert * 100)}% of what's left becomes Asia Miles and the rest expires.</p></div></div>
        ${p.graduated
          ? `<div class="sp-row"><div><b>${(p.gradPoints || 0).toLocaleString()}</b><span>student points left</span></div>${icon('arrow')}<div><b>${(p.gradConverted || 0).toLocaleString()}</b><span>Asia Miles credited</span></div></div>`
          : `<div class="sp-row"><div><b>${spLeft(p).toLocaleString()}</b><span>student points</span></div>${icon('arrow')}<div><b>${spConverted(spLeft(p)).toLocaleString()}</b><span>Asia Miles at graduation</span></div></div>
             <h3 class="rw-title">Spend your points</h3>
             <p class="muted sm" style="margin:0">Also available on each Economy trip page, under <b>Pay with student points</b>.</p>
             ${REWARDS.map((rw) => `<div class="perk-row reward">
               <div class="rw-info">${icon(rw.icon)}<div><b>${rw.name}</b> <span class="rw-pts">${rw.pts.toLocaleString()} pts</span><div class="muted sm">${rw.note}</div></div></div>
               <form class="rw-form" data-reward="${rw.id}">
                 <select name="ref" aria-label="Trip for ${rw.name}">${upcoming().filter((t) => t.cabin === 'Economy').map((t) => {
                   const used = (p.redeemed || []).some((r) => r.id === rw.id && r.ref === t.ref);
                   return `<option value="${t.ref}" ${used ? 'disabled' : ''}>${esc(tripLabel(t))} · ${fmtDate(t.segments[0].dep, { day: 'numeric', month: 'short' })}${used ? ' · added' : ''}</option>`;
                 }).join('')}</select>
                 <button class="btn btn-primary sm-btn" type="submit" ${spLeft(p) < rw.pts ? 'disabled' : ''}>Use</button>
               </form></div>`).join('')}
             ${(p.redeemed || []).length ? `<p class="muted sm">Added: ${p.redeemed.map((r) => `${esc(rewardName(r.id))} (${esc(r.ref)})`).join(', ')}</p>` : ''}`}
      </div>

      <div class="card perk concept">
        <div class="perk-head">${icon('tag')}<div><h3>Cathay Student card <span class="badge">Concept</span></h3><p class="muted sm">Proposed with Cathay's card partner: a student account and card with no income requirement for verified full-time students, earning student points on everyday spending (not just flights), with low limits and a debit option. It upgrades to the regular Cathay card at graduation. Not available: shown to illustrate the idea.</p></div></div>
      </div>

      <div class="card perk">
        <div class="perk-head">${icon('cap')}<div><h3>Graduation gift</h3><p class="muted sm">When you graduate, we celebrate with you.</p></div></div>
        ${p.graduated
          ? `<div class="sz-choice yes"><span>Congratulations, graduate!</span></div>
             <ul class="perk-list"><li>${icon('check')} ${esc(nextTier)} status ${boost ? `until ${fmtDate(toISO(boost), { day: 'numeric', month: 'short', year: 'numeric' })}` : '(ended)'}</li>
             <li>${icon('check')} ${PERKS.gradMiles.toLocaleString()} bonus miles credited</li>
             <li>${icon('check')} ${(p.gradConverted || 0).toLocaleString()} Asia Miles from your student points</li></ul>
             <button class="btn btn-ghost block sm-btn" data-action="grad-undo">Undo graduation (demo)</button>`
          : `<ul class="perk-list"><li>${icon('check')} ${esc(nextTier)} status for ${PERKS.boostMonths} months (one tier up)</li>
             <li>${icon('check')} ${PERKS.gradMiles.toLocaleString()} bonus miles</li>
             <li>${icon('check')} ${Math.round(PERKS.spConvert * 100)}% of your student points converted to Asia Miles</li></ul>
             <form id="gradForm" class="row gap-sm grad-form">
               <label class="field"><span>Expected graduation</span><input type="month" name="grad" value="${esc(gradMonth)}" required></label>
               <button class="btn btn-ghost sm-btn" type="submit">Save</button>
             </form>
             ${gradMonth ? `<p class="muted sm">Your gift unlocks when you graduate in ${fmtDate(gradMonth + '-01T12:00', { month: 'long', year: 'numeric' })}.</p>` : ''}
             <button class="btn btn-primary block sm-btn" data-action="grad-demo">Simulate graduation (demo)</button>`}
      </div>
    </div>`;
  };

  views.perks = () => redirect('#/rewards');

  /* Invite link: remember the code for sign-up. */
  views.r = (code) => {
    store.set('invite', String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20));
    if (user) { toast('Invite links are for new members.'); return redirect('#/home'); }
    setTimeout(() => inviteInfo('invited'), 400); // explain the benefit to the invited friend
    return redirect('#/signup');
  };

  /* ---------- flight chat (transports live in chat.js) ---------- */
  /* ---------- student flight chat (chat-server.js enforces every rule server-side) ---------- */
  let chatConn = null;
  function chatLeave() { if (chatConn) { chatConn.close(); chatConn = null; } }
  const REPORT_REASONS = [['harassment', 'Harassment'], ['sexual', 'Sexual advances or content'], ['discrimination', 'Discrimination or hate'], ['bullying', 'Bullying'], ['threat', 'Threats or violence'], ['impersonation', 'Impersonation'], ['doxxing', 'Sharing personal information'], ['spam', 'Spam'], ['solicitation', 'Unwanted selling or solicitation'], ['other', 'Something else']];
  const GUIDELINES = [
    'Be respectful. No harassment, bullying, threats or discrimination of any kind.',
    'No sexual comments or advances.',
    "Don't pretend to be someone else, and don't share anyone's personal information (yours included: no phone numbers, addresses or seat numbers).",
    'No spam, selling or recruiting.',
    'Group conversation only: there are no private messages.',
    'Two-strike rule: a first confirmed violation gives you a warning; a second cancels your booking on this flight with no refund.',
  ];

  // One room per flight and day, open 7 days before departure to verified students (18+) booked on that flight.
  views.chat = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx) || 0, s = t && t.segments[i];
    if (!s) return notFound();
    return `<div class="narrow fc-page">
      ${backLink('#/trip/' + t.ref, 'Back to booking')}
      <section class="card fc" id="fcBox" data-fid="${esc(liveId(s))}">
        <header class="fc-head">
          <div><p class="lab">Student flight chat</p><h1>${esc(s.number)} · ${esc(s.from)} → ${esc(s.to)}</h1><p class="muted sm">${esc(fmtDate(s.dep))} · group chat for verified students on this flight</p></div>
          <span class="fc-stat" id="fcStat" data-state="connecting">Checking…</span>
        </header>
        <div id="fcGate"></div>
        <div class="fc-log" id="fcLog" role="log" aria-label="Flight chat messages" hidden></div>
        <form class="fc-compose" id="fcForm" autocomplete="off" hidden><input id="fcInput" maxlength="500" placeholder="Message the students on your flight…" aria-label="Message" enterkeyhint="send"><button class="btn btn-primary" type="submit">Send</button></form>
        <p class="fc-foot sm muted" id="fcFoot" hidden>Visible to verified students on this flight: your first name${t.showUni ? ' and university' : ''}. <a href="#/chat-safety">Safety &amp; privacy</a> · <button type="button" class="fc-link" id="fcLeave">Leave chat</button></p>
      </section></div>`;
  };

  // Everything the network supplies goes in through textContent, never innerHTML.
  async function mountChat() {
    const box = $('#fcBox');
    if (!box) return;
    const fid = box.dataset.fid, gate = $('#fcGate'), log = $('#fcLog'), stat = $('#fcStat'), form = $('#fcForm'), input = $('#fcInput');
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const setStat = (state, label) => { stat.dataset.state = state; stat.textContent = label; };
    if (!liveAccount()) {
      setStat('error', 'Unavailable');
      gate.innerHTML = '<div class="fc-note">The student chat needs an online account (it runs on the Cathay server).</div>';
      return;
    }
    const st = await authCall('GET', `/chat/${fid}/status`);
    if (!$('#fcBox')) return;
    if (!st.ok || !st.eligible) {
      setStat('error', 'Not available');
      gate.innerHTML = `<div class="fc-note">${esc(st.reason || st.error || 'The chat is not available.')}</div>${!user.verified ? '<a class="btn btn-primary" href="#/verify">Verify my student email</a>' : ''}`;
      return;
    }
    if (!st.member) {
      setStat('ready', 'Not joined');
      gate.innerHTML = `<div class="fc-rules">
        <h3>Before you join</h3>
        <p class="muted sm">Joining is optional. You can leave at any time, and you can privately ask not to be seated next to anyone here.</p>
        <ul>${GUIDELINES.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
        <p class="muted sm">Messages are deleted 48 hours after the flight arrives. Reported messages are kept separately for moderators while a report is investigated. <a href="#/chat-safety">Read the full safety &amp; privacy notice</a>.</p>
        <label class="check sm"><input type="checkbox" id="fcAccept"> I accept the student chat guidelines</label>
        <button class="btn btn-primary block" id="fcJoin" disabled>Join the chat</button></div>`;
      $('#fcAccept').addEventListener('change', (e) => { $('#fcJoin').disabled = !e.target.checked; });
      $('#fcJoin').addEventListener('click', async () => {
        const r = await authCall('POST', `/chat/${fid}/join`, { acceptGuidelines: true });
        if (!r.ok) return toast(r.error || 'Could not join.');
        mountChat();
      });
      return;
    }
    const h = await authCall('GET', `/chat/${fid}/messages`);
    if (!$('#fcBox')) return;
    if (!h.ok) { setStat('error', 'Unavailable'); gate.innerHTML = `<div class="fc-note">${esc(h.error || 'Chat unavailable.')}</div>`; return; }
    gate.innerHTML = h.warning ? '<div class="fc-warn">You have one warning for breaking the student chat guidelines. A second confirmed violation cancels your booking on this flight with no refund.</div>' : '';
    log.hidden = false; form.hidden = false; $('#fcFoot').hidden = false;
    log.replaceChildren(el('div', 'fc-note', 'Say hello to the students on your flight. Group chat only. Keep personal details (phone, address, seat) private. Messages are deleted 48 hours after arrival.'));

    function addMsg(m) {
      const mine = m.author === h.me, stick = mine || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      const row = el('div', 'fc-msg' + (mine ? ' mine' : ''));
      row.dataset.id = m.id;
      const body = el('div', 'fc-body'), meta = el('div', 'fc-meta');
      meta.appendChild(el('b', '', mine ? 'You' : m.name));
      meta.insertAdjacentHTML('beforeend', tick());
      if (m.uni) meta.appendChild(el('span', 'fc-uni', m.uni));
      meta.appendChild(el('time', '', new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
      body.appendChild(meta);
      body.appendChild(el('p', 'fc-text', m.text));
      if (!mine) {
        const tools = el('div', 'fc-tools');
        const rep = el('button', 'fc-link', 'Report'); rep.type = 'button';
        rep.addEventListener('click', () => reportDialog(fid, m.id));
        const av = el('button', 'fc-link', "Don't seat me next to them"); av.type = 'button';
        av.addEventListener('click', async () => {
          const r = await authCall('POST', `/chat/${fid}/avoid`, { messageId: m.id });
          toast(r.ok ? r.message : r.error || 'Not possible.');
        });
        tools.append(rep, av);
        body.appendChild(tools);
        row.appendChild(el('span', 'fc-av c' + (hash(m.author) % 6), (Array.from(m.name)[0] || '?').toUpperCase()));
      }
      row.appendChild(body);
      log.appendChild(row);
      if (stick) log.scrollTop = log.scrollHeight;
    }
    h.messages.forEach(addMsg);
    log.scrollTop = log.scrollHeight;

    const es = new EventSource(`${API}/api/chat/${fid}/stream?ticket=${h.ticket}`);
    chatConn = es;
    setStat('connecting', 'Connecting…');
    es.onopen = () => setStat('ready', 'Live');
    es.addEventListener('message', (e) => { try { addMsg(JSON.parse(e.data)); } catch {} });
    es.addEventListener('deleted', (e) => { try { const id = JSON.parse(e.data).id; const n = log.querySelector(`[data-id="${CSS.escape(id)}"]`); if (n) n.remove(); } catch {} });
    es.addEventListener('warning', (e) => { try { gate.innerHTML = ''; gate.appendChild(el('div', 'fc-warn', JSON.parse(e.data).text)); } catch {} });
    es.addEventListener('removed', (e) => {
      es.close(); chatConn = null;
      let why = 'You left the chat.'; try { why = JSON.parse(e.data).reason; } catch {}
      log.hidden = true; form.hidden = true; $('#fcFoot').hidden = true;
      gate.replaceChildren(el('div', 'fc-note', why)); setStat('error', 'Closed');
    });
    es.onerror = () => { if (es.readyState === 2) { setStat('error', 'Disconnected'); chatConn = null; } else setStat('connecting', 'Reconnecting…'); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const r = await authCall('POST', `/chat/${fid}/messages`, { text });
      if (!r.ok) { toast(r.error || 'Not sent.'); input.value = text; }
      input.focus();
    });
    $('#fcLeave').addEventListener('click', async () => {
      if (!confirm('Leave this chat? You can join again later.')) return;
      await authCall('POST', `/chat/${fid}/leave`, {});
      chatLeave(); toast('You left the chat.'); render();
    });
    if (window.matchMedia && matchMedia('(pointer:fine)').matches) input.focus();
  }

  function reportDialog(fid, messageId) {
    document.querySelector('.modal-bg')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" data-action="modal-close">
        <form class="modal report" data-action="noop" id="reportForm" role="dialog" aria-modal="true" aria-labelledby="repTitle">
          <h2 id="repTitle">Report this message</h2>
          <p class="muted sm">A moderator will review it. The person is not told who reported them.</p>
          <label class="field"><span>What's wrong?</span><select name="category">${REPORT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="field"><span>Anything else? (optional)</span><textarea name="note" maxlength="500" rows="3"></textarea></label>
          <p class="muted sm">In danger or threatened? Tell the crew or airport staff now, or call 999 in Hong Kong.</p>
          <button class="btn btn-primary block" type="submit">Send report</button>
          <button class="btn btn-ghost block" type="button" data-action="modal-close">Cancel</button>
        </form>
      </div>`);
    $('#reportForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const r = await authCall('POST', `/chat/${fid}/report`, { messageId, category: f.get('category'), note: f.get('note') });
      $('.modal-bg')?.remove();
      toast(r.ok ? r.message : r.error || 'Could not send the report.');
    }, { once: true });
  }

  /* Moderators (accounts listed in MODERATORS on the server): review reports and decide. */
  views.moderation = () => {
    if (!user || !user.moderator) return `<div class="narrow"><div class="card empty">Moderators only.</div></div>`;
    return `<div class="narrow wide"><header class="pagehead"><div><p class="crumb">Safety</p><h1>Chat reports</h1>
      <p class="sub">Severity: low (rude) · medium (harassment, spam) · high (sexual, discrimination, doxxing) · critical (threats, safety). 1st confirmed violation = warning; 2nd = booking cancelled, no refund; critical = also removed from the chat and escalated to security.</p></div></header>
      <div id="modList" class="stack"><p class="muted">Loading…</p></div></div>`;
  };
  async function loadReports() {
    const box = $('#modList'); if (!box) return;
    const r = await authCall('GET', '/mod/reports');
    if (!r.ok) { box.textContent = r.error || 'Could not load reports.'; return; }
    if (!r.reports.length) { box.innerHTML = '<div class="card empty">No reports.</div>'; return; }
    box.innerHTML = r.reports.map((x) => `<div class="card mod-card">
      <div class="row between"><b>${esc(x.category)} · ${esc(x.flight ? x.flight.number + ' ' + x.flight.dep.slice(0, 10) : x.fid)}</b><span class="badge">${esc(x.status)}${x.outcome ? ' · ' + esc(x.outcome) : ''}</span></div>
      <p class="muted sm">Reported: ${esc(x.reportedName || '?')} · previous strikes: ${x.strikes} · ${esc(x.at.slice(0, 16).replace('T', ' '))}${x.note ? ' · note: ' + esc(x.note) : ''}</p>
      <div class="mod-ev">${x.evidence.map((m) => `<p class="sm${m.id === x.msgId ? ' hit' : ''}"><b>${esc(m.name || '?')}</b> ${esc(m.text)}</p>`).join('')}</div>
      ${x.status === 'open' ? `<div class="row gap-sm mod-act" data-id="${x.id}">
        <select class="mod-sev">${['low', 'medium', 'high', 'critical'].map((s) => `<option ${s === x.severity ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label class="check sm"><input type="checkbox" class="mod-hold"> Legal hold</label>
        <button class="btn btn-primary sm-btn" data-mod="warn">Confirm violation</button>
        <button class="btn btn-ghost sm-btn" data-mod="dismiss">Dismiss</button></div>` : ''}</div>`).join('');
    box.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.closest('.mod-act');
      if (b.dataset.mod === 'warn' && !confirm('Confirm this violation? A second confirmed violation cancels the booking with no refund.')) return;
      const res = await authCall('POST', '/mod/reports/' + act.dataset.id, { decision: b.dataset.mod, severity: act.querySelector('.mod-sev').value, legalHold: act.querySelector('.mod-hold').checked });
      toast(res.ok ? 'Decision saved: ' + res.outcome : res.error || 'Failed.'); loadReports();
    }));
  }

  /* Verification team (accounts listed in VERIFIERS on the server): review student ID submissions.
   * Documents are fetched with the reviewer's session, shown from memory, and never cached; every view is logged. */
  views.review = () => {
    if (!user || !user.reviewer) return `<div class="narrow"><div class="card empty">Verification team only.</div></div>`;
    return `<div class="narrow wide"><header class="pagehead"><div><p class="crumb">Verification team</p><h1>Student verification queue</h1>
      <p class="sub">Check that the document is a genuine student ID or enrolment record, in the account holder's name, from an eligible institution, and valid on their flight dates. Automated checks only flag: you decide. Documents are deleted as soon as you decide. Opening a document is logged.</p></div></header>
      <div id="revList" class="stack"><p class="muted">Loading…</p></div></div>`;
  };
  const revUrls = [];
  async function loadReview() {
    const box = $('#revList'); if (!box) return;
    revUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const r = await authCall('GET', '/review/queue');
    if (!r.ok) { box.textContent = r.error || 'Could not load the queue.'; return; }
    if (!r.items.length) { box.innerHTML = '<div class="card empty">Nothing to review. 🎉</div>'; return; }
    const mark = { pass: ['ok', '✓'], flag: ['warn', '!'], info: ['muted', 'i'] };
    const reasons = Object.entries(r.reasons);
    const max = shiftDate(todayStr(), 365);
    box.innerHTML = r.items.map((x) => {
      const s = x.submission, d = s.declared;
      return `<div class="card rev-card" data-uid="${esc(x.uid)}" data-sub="${esc(s.id)}">
        <div class="row between"><b>${esc(x.name)}</b><span class="badge warn">Pending · ${esc(fmtDate(s.submittedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>
        <p class="muted sm">${esc(x.universityEmail)} · ${esc(x.institution.name)} ${x.institution.recognised ? '<span class="badge ok">recognised</span>' : '<span class="badge warn">not on list</span>'}</p>
        <div class="rev-grid">
          <div><p class="lab">Student says</p>
            <div class="sum-row"><span>Name</span><b>${esc(d.fullName)}</b></div>
            <div class="sum-row"><span>Institution</span><b>${esc(d.institution)}</b></div>
            <div class="sum-row"><span>Valid until</span><b>${d.expiry ? esc(d.expiry) : 'no expiry date'}</b></div>
            ${s.detectedExpiry ? `<div class="sum-row"><span>Read from document</span><b>${esc(s.detectedExpiry)}</b></div>` : ''}
            <div class="sum-row"><span>Booked flights</span><b>${x.flights.length ? x.flights.map(esc).join(', ') : 'none'}</b></div>
            ${x.previous ? `<p class="muted xs">Previous submission ${esc(x.previous.submittedAt.slice(0, 10))}</p>` : ''}
            <p class="lab" style="margin-top:12px">Automated checks</p>
            <ul class="rev-checks">${s.checks.map((c) => `<li class="${mark[c.result][0]}"><span class="ck">${mark[c.result][1]}</span><span><b>${esc(c.label)}</b>${c.detail ? `<br><span class="muted xs">${esc(c.detail)}</span>` : ''}</span></li>`).join('')}</ul></div>
          <div><p class="lab">Documents</p>${s.documents.map((doc) => `<div class="rev-doc"><button class="btn btn-ghost sm-btn" data-doc="${esc(doc.id)}" data-mime="${esc(doc.mime)}" ${x.own ? 'disabled' : ''}>${icon('ticket')} Open ${doc.role === 'student_id' ? 'student ID' : 'enrolment proof'} (${esc(doc.mime.split('/')[1].toUpperCase())}${doc.width ? `, ${doc.width}×${doc.height}` : ''})</button><div class="rev-view"></div></div>`).join('')}</div>
        </div>
        ${x.own ? '<p class="muted sm">This is your own submission: another reviewer must decide.</p>' : `<div class="rev-act">
          <div class="row gap-sm"><label class="field"><span>Valid until (max ${esc(fmtDay(max))})</span><input type="date" class="rev-until" value="${esc(x.suggestedValidUntil)}" min="${todayStr()}" max="${max}"></label>
          <button class="btn btn-primary sm-btn" data-rev="approve">Approve</button></div>
          <div class="row gap-sm"><label class="field"><span>Or ask for more information</span><select class="rev-reason">${reasons.map(([k]) => `<option value="${k}">${k.replace(/_/g, ' ')}</option>`).join('')}</select></label>
          <label class="field"><span>Note to the student (optional)</span><input class="rev-msg" maxlength="400" placeholder="e.g. The photo is cut off at the bottom."></label>
          <button class="btn btn-ghost sm-btn" data-rev="reject">Reject</button></div></div>`}
      </div>`;
    }).join('');
    box.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
      const view = b.nextElementSibling;
      view.textContent = 'Opening…';
      try {
        const res = await fetch(API + '/api/review/document/' + encodeURIComponent(b.dataset.doc), { headers: { Authorization: 'Bearer ' + session() }, cache: 'no-store' });
        if (!res.ok) { view.textContent = (await res.json().catch(() => ({}))).error || 'Could not open it.'; return; }
        const url = URL.createObjectURL(await res.blob()); revUrls.push(url);
        view.innerHTML = b.dataset.mime === 'application/pdf' ? `<object class="vf-pdf" data="${url}" type="application/pdf"><a href="${url}" target="_blank" rel="noopener">Open PDF</a></object>` : `<img class="vf-img" src="${url}" alt="Submitted document">`;
      } catch { view.textContent = 'Could not open it.'; }
    }));
    box.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      const card = b.closest('.rev-card'), approve = b.dataset.rev === 'approve';
      const body = approve ? { decision: 'approve', validUntil: card.querySelector('.rev-until').value, submissionId: card.dataset.sub }
        : { decision: 'reject', reasonCode: card.querySelector('.rev-reason').value, message: card.querySelector('.rev-msg').value, submissionId: card.dataset.sub };
      if (!approve && !confirm('Ask the student for more information? The document will be deleted and they will see the reason.')) return;
      const res = await authCall('POST', `/review/${encodeURIComponent(card.dataset.uid)}/decision`, body);
      toast(res.ok ? (approve ? `Approved until ${res.validUntil}. Document deleted.` : 'Rejected. Document deleted.') : res.error || 'Failed.');
      loadReview();
    }));
  }

  /* Safety & privacy notice for students (public). */
  views['chat-safety'] = () => `
    <div class="narrow wide legal"><header class="pagehead"><div><p class="crumb">Student flight chat</p><h1>Safety &amp; privacy</h1>
      <p class="sub">How the student chat works, what we collect and what happens if someone breaks the rules.</p></div></header>
      <div class="card"><h3>Who can join</h3><ul>
        <li>Students aged 18+ who verified a university email with a one-time code <b>and</b> had a current student ID or enrolment record approved by our verification team, valid on the flight date, signed in, and booked on that flight.</li>
        <li>Joining is optional and you can leave at any time. It opens 7 days before departure.</li>
        <li>Group conversation only: there are no private or one-to-one messages.</li>
        <li><b>Limits:</b> a university email and a checked student ID show that someone is a current student. They do not prove character. Treat people you meet online with care.</li></ul></div>
      <div class="card"><h3>What others see, and what they don't</h3><ul>
        <li>Others see your first name, a verified tick and, only if you chose to share it when booking, your university.</li>
        <li>Never your surname, email, booking reference, seat number or seating preferences.</li>
        <li>You can privately ask not to be seated next to someone in the chat. Nobody is told, and nobody can ask to sit next to a particular person.</li></ul></div>
      <div class="card"><h3>Guidelines</h3><ul>${GUIDELINES.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>
      <div class="card"><h3>Reporting and moderation</h3><ul>
        <li>Use <b>Report</b> on any message. The reported person is never told who reported them, and retaliation is itself a violation.</li>
        <li>A moderator reviews each report, sets a severity (low, medium, high, critical) and either dismisses it or confirms a violation. Confirmed messages are removed for everyone.</li>
        <li>1st confirmed violation: warning. 2nd: removed from the chat and the booking on that flight is cancelled with no refund. Critical cases (threats, safety): removed from the chat immediately and escalated to the airline's security team (and the police where needed).</li>
        <li>In danger now? Tell the crew or airport staff, or call 999 in Hong Kong.</li></ul></div>
      <div class="card"><h3>Your data</h3><ul>
        <li>We use your account (name, email, date of birth), your verified university email and your booking only to check eligibility and run the chat.</li>
        <li>Messages are deleted 48 hours after the flight arrives (scheduled arrival in this prototype).</li>
        <li>If a message is reported, it and the messages around it are copied to a separate store that only moderators can access, kept for up to ${180} days (30 days if the report is dismissed), longer only under a legal hold.</li>
        <li>You can ask for a copy of, or correction to, your personal data (Hong Kong PDPO data access and correction requests).</li></ul></div>
      <p class="muted sm">Prototype notice: these rules, retention periods and the two-strike cancellation policy are proposals for review by qualified Hong Kong legal counsel and the airline's safeguarding team. They are not a statement of legal compliance.</p>
      <a class="btn btn-ghost" href="#/parents">Information for parents</a>
    </div>`;

  /* Parent-facing FAQ (public). Parents don't get access to adult students' conversations. */
  views.parents = () => `
    <div class="narrow wide legal"><header class="pagehead"><div><p class="crumb">For parents</p><h1>Student flight chat: questions from parents</h1></div></header>
      ${[
        ['Who can use it?', 'Only students aged 18 or over, verified with a one-time code sent to a university email address and a student ID checked by our verification team, signed in to their own account and booked on that flight. Under-18s cannot join.'],
        ['Can strangers message my child privately?', 'No. There are no private or one-to-one messages: only one group conversation per flight, visible to all verified students on it.'],
        ["What do others see about my child?", 'Their first name and, only if they choose, their university. Never their surname, contact details, seat number or booking.'],
        ['Will they be seated next to someone from the chat?', 'Student seating is optional. Students can privately ask not to sit next to someone; nobody can ask to sit next to a particular person.'],
        ['How is behaviour moderated?', 'Every message can be reported. Moderators review reports by severity. A first confirmed violation is a warning; a second cancels that booking with no refund. Threats are escalated to the airline security team and, where needed, the police.'],
        ['How long are messages kept?', 'Messages are deleted 48 hours after the flight arrives. Reported messages are kept separately and only for as long as an investigation or legal obligation requires.'],
        ['Can I read my child’s messages?', 'No. Students using the chat are adults, so their conversations are private to the participants and to moderators reviewing a report.'],
        ['What are the limits?', 'Verification shows that someone is a current student at an eligible institution; it is not a background check. We encourage students to keep personal details private and to tell crew or staff about any concern.'],
      ].map(([q, a]) => `<div class="card"><h3>${q}</h3><p class="muted">${a}</p></div>`).join('')}
      <p class="muted sm">Prototype notice: policies shown here are proposals for review by Hong Kong legal counsel and the airline's safeguarding team.</p>
    </div>`;

  const notFound = () => `<div class="narrow"><div class="card empty">We couldn't find that page. <a href="#/home">Go home</a></div></div>`;
  function redirect(to) { setTimeout(() => { location.hash = to; }, 0); return ''; }

  /* ---------- router ---------- */
  const PROTECTED = new Set(['trips', 'profile', 'verify', 'rewards', 'perks', 'book', 'results', 'confirm', 'chat', 'moderation', 'review']);
  const NAV_GROUP = { home: 'home', book: 'trips', results: 'trips', confirm: 'trips', trips: 'trips', trip: 'trips', boarding: 'trips', seats: 'trips', planner: 'trips', chat: 'trips', retrieve: 'trips', tools: 'trips', status: 'trips', baggage: 'trips', timetable: 'trips', rewards: 'rewards', perks: 'rewards', r: 'rewards', offers: 'offers', profile: 'profile', verify: 'profile', signin: 'profile', signup: 'profile', discover: 'offers', 'chat-safety': 'trips', parents: 'offers', moderation: 'profile', review: 'profile' };

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    return parts;
  }

  function render() {
    chatLeave();
    const [r, a, b] = route();
    const name = views[r] ? r : 'home';
    if (PROTECTED.has(name) && !user) { location.hash = '#/signin'; return; }
    if ((name === 'trip' || name === 'boarding' || name === 'seats' || name === 'planner' || name === 'chat') && !user && !retrieved.has(a)) { location.hash = '#/retrieve'; return; }
    $('#view').innerHTML = views[name](a, b);
    document.body.dataset.route = name;
    renderChrome(NAV_GROUP[name]);
    window.scrollTo(0, 0);
    if (name === 'chat') mountChat();
    if (name === 'moderation') loadReports();
    if (name === 'review') loadReview();
    if (user && liveAccount() && (name !== 'verify' || (sv && sv.status === 'pending_review' && !vs.replace)) && Date.now() - (fetchVerification.at || 0) > 60000) fetchVerification(true); // status can change on the server (review, expiry)
    watchInviteCard();
    liveSync();
  }

  function renderChrome(active) {
    document.querySelectorAll('.brand-sub').forEach((el) => { el.textContent = isStudent() ? 'student' : 'flights & rewards'; });
    document.querySelectorAll('.nav-offers').forEach((el) => { el.textContent = isStudent() ? 'Student offers' : 'Offers'; });
    document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('on', el.dataset.nav === active));
    const ini = user ? esc(user.firstName[0] + user.lastName[0]) : '';
    const slot = $('#userSlot');
    slot.href = user ? '#/profile' : '#/signin';
    slot.innerHTML = user
      ? `<span class="avatar">${ini}${user.verified ? tick('tick-av') : ''}</span><div><b>${esc(user.firstName)} ${esc(user.lastName[0])}.${user.verified ? ' ' + tick() : ''}</b><span class="s">${currentTier() !== user.tier ? esc(currentTier()) + ' · graduation gift' : isStudent() ? 'Student member' : 'Cathay member'}</span></div>`
      : `<span class="avatar">${icon('user')}</span><div><b>Sign in / up</b><span class="s">See your points and flights</span></div>`;
    const m = $('#mAvatar');
    m.href = user ? '#/profile' : '#/signin';
    m.innerHTML = user ? ini + (user.verified ? tick('tick-av') : '') : icon('user');
  }

  /* ---------- actions ---------- */
  function readSearchForm(form) {
    const f = new FormData(form);
    search.from = f.get('from'); search.to = f.get('to');
    search.depart = f.get('depart'); search.ret = f.get('ret') || search.ret;
    search.cabin = f.get('cabin'); search.pax = Number(f.get('pax'));
  }

  const actions = {
    'set-type'(el) { const f = $('#searchForm'); if (f) readSearchForm(f); search.type = el.dataset.type; render(); },
    swap() {
      const f = $('#searchForm').elements; const a = f.from.value; f.from.value = f.to.value || a; f.to.value = a;
    },
    offer(el) { search.to = el.dataset.code; search.from = 'HKG'; location.hash = '#/book'; },
    'set-date'(el) {
      if (search.step === 'out') { search.depart = el.dataset.date; if (search.ret < search.depart) search.ret = shiftDate(search.depart, 7); }
      else search.ret = el.dataset.date < search.depart ? search.depart : el.dataset.date;
      render();
    },
    'back-out'() { search.step = 'out'; search.out = null; render(); },
    pick(el) {
      const idx = Number(el.dataset.idx);
      if (search.step === 'out') {
        search.out = withFare(flightsFor(search.from, search.to, search.depart, search.cabin)[idx], el.dataset.fare);
        if (search.type === 'return') { search.step = 'ret'; render(); } else location.hash = '#/confirm';
      } else {
        search.back = withFare(flightsFor(search.to, search.from, search.ret, search.cabin)[idx], el.dataset.fare);
        location.hash = '#/confirm';
      }
    },
    'trips-tab'(el) { tripsTab = el.dataset.tab; render(); },
    checkin(el) {
      const t = findTrip(el.dataset.ref);
      seatSel.key = ''; location.hash = `#/seats/${t.ref}/0`; // every cabin gets a seat map now
    },
    'pick-seat'(el) {
      seatSel.seat = el.dataset.seat;
      document.querySelectorAll('.seat.mine').forEach((x) => x.classList.remove('mine'));
      const cell = document.querySelector(`.seat[data-seat="${seatSel.seat}"]`);
      if (cell) { cell.classList.add('mine'); if (cell !== el) cell.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const b = $('#seatConfirm');
      b.disabled = false; b.textContent = 'Confirm seat ' + seatSel.seat;
    },
    async 'confirm-seat'() {
      const { t, i } = seatCtx;
      const s = t.segments[i];
      if (liveAccount()) { // claim the seat on the shared server first: another phone may just have taken it
        const r = await liveCall('/flights/' + liveId(s) + '/pax', { ...paxBody(t, s, seatSel.seat), active: true });
        if (r.status === 409) { toast(r.error || 'That seat was just taken.'); seatSel.seat = ''; seatSel.key = ''; return liveRerender(); }
      }
      s.seat = seatSel.seat;
      seatSel.key = '';
      if (i < t.segments.length - 1) { saveTrips(); location.hash = `#/seats/${t.ref}/${i + 1}`; return; }
      t.checkedIn = true; t.checkedInAt = toISO(new Date()); saveTrips();
      if (user && user.verified && !t.studentPoints) {
        const p = perks();
        t.studentPoints = Math.round(t.segments.reduce((n, s) => n + flightMiles(s, t.cabin), 0) * PERKS.spRate);
        p.sp = (p.sp || 0) + t.studentPoints; savePerks(p); saveTrips();
        toast(`Checked in. +${t.studentPoints.toLocaleString()} student points`);
      } else toast('Checked in. Boarding pass ready.');
      location.hash = '#/trip/' + t.ref;
    },
    'auto-seat'() {
      const { p, c, taken } = seatCtx, ids = SZ.allSeats(c);
      const seat = ids.find((id) => !taken.has(id) && !(p && p.at[id])) || ids.find((id) => !taken.has(id));
      if (!seat) return toast('No free seat left in this cabin.');
      actions['pick-seat']({ dataset: { seat } });
      const b = $('#seatConfirm'); if (b) b.textContent = 'Check in · seat ' + seat;
    },
    'seat-unlock'(el) {
      const { t, i } = seatCtx, p = perks(), w = el.dataset.with === 'miles' ? 'miles' : 'sp';
      if (w === 'sp' && !user.verified) return toast('Verify your student status to pay with student points.');
      if (w === 'sp' && spLeft(p) < PERKS.seatSp) return toast('Not enough student points.');
      if (w === 'miles' && asiaMiles() < PERKS.seatMiles) return toast('Not enough Asia Miles.');
      p.seatBuys = [...(p.seatBuys || []), { ref: t.ref, i, with: w, amount: w === 'sp' ? PERKS.seatSp : PERKS.seatMiles, at: toISO(new Date()) }];
      savePerks(p); rerender();
      flashTick(`Seat choice unlocked · −${(w === 'sp' ? PERKS.seatSp : PERKS.seatMiles).toLocaleString()} ${w === 'sp' ? 'student points' : 'Asia Miles'}`);
    },
    cancel(el) {
      if (!confirm('Cancel this booking? (demo)')) return;
      const t = findTrip(el.dataset.ref); t.status = 'Cancelled'; saveTrips(); toast('Booking cancelled.'); render();
    },
    signout() { signOutLocal('Signed out.'); },
    'reset-demo'() {
      if (!confirm('Clear all your bookings and perks? Your account and student verification stay.')) return;
      store.set('trips', []); store.set('perks', {}); store.set('sales', {}); store.set('seatplans', {});
      loadState(); toast('Bookings and perks cleared.'); location.hash = '#/home'; render();
    },
    async unverify() {
      if (!confirm('Remove your student verification? Student features stop now and you will need to verify again (email and student ID).')) return;
      if (liveAccount()) { const r = await authCall('DELETE', '/student/verification'); if (!r.ok) return toast(r.error || 'Could not remove it.'); }
      store.set('verified', null, true); user.verified = null; user.tier = 'Member'; sv = null;
      Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null, files: {}, form: {}, replace: false });
      toast('Student verification removed.'); render();
    },
    'vf-remove'(el) { vPick(el.dataset.slot, null); },
    'vf-replace'() { vs.replace = true; vs.msg = ''; render(); },
    'vf-cancel-replace'() { vs.replace = false; vs.msg = ''; render(); },
    async 'vf-withdraw'() {
      if (!confirm('Remove the document you sent? It will be deleted and your review cancelled.')) return;
      const r = await authCall('DELETE', '/student/submission');
      if (!r.ok) return toast(r.error || 'Could not remove it.');
      applyVerification(r.view); toast('Document removed and deleted.'); render();
    },
    'vf-simulate'() {
      const v = { email: vs.email, at: toISO(new Date()), until: shiftDate(todayStr(), 365), institution: SZ.universityFromEmail(vs.email), simulated: true };
      store.set('verified', v); user.verified = v; user.tier = 'Student'; grantWelcome();
      if (vs.returnTo) { const to = vs.returnTo; vs.returnTo = ''; location.hash = to; return; }
      render();
    },
    'verify-resend'() { startVerify(vs.email, true); },
    'verify-change'() { vs.step = 'email'; vs.msg = ''; render(); },
    'claim-adapter'(el) {
      const p = perks(), t = findTrip(el.dataset.ref);
      p.adapter = { email: user.verified.email, ref: t.ref, at: toISO(new Date()) };
      savePerks(p); rerender();
      flashTick(`Type ${SZ.plugFor(t.segments[0].to)} adapter claimed`);
    },
    async 'plan-pick'(el) {
      const { t, i } = seatCtx, s = t.segments[i], seat = el.dataset.seat;
      if (!studentCanPick(t, i)) return;
      if (liveAccount()) {
        const r = await liveCall('/flights/' + liveId(s) + '/pax', { ...paxBody(t, s, seat), active: true });
        if (!r.ok) return toast(r.error || 'That seat is not available.');
      }
      s.pick = seat; saveTrips(); rerender(); flashTick('Seat ' + seat + ' is yours');
    },
    async 'plan-auto'() {
      const { t, i } = seatCtx, s = t.segments[i];
      delete s.pick; saveTrips();
      if (liveAccount()) await liveCall('/flights/' + liveId(s) + '/pax', { ...paxBody(t, s, null), active: true });
      rerender(); flashTick('Back to automatic seating');
    },
    'invite-info'(el) { inviteInfo(el.dataset.who === 'invited' ? 'invited' : 'inviter'); },
    'ref-copy'() {
      const link = refLink();
      if (navigator.share) { navigator.share({ title: 'Fly with me on Cathay', text: 'Verify as a student with my link and we both get bonus miles.', url: link }).catch(() => {}); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied'), () => toast(link));
    },
    'grad-demo'() {
      const p = perks();
      p.graduated = toISO(new Date()); p.gradPoints = spLeft(p); p.gradConverted = spConverted(p.gradPoints); savePerks(p); rerender();
      showModal('Congratulations, graduate!', `Enjoy ${SZ.tierUp(user.tier)} status for ${PERKS.boostMonths} months, ${PERKS.gradMiles.toLocaleString()} bonus miles and ${p.gradConverted.toLocaleString()} Asia Miles from your student points.`);
    },
    'grad-undo'() { const p = perks(); delete p.graduated; delete p.gradConverted; delete p.gradPoints; savePerks(p); rerender(); },
    redeem(el) {
      const rw = REWARDS.find((r) => r.id === el.dataset.id), t = findTrip(el.dataset.ref);
      const err = redeem(t, rw);
      if (err) return toast(err);
      rerender(); flashTick(`${rw.name} added`);
    },
    'seat-answer'(el) {
      const t = findTrip(el.dataset.ref);
      t.studentSeat = el.dataset.v === 'yes';
      seatSel.key = ''; saveTrips(); render();
      if (t.studentSeat) seatYesModal();
    },
    'seat-change'(el) { delete findTrip(el.dataset.ref).studentSeat; saveTrips(); render(); },
    'seat-change-form'(el) { el.closest('.sz-card').querySelector('.sz-choice-wrap').innerHTML = seatPoll(); },
    'go-verify'() { vs.returnTo = location.hash; },
    'modal-close'() { $('.modal-bg').remove(); },
    noop() {},
    soon(el) { toast(`${el.dataset.label}: placeholder for the hackathon build.`); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) { fn(el); }
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target, f = new FormData(form), id = form.id;
    if (id === 'quickBook') {
      const to = f.get('to'), from = f.get('from'), err = $('#qbErr');
      if (!to || to === from) { err.textContent = !to ? 'Choose a destination.' : 'Origin and destination must differ.'; err.hidden = false; return; }
      Object.assign(search, { type: 'one way', from, to, depart: f.get('depart'), cabin: f.get('cabin'), pax: 1, step: 'out', out: null, back: null });
      location.hash = '#/results';
    } else if (id === 'searchForm') {
      readSearchForm(form);
      const err = $('#searchErr');
      let msg = '';
      if (!search.to) msg = 'Please choose a destination.';
      else if (search.to === search.from) msg = 'Origin and destination must differ.';
      else if (search.type === 'return' && search.ret < search.depart) msg = 'Return date must be after departure.';
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      search.step = 'out'; search.out = null; search.back = null;
      location.hash = '#/results';
    } else if (id === 'confirmForm') {
      const s = search, ref = refCode();
      const fare = (s.out.price + (s.back ? s.back.price : 0)) * s.pax;
      const mk = (fl, i) => ({ number: fl.number, from: fl.from, to: fl.to, dep: fl.dep, arr: fl.arr, durMin: fl.durMin, stops: fl.stops, aircraft: fl.aircraft, fare: fl.fare || null, seat: '' });
      const t = {
        ref, status: 'Confirmed', cabin: s.cabin, checkedIn: false, bought: toISO(new Date()),
        pax: Array.from({ length: s.pax }, (_, i) => ({ first: f.get('first' + i).trim(), last: f.get('last' + i).trim() })),
        total: Math.round(fare * 1.14), segments: [mk(s.out), ...(s.back ? [mk(s.back)] : [])],
      };
      if (f.get('szSeat')) t.studentSeat = f.get('szSeat') === 'yes';
      if (t.studentSeat) t.showUni = f.get('szShowUni') === 'on';
      t.fare = s.out.fare || null;
      trips.push(t); saveTrips(); retrieved.add(ref);
      search.out = null; search.back = null; search.step = 'out'; search.to = '';
      toast(`Booked! Reference ${ref}`);
      location.hash = '#/trip/' + ref;
    } else if (id === 'signinForm' || id === 'signupForm') {
      accountSubmit(id, f);
    } else if (id === 'retrieveForm') {
      const t = findTrip(String(f.get('ref')).trim().toUpperCase());
      const err = $('#retrieveErr');
      if (!t || !t.pax.some((p) => p.last.toLowerCase() === String(f.get('last')).trim().toLowerCase())) {
        err.textContent = 'We couldn\'t find a booking with those details.'; err.hidden = false; return;
      }
      retrieved.add(t.ref); location.hash = '#/trip/' + t.ref;
    } else if (id === 'verifyEmailForm') {
      startVerify(f.get('email'));
    } else if (id === 'verifyCodeForm') {
      confirmVerify(f.get('code'));
    } else if (id === 'verifyDocForm') {
      submitDocuments();
    } else if (form.classList.contains('rw-form')) {
      const rw = REWARDS.find((r) => r.id === form.dataset.reward), t = findTrip(f.get('ref'));
      const err = redeem(t, rw);
      if (err) return toast(err);
      rerender(); toast(`${rw.name} added to ${tripLabel(t)} · −${rw.pts.toLocaleString()} student points`);
    } else if (id === 'gradForm') {
      const p = perks();
      p.gradMonth = f.get('grad'); savePerks(p); rerender();
      toast('Graduation date saved. We\'ll remind you a month before.');
    } else if (id === 'prefsForm') {
      const prefs = { seat: f.get('seat'), meal: f.get('meal'), notifications: f.get('notifications') === 'on' };
      store.set('prefs', prefs); user.prefs = prefs; toast('Preferences saved.');
    } else if (id === 'statusForm') {
      const num = String(f.get('num')).trim().toUpperCase().replace(/^CX\s*/, 'CX ');
      const known = trips.flatMap((t) => t.segments).find((s) => s.number === num);
      const seg = known || (() => { const r = mulberry32(hash(num)); const a = AIRPORTS[Math.floor(r() * 5)], b = AIRPORTS[5 + Math.floor(r() * 9)];
        const dep = new Date(f.get('date') + 'T' + D.pad(7 + Math.floor(r() * 14)) + ':' + ['00', '15', '30', '45'][Math.floor(r() * 4)]);
        const m = Math.round(distanceKm(a.code, b.code) / 800 * 60 + 35); return { number: num, from: a.code, to: b.code, dep: toISO(dep), arr: toISO(new Date(dep.getTime() + m * 60000)), durMin: m }; })();
      const r = mulberry32(hash(num + f.get('date')));
      const delay = r() > 0.7 ? 10 + Math.floor(r() * 50) : 0;
      $('#statusOut').innerHTML = `<div class="card"><div class="row between"><b>${esc(seg.number)} · ${seg.from} → ${seg.to}</b><span class="badge ${delay ? 'warn' : 'ok'}">${delay ? 'Delayed ' + delay + ' min' : 'On time'}</span></div>
        <div class="sum-row"><span>Scheduled departure</span><b>${fmtTime(seg.dep)}</b></div>
        <div class="sum-row"><span>Estimated departure</span><b>${fmtTime(new Date(new Date(seg.dep).getTime() + delay * 60000))}</b></div>
        <div class="sum-row"><span>Gate</span><b>${gateFor(num)}</b></div><div class="sum-row"><span>Terminal</span><b>${termFor(num)}</b></div>
        <p class="muted sm">Demo status, generated deterministically.</p></div>`;
    } else if (id === 'timetableForm') {
      const fl = generateFlights(f.get('from'), f.get('to'), f.get('date'), 'Economy');
      $('#timetableOut').innerHTML = f.get('from') === f.get('to') ? '<div class="card empty">Choose two different airports.</div>' :
        fl.map((x) => `<div class="card row between"><b>${x.number}</b><span>${fmtTime(x.dep)} → ${fmtTime(x.arr)}</span><span class="muted sm">${dur(x.durMin)} · ${x.stops ? '1 stop' : 'Nonstop'}</span></div>`).join('');
    }
  });

  /* Verification form: keep typed values and picked files across re-renders. */
  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('vf-in') && e.target.type !== 'checkbox') vs.form[e.target.name] = e.target.value;
  });
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('vf-input')) { vPick(e.target.dataset.slot, e.target.files && e.target.files[0]); return; }
    if (e.target.classList.contains('vf-in') && e.target.type === 'checkbox') { vs.form.noExpiry = e.target.checked; if (!e.target.checked && vs.files.proof) vPick('proof', null); else render(); return; }
    if (e.target.classList.contains('share-uni')) {
      const t = findTrip(e.target.dataset.ref);
      t.showUni = e.target.checked; saveTrips();
      return flashTick(t.showUni ? 'University shown to nearby students' : 'University hidden');
    }
    if (e.target.name !== 'szSeat' || e.target.type !== 'radio') return;
    const yes = e.target.value === 'yes';
    e.target.closest('.sz-choice-wrap').innerHTML = seatChoice(yes);
    if (yes) seatYesModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('.modal-bg')) $('.modal-bg').remove();
  });

  document.addEventListener('input', (e) => {
    const form = e.target.closest('#baggageForm');
    if (!form) return;
    calcBaggage(form);
  });
  function calcBaggage(form) {
    const f = new FormData(form);
    const allow = { Economy: [1, 23], 'Premium Economy': [2, 23], Business: [2, 32], First: [3, 32] }[f.get('cabin')];
    const bags = Number(f.get('bags')) || 0, kg = Number(f.get('kg')) || 0;
    const extraBags = Math.max(0, bags - allow[0]);
    const overBags = Math.min(bags, allow[0]);
    const overKg = kg > allow[1] ? (kg - allow[1]) * overBags : 0;
    const fee = extraBags * 100 + overKg * 12;
    $('#baggageOut').innerHTML = `<div class="card tint"><div class="sum-row"><span>Free allowance</span><b>${allow[0]} × ${allow[1]} kg</b></div>
      <div class="sum-row"><span>Extra bags</span><b>${extraBags} × $100</b></div>
      <div class="sum-row"><span>Overweight</span><b>${overKg} kg × $12</b></div>
      <div class="sum-row total"><span>Estimated fees</span><b>${money(fee)}</b></div></div>`;
  }

  /* ---------- student verification ---------- */
  async function apiPost(path, body) {
    try {
      const authz = session() && !isLocalAccount() ? { Authorization: 'Bearer ' + session() } : {}; // lets the server record student status on the account
      const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authz }, body: JSON.stringify(body) });
      let data = null;
      try { data = await res.json(); } catch (_) {}
      if (!data || typeof data.ok === 'undefined') return { unreachable: true }; // e.g. static hosting returns HTML/404
      return data;
    } catch (_) { return { unreachable: true }; }
  }

  async function startVerify(rawEmail, isResend) {
    if (vs.busy) return;
    const email = String(rawEmail || '').trim().toLowerCase();
    vs.email = email;
    if (!isEduEmail(email)) {
      vs.msg = 'Use your university email — the domain must include .edu (e.g. name@uni.edu or name@uni.edu.hk).';
      vs.step = 'email';
      return render();
    }
    vs.busy = true; vs.msg = '';
    const r = await apiPost('/api/verify/start', { email, firstName: user ? user.firstName : '' });
    vs.busy = false;
    if (r.unreachable) {
      // No backend (e.g. GitHub Pages): run the whole flow locally in demo mode.
      vs.localCode = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      vs.localExpires = Date.now() + 10 * 60 * 1000;
      vs.demo = true; vs.demoCode = vs.localCode; vs.step = 'code';
      toast('Demo mode: no email server connected.');
    } else if (!r.ok) {
      vs.msg = r.error || 'Something went wrong. Please try again.';
      vs.step = isResend ? 'code' : 'email';
    } else {
      vs.localCode = null; vs.demo = !r.sent; vs.demoCode = r.demoCode || ''; vs.step = 'code';
      toast(r.sent ? 'Code sent to ' + email : 'Demo mode: code shown on screen.');
    }
    render();
  }

  async function confirmVerify(rawCode) {
    if (vs.busy) return;
    const code = String(rawCode || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { vs.msg = 'Enter the 6-digit code.'; return render(); }
    vs.busy = true;
    let ok = false, msg = '', lastConfirm = null;
    if (vs.localCode) {
      if (Date.now() > vs.localExpires) msg = 'That code has expired. Request a new one.';
      else if (code === vs.localCode) ok = true;
      else msg = 'That code is not correct.';
    } else {
      const r = await apiPost('/api/verify/confirm', { email: vs.email, code });
      lastConfirm = r;
      if (r.unreachable) msg = 'Could not reach the verification server.';
      else if (r.ok && r.verified) ok = true;
      else msg = r.error || 'That code is not correct.';
    }
    vs.busy = false;
    if (ok) {
      // Step 1 done. The account is a verified student only after step 2 (student ID) is approved on the server.
      vs.step = 'doc'; vs.msg = ''; vs.form = {};
      if (lastConfirm && lastConfirm.verification) applyVerification(lastConfirm.verification);
      toast('University email verified. Next: your student ID.');
    } else vs.msg = msg;
    render();
  }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', () => { document.querySelector('.modal-bg')?.remove(); render(); });
  window.addEventListener('DOMContentLoaded', () => {
    loadState();
    render();
    if (!location.hash) location.hash = '#/home';
    fetch(API + '/api/live/health').then((r) => r.ok && r.json()).then(async (j) => {
      if (!j || !j.ok) return;
      LIVE.on = true; document.body.dataset.live = 'on';
      if (session() && !isLocalAccount()) { // refresh this account's data from the server (another device may have changed it)
        const r = await authCall('GET', '/me');
        if (r.ok) { useAccount(session(), r.user, r.data); await fetchVerification(); }
        else if (r.status === 401) return signOutLocal('Your session expired. Please sign in again.');
      }
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }).catch(() => {});
  });
  window.__aurelia = { render, views };
})();
