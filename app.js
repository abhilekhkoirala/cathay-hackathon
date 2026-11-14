/* Aurelia Air — DEMO app. Fictional airline; all data is fake and stored in localStorage. */
(() => {
  'use strict';
  const D = window.AURELIA;
  const { AIRPORTS, CABINS, SEED_USER, generateFlights, distanceKm, basePrice, airport, hash, mulberry32, toISO, toDate } = D;

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  const mem = {};
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('aurelia.' + k);
        return v === null ? d : JSON.parse(v);
      } catch { return k in mem ? mem[k] : d; }
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem('aurelia.' + k, JSON.stringify(v)); } catch {}
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
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
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
  const vs = { step: 'email', email: '', demo: false, demoCode: '', msg: '', busy: false, localCode: null, localExpires: 0 };
  const search = { type: 'return', from: 'HKG', to: '', depart: shiftDate(todayStr(), 14), ret: shiftDate(todayStr(), 21), cabin: 'Economy', pax: 1, step: 'out', out: null, back: null };
  const SZ = window.AURELIA_SZ;
  const seatSel = { key: '', seat: '' };

  function loadState() {
    trips = store.get('trips', null);
    if (!trips) { trips = D.seedTrips(); store.set('trips', trips); }
    const loggedOut = store.get('loggedOut', false);
    const saved = store.get('prefs', null);
    const u = JSON.parse(JSON.stringify(SEED_USER));
    if (saved) u.prefs = { ...u.prefs, ...saved };
    user = loggedOut ? null : u;
    if (user) user.verified = store.get('verified', null);
    window.__seedUser = u;
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
        <div><span class="muted sm">Cabin</span><b>${esc(t.cabin)}</b></div>
      </div>
    </div>`;
  }

  function tripCard(t) {
    const s0 = t.segments[0];
    return `
    <a class="card trip-card" href="#/trip/${t.ref}">
      <div class="row between"><b>${tripLabel(t)}</b><span class="row gap-sm">${user && isUpcoming(t) && studentTrip(t) ? `<span class="sz-pill">${icon('cap')} Student</span>` : ''}${badge(t.status)}</span></div>
      <div class="muted sm">${fmtDate(s0.dep)} · ${fmtTime(s0.dep)}${t.segments.length > 1 ? ' · returns ' + fmtDate(t.segments[1].dep, { day: 'numeric', month: 'short' }) : ''}</div>
      <div class="row between small-row"><span class="muted sm">Ref <b class="mono">${t.ref}</b> · ${esc(t.cabin)}</span>
      ${isUpcoming(t) ? `<span class="pill">${countdown(s0.dep)}</span>` : ''}</div>
    </a>`;
  }

  /* ---------- student seating ---------- */
  const studentOk = (iso) => Boolean(user && user.verified && SZ.isAdult(user.dob, iso));
  const studentTrip = (t) => t.cabin === 'Economy' && studentOk(t.segments[0].dep);
  const who = (x) => `<b>${esc(x.name)}</b> · ${esc(x.uni)}`;

  /* Re-runs the student seat planner for one flight with every seat sold so far, and remembers the
   * result so students only move when a seat planned for them is bought. */
  function seatPlan(t, i) {
    const s = t.segments[i], key = SZ.flightKey(s);
    const me = studentTrip(t)
      ? { id: 'me', me: true, name: user.firstName, uni: SZ.universityFromEmail(user.verified.email), year: '', field: '', locked: t.checkedIn ? s.seat : null }
      : null;
    const sold = [...(store.get('sales', {})[key] || [])];
    if (!me && s.seat) sold.push(s.seat);
    const plans = store.get('seatplans', {});
    const p = SZ.plan(s, { me, sold, prev: plans[key] });
    plans[key] = p.seatOf;
    store.set('seatplans', plans);
    return p;
  }

  /* Shown in the booking form and on the trip page when the user isn't a verified adult student. */
  function studentGate(iso) {
    if (!user) return '';
    if (!user.verified) return `<a class="banner" href="#/verify">${icon('cap')}<span><b>Fly next to other students</b><br><span class="muted sm">Verify your student status and we'll seat you next to another student.</span></span>${icon('arrow')}</a>`;
    if (!SZ.isAdult(user.dob, iso)) return `<div class="card empty sm">Student seating is open to verified students aged 18+.</div>`;
    return '';
  }

  function studentCard(t) {
    if (!user || t.cabin !== 'Economy' || !isUpcoming(t)) return '';
    const planner = `<a class="btn btn-ghost block sm-btn" href="#/planner/${t.ref}/0">See how students are seated (demo)</a>`;
    if (!studentTrip(t)) return studentGate(t.segments[0].dep) + `<div class="stack">${planner}</div>`;
    const lines = t.segments.map((s, i) => {
      const p = seatPlan(t, i), nb = p.neighboursOf(p.students.find((x) => x.me));
      return `<div class="sum-row"><span>${esc(s.number)} · ${s.from} → ${s.to}</span><b>${p.students.length - 1} other students</b></div>
        ${t.checkedIn && nb.length ? `<p class="sm" style="margin:0 0 6px">Seat ${esc(s.seat)}, next to ${nb.map(who).join(' and ')}</p>` : ''}`;
    }).join('');
    return `
    <div class="card sz-card">
      <div class="row between"><h3>${icon('cap')} Student seating</h3>${tick()}</div>
      <p class="muted sm" style="margin:0 0 6px">You're a verified student, so we'll seat you next to another student, from your university when we can. Your seat is picked for you at check-in.</p>
      ${lines}
      ${planner}
    </div>`;
  }

  /* ---------- views ---------- */
  const views = {};

  views.home = () => {
    const next = upcoming()[0];
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const offers = ['SIN', 'NRT', 'ICN', 'BKK', 'SYD', 'LHR'].map((c) => {
      const hue = hash(c) % 360;
      return `<button class="offer" data-action="offer" data-code="${c}" style="background:linear-gradient(145deg,hsl(${hue} 50% 30%),hsl(${(hue + 50) % 360} 60% 50%))">
        <span class="muted-w sm">From Hong Kong</span><b>${city(c)}</b><span>from ${money(basePrice('HKG', c))}</span></button>`;
    }).join('');
    return `
    <section class="hero">
      <p class="eyebrow">${greet}</p>
      <h1>${user ? `Welcome back, ${esc(user.firstName)}` : 'Where to next?'}${user && user.verified ? ' ' + tick('tick-lg') : ''}</h1>
      <p class="hero-sub">Book, check in and manage every trip in one place.</p>
      <div class="quick">
        <a href="#/book">${icon('plane')}<span>Book a trip</span></a>
        <a href="#/trips">${icon('briefcase')}<span>Manage booking</span></a>
        <a href="${next && canCheckIn(next) ? '#/trip/' + next.ref : '#/retrieve'}">${icon('check')}<span>Check in</span></a>
        <a href="#/status">${icon('clock')}<span>Flight status</span></a>
      </div>
    </section>
    ${user && !user.verified ? `<a class="banner" href="#/verify">${tick('tick-off')}<span><b>Verify your student status</b><br><span class="muted sm">Use your .edu email to earn a green tick on your profile.</span></span>${icon('arrow')}</a>` : ''}
    <div class="cols">
      <section>
        <h2>Your next trip</h2>
        ${next ? `<div class="card next">
            <div class="row between"><b class="lg">${tripLabel(next)}</b><span class="pill">${countdown(next.segments[0].dep)}</span></div>
            ${segmentCard(next.segments[0], next, 0)}
            <div class="row gap">
              <a class="btn btn-primary" href="#/trip/${next.ref}">${canCheckIn(next) && !next.checkedIn ? 'Check in now' : 'View trip'}</a>
              ${next.checkedIn ? `<a class="btn btn-ghost" href="#/boarding/${next.ref}/0">Boarding pass</a>` : ''}
            </div></div>`
          : `<div class="card empty">${user ? 'No upcoming trips yet.' : 'Sign in to see your trips.'} <a href="#/book">Plan one →</a></div>`}
      </section>
      <section>
        <h2>Membership</h2>
        ${user ? memberCard() : `<div class="card empty">Join Aurelia Club to earn miles on every flight.<br><br><a class="btn btn-primary" href="#/signin">Sign in / up</a></div>`}
      </section>
    </div>
    <h2>Latest offers <span class="muted sm">· Origin Hong Kong</span></h2>
    <div class="offers">${offers}</div>`;
  };

  function memberCard() {
    const pct = Math.min(100, Math.round((user.tierPoints / user.nextTierAt) * 100));
    return `<div class="member">
      <div class="row between"><span class="eyebrow-w">Aurelia Club</span><span class="tier">${esc(user.tier)}</span></div>
      <div class="member-name">${esc(user.firstName)} ${esc(user.lastName)}${user.verified ? ' ' + tick() : ''}</div>
      <div class="mono">${esc(user.memberId)}</div>
      <div class="row between stats"><div><span class="muted-w sm">Miles</span><b>${user.points.toLocaleString()}</b></div>
        <div><span class="muted-w sm">Status points</span><b>${user.tierPoints} / ${user.nextTierAt}</b></div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="muted-w sm">${user.nextTierAt - user.tierPoints} more status points to ${esc(user.nextTier)}</div>
    </div>`;
  }

  views.book = () => {
    const s = search;
    return `
    <div class="narrow">
      <h1>Book a trip</h1>
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
    const flights = generateFlights(leg.from, leg.to, leg.date, s.cabin);
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
      <div class="flights">
        ${flights.map((f, i) => `
        <div class="card flight">
          <div class="f-main">
            <div><b class="time">${fmtTime(f.dep)}</b><div class="muted sm">${f.from}</div></div>
            <div class="f-mid"><span class="muted sm">${dur(f.durMin)}</span><div class="line thin"></div><span class="muted sm">${f.stops ? '1 stop' : 'Nonstop'}</span></div>
            <div><b class="time">${fmtTime(f.arr)}</b><div class="muted sm">${f.to}</div></div>
          </div>
          <div class="f-side">
            <div class="muted sm">${f.number} · ${f.aircraft}</div>
            <div class="price">${money(f.price * s.pax)}</div>
            ${f.seatsLeft <= 4 ? `<div class="warn sm">${f.seatsLeft} seats left</div>` : '<div class="muted sm">total</div>'}
            <button class="btn btn-primary sm-btn" data-action="pick" data-idx="${i}">Select</button>
          </div>
        </div>`).join('')}
      </div>
      <p class="muted sm">Demo data: flights and fares are generated, not real. Times shown without time-zone conversion.</p>
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
    const flightLine = (f) => `<div class="sum-row"><b>${f.number}</b><span>${city(f.from)} → ${city(f.to)}</span><span>${fmtDate(f.dep, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(f.dep)}</span></div>`;
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
        ${s.cabin === 'Economy' ? (studentOk(s.out.dep) ? `<div class="sz-note sm">${icon('cap')}<span>You're a verified student, so we'll seat you next to another student on this flight, from your university when we can.</span></div>` : studentGate(s.out.dep)) : ''}
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
      <h1>My trips</h1>
      <div class="tabs">
        <button class="${tripsTab === 'upcoming' ? 'on' : ''}" data-action="trips-tab" data-tab="upcoming">Upcoming (${upcoming().length})</button>
        <button class="${tripsTab === 'past' ? 'on' : ''}" data-action="trips-tab" data-tab="past">Past & cancelled (${past().length})</button>
      </div>
      <div class="stack">${list.map(tripCard).join('') || '<div class="card empty">Nothing here yet.</div>'}</div>
      <a class="btn btn-ghost block" href="#/retrieve">Retrieve another booking</a>
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
            ? `<button class="btn btn-primary block" data-action="checkin" data-ref="${t.ref}">${t.cabin === 'Economy' ? 'Check in & choose seat' : 'Check in online'}</button>`
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
        <div class="pass-top"><span>Aurelia Air · Boarding pass</span><span class="row gap-sm">${me ? `<span class="pass-tag">${icon('cap')} STUDENT</span>` : ''}${esc(t.cabin)}</span></div>
        <div class="pass-name">${esc((p.last + '/' + p.first).toUpperCase())}</div>
        <div class="pass-route"><div><b>${s.from}</b><span>${city(s.from)}</span></div>${icon('plane', 'big')}<div class="right"><b>${s.to}</b><span>${city(s.to)}</span></div></div>
        <div class="pass-grid">
          <div><span>Flight</span><b>${esc(s.number)}</b></div><div><span>Date</span><b>${fmtDate(s.dep, { day: '2-digit', month: 'short' })}</b></div>
          <div><span>Boarding</span><b>${fmtTime(new Date(new Date(s.dep).getTime() - 45 * 60000))}</b></div><div><span>Departs</span><b>${fmtTime(s.dep)}</b></div>
          <div><span>Gate</span><b>${gateFor(seed)}</b></div><div><span>Terminal</span><b>${termFor(seed)}</b></div>
          <div><span>Seat</span><b>${esc(s.seat)}</b></div><div><span>Group</span><b>${t.cabin === 'Economy' ? '4' : '1'}</b></div>
        </div>
        ${me ? `<div class="pass-zone">${icon('cap')} ${nb.length ? 'Seated next to ' + nb.map((x) => `${esc(x.name)} (${esc(x.uni)})`).join(' and ') : 'Student'}</div>` : ''}
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
  const seatEl = (id, cls, inner = '', action = '', label = '') => action
    ? `<button class="seat ${cls}" data-action="${action}" data-seat="${id}" aria-label="Seat ${id}${esc(label)}" title="${id}${esc(label)}">${inner}</button>`
    : `<span class="seat ${cls}" aria-label="Seat ${id}${esc(label)}" title="${id}${esc(label)}">${inner}</span>`;
  const legend = (items) => `<div class="legend">${items.map(([cls, label]) => `<span><i class="${cls}"></i>${label}</span>`).join('')}</div>`;

  views.seats = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx), s = t && t.segments[i];
    if (!t || !s) return notFound();
    if (t.checkedIn || !canCheckIn(t)) return redirect('#/trip/' + ref);
    const p = seatPlan(t, i), c = p.cabin, me = p.students.find((x) => x.me);
    seatCtx = { t, i, p };
    const head = `${backLink('#/trip/' + ref, 'Back to trip')}
      <p class="eyebrow">Check-in · flight ${i + 1} of ${t.segments.length}</p>
      <h1>${me ? 'Your seat' : 'Choose your seat'}</h1>
      <p class="muted">${esc(s.number)} · ${city(s.from)} → ${city(s.to)} · ${fmtDate(s.dep)} · ${esc(s.aircraft)}</p>`;

    if (me && p.seatOf.me) {
      // Students don't choose: the planner has already put them next to other students.
      const mine = p.seatOf.me, nb = p.neighboursOf(me), near = new Set(nb.map((x) => p.seatOf[x.id]));
      seatSel.seat = mine;
      const cell = (id) => id === mine ? seatEl(id, 'mine', id.slice(-1), '', ', your seat')
        : near.has(id) ? seatEl(id, 'stu', icon('cap'), '', ', ' + p.at[id].name)
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
                ? `<p class="sm" style="margin:0">Next to ${nb.map((x) => `${who(x)} · ${esc(x.year)}, ${esc(x.field)}`).join('<br>and ')}</p>
                   ${nb.some((x) => x.uni === me.uni) ? `<p class="sz-same sm">${icon('check')} Same university as you</p>` : ''}`
                : `<p class="sm" style="margin:0">No other student could be seated next to you yet. We keep trying until check-in closes.</p>`}
              <p class="muted sm" style="margin:8px 0 0">${p.students.length - 1} other students are on this flight. Student seats are assigned automatically.</p>
            </div>
            <div class="seat-bar"><button id="seatConfirm" class="btn btn-primary block" data-action="confirm-seat">Check in · seat ${mine}</button></div>
          </div>
        </div>
      </div>`;
    }

    if (seatSel.key !== ref + i) { seatSel.key = ref + i; seatSel.seat = s.seat || ''; }
    const cell = (id) => id === seatSel.seat ? seatEl(id, 'mine', id.slice(-1), 'pick-seat')
      : p.paid.has(id) ? seatEl(id, 'taken') : seatEl(id, 'free', id.slice(-1), 'pick-seat', ', free');
    return `
    <div class="narrow wide">${head}
      <div class="seat-layout">
        <div>${legend([['lg-free', 'Free'], ['lg-taken', 'Taken'], ['lg-mine', 'Your seat']])}${seatGrid(c, cell)}</div>
        <div class="seat-side">
          <div class="card sm">Pick any free seat.</div>
          <div class="seat-bar">
            <button id="seatConfirm" class="btn btn-primary block" data-action="confirm-seat" ${seatSel.seat ? '' : 'disabled'}>${seatSel.seat ? 'Confirm seat ' + seatSel.seat : 'Pick a seat'}</button>
            <button class="btn btn-ghost block sm-btn" data-action="auto-seat">Assign me a seat</button>
          </div>
        </div>
      </div>
    </div>`;
  };

  /* Demo / operations view: sell seats and watch the planner re-seat students. */
  const planner = { key: '', log: [], moved: new Set() };
  views.planner = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx || 0), s = t && t.segments[i];
    if (!t || !s) return notFound();
    const p = seatPlan(t, i), c = p.cabin;
    seatCtx = { t, i, p };
    if (planner.key !== SZ.flightKey(s)) Object.assign(planner, { key: SZ.flightKey(s), log: [], moved: new Set() });
    const groupOf = {};
    p.groups.forEach((g) => g.seats.forEach((id) => { groupOf[id] = g; }));
    const cell = (id) => {
      const x = p.at[id], moved = planner.moved.has(id) ? ' moved' : '';
      if (x) {
        const g = groupOf[id], kind = x.me ? 'mine' : g.members.length < 2 ? 'solo' : g.sameUni ? 'stu' : 'mix';
        return seatEl(id, kind + moved, x.me ? 'You' : esc(x.name.slice(0, 2)), x.locked ? '' : 'plan-sell', `, ${x.me ? 'you' : x.name} · ${x.uni}`);
      }
      return p.paid.has(id) ? seatEl(id, 'taken', '', '', ', paying passenger') : seatEl(id, 'free', '', 'plan-sell', ', free');
    };
    const multi = p.groups.filter((g) => g.members.length > 1);
    const alone = p.students.filter((x) => p.seatOf[x.id] && !p.neighboursOf(x).length).length;
    const range = (g) => g.seats.length > 1 ? `${g.seats[0]}–${g.seats[g.seats.length - 1].slice(-1)}` : g.seats[0];
    return `
    <div class="narrow wide">
      ${backLink('#/trip/' + ref, 'Back to trip')}
      <p class="eyebrow">Demo · operations view</p>
      <h1>Student seating planner</h1>
      <p class="muted">${esc(s.number)} · ${city(s.from)} → ${city(s.to)} · ${fmtDate(s.dep)}${t.segments.length > 1 ? ' · ' + t.segments.map((x, j) => j === i ? `<b>${x.from}→${x.to}</b>` : `<a href="#/planner/${t.ref}/${j}">${x.from}→${x.to}</a>`).join(' | ') : ''}</p>
      <div class="seat-layout">
        <div>${legend([['lg-stu', 'Students, same university'], ['lg-mix', 'Students, mixed'], ['lg-solo', 'Student alone'], ['lg-mine', 'You'], ['lg-taken', 'Paying passenger'], ['lg-free', 'Free']])}${seatGrid(c, cell)}</div>
        <div class="seat-side">
          <div class="card sm"><b>Tap any seat to sell it to a paying passenger.</b>
            <span class="muted">Verified students are seated automatically in groups of 2–3 side by side, from the same university when possible; every other seat stays on sale. If a seat planned for a student is sold, the planner re-runs and moves only that student's group.</span></div>
          <div class="card plan-stats">
            <div><b>${p.students.length}</b><span>students</span></div><div><b>${multi.length}</b><span>groups</span></div>
            <div><b>${multi.filter((g) => g.sameUni).length}</b><span>same uni</span></div><div><b>${alone}</b><span>alone</span></div>
          </div>
          <div class="card"><h3>Changes</h3>
            ${planner.log.length ? planner.log.map((l) => `<p class="sm plan-log">${l}</p>`).join('') : '<p class="muted sm">No seats sold yet.</p>'}
            <button class="btn btn-ghost block sm-btn" data-action="plan-reset">Reset this flight</button></div>
          <div class="card"><h3>Student groups</h3>
            ${p.groups.map((g) => `<div class="sum-row sm"><span class="mono">${range(g)}</span><span>${g.members.map((m) => esc(m.me ? 'You' : m.name)).join(', ')}</span><b>${g.members.length < 2 ? 'alone' : g.sameUni ? esc(g.members[0].uni) : 'mixed'}</b></div>`).join('')}</div>
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
      <h1>Profile</h1>
      ${memberCard()}
      <div class="card">
        <h3>Personal details</h3>
        <div class="sum-row"><span>Name</span><b>${esc(user.firstName)} ${esc(user.lastName)}</b></div>
        <div class="sum-row"><span>Email</span><b>${esc(user.email)}</b></div>
        <div class="sum-row"><span>Phone</span><b>${esc(user.phone)}</b></div>
        <div class="sum-row"><span>Date of birth</span><b>${esc(user.dob)}</b></div>
        <div class="sum-row"><span>Member since</span><b>${esc(user.memberSince)}</b></div>
        <div class="sum-row"><span>Student status</span><b>${user.verified ? tick() + ' Verified' : 'Not verified'}</b></div>
      </div>
      <div class="card">
        <h3>Student verification</h3>
        ${user.verified
          ? `<p class="muted" style="margin-top:0">${tick()} Verified with <b>${esc(user.verified.email)}</b>.</p>
             <button class="btn btn-ghost block sm-btn" data-action="unverify">Remove verification (demo)</button>`
          : `<p class="muted" style="margin-top:0">Confirm a university email (.edu) to get a green tick next to your name.</p>
             <a class="btn btn-primary block" href="#/verify">Verify student status</a>`}
      </div>
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
        <button class="btn btn-ghost block sm-btn" data-action="reset-demo">Reset demo data</button>
      </div>
    </div>`;
  };

  views.verify = () => {
    const done = user.verified || vs.step === 'done';
    if (done) {
      const v = user.verified;
      return `<div class="narrow">${backLink('#/profile', 'Profile')}
        <div class="card verify-done">${tick('tick-xl')}<h1>You're verified</h1>
          <p class="muted">${esc(user.firstName)} ${esc(user.lastName)} now has a green tick next to their name.${v ? '<br>Verified with <b>' + esc(v.email) + '</b>.' : ''}</p>
          <a class="btn btn-primary block" href="#/home">Back to home</a></div></div>`;
    }
    const err = vs.msg ? `<p class="err" role="alert">${esc(vs.msg)}</p>` : '';
    if (vs.step === 'code') {
      return `<div class="narrow">${backLink('#/profile', 'Profile')}
        <h1>Enter your code</h1>
        <p class="muted">We sent a 6-digit code to <b>${esc(vs.email)}</b>. It expires in 10 minutes.</p>
        ${vs.demo ? `<div class="card demo-note"><b>Demo mode:</b> no email server is connected, so your code is shown here.<div class="demo-code mono">${esc(vs.demoCode)}</div></div>` : ''}
        <form id="verifyCodeForm" class="card form" autocomplete="off">
          <label class="field"><span>6-digit code</span><input name="code" class="code-input mono" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" required autofocus></label>
          ${err}
          <button class="btn btn-primary block" type="submit">Verify</button>
          <div class="two"><button class="btn btn-ghost" type="button" data-action="verify-resend">Resend code</button>
          <button class="btn btn-ghost" type="button" data-action="verify-change">Change email</button></div>
        </form></div>`;
    }
    return `<div class="narrow">${backLink('#/profile', 'Profile')}
      <h1>Verify student status</h1>
      <p class="muted">Enter your university email. We'll send a 6-digit code — any address whose domain includes <b>.edu</b> works (e.g. <span class="mono">name@uni.edu</span>, <span class="mono">name@uni.edu.hk</span>).</p>
      <form id="verifyEmailForm" class="card form" novalidate>
        <label class="field"><span>University email</span><input type="email" name="email" placeholder="name@university.edu" value="${esc(vs.email)}" required autocomplete="email"></label>
        ${err}
        <button class="btn btn-primary block" type="submit">Send code</button>
      </form>
      <p class="muted sm">Aurelia Student Verify is a demo feature of a fictional airline. Your address is used only to send the code.</p>
    </div>`;
  };

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
        <label class="field"><span>Flight number</span><input name="num" placeholder="e.g. AU 507" required value="${upcoming()[0] ? esc(upcoming()[0].segments[0].number) : ''}"></label>
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
        <label class="field"><span>Booking reference</span><input name="ref" required maxlength="6" class="mono" placeholder="${upcoming()[0] ? upcoming()[0].ref : 'K7M2QX'}"></label>
        <p id="retrieveErr" class="err" hidden></p>
        <button class="btn btn-primary block" type="submit">Continue</button>
      </form>
      <p class="muted sm">Demo hint: try <b class="mono">K7M2QX</b> with family name <b>Doe</b>.</p>
    </div>`;

  views.signin = () => `
    <div class="signin">
      <div class="signin-brand"><h1>Aurelia Club</h1><p>Earn miles, unlock lounges and manage your trips.</p></div>
      <div class="narrow">
        <h1 class="mob-only">Sign in</h1>
        <form id="signinForm" class="card form">
          <label class="field"><span>Email or member number</span><input name="email" value="john.doe@example.com" required></label>
          <label class="field"><span>Password</span><input type="password" name="password" value="demo1234" required></label>
          <p id="signinErr" class="err" hidden></p>
          <button class="btn btn-primary block" type="submit">Sign in</button>
          <button class="btn btn-ghost block" type="button" data-action="demo-login">Continue as John Doe (demo)</button>
        </form>
        <p class="muted sm center">Demo credentials are pre-filled. This is a fictional airline; no real accounts exist.</p>
      </div></div>`;

  const notFound = () => `<div class="narrow"><div class="card empty">We couldn't find that page. <a href="#/home">Go home</a></div></div>`;
  function redirect(to) { setTimeout(() => { location.hash = to; }, 0); return ''; }

  /* ---------- router ---------- */
  const PROTECTED = new Set(['trips', 'profile', 'verify']);
  const NAV_GROUP = { home: 'home', book: 'book', results: 'book', confirm: 'book', trips: 'trips', trip: 'trips', boarding: 'trips', seats: 'trips', planner: 'trips', profile: 'profile', verify: 'profile', signin: 'profile', tools: 'tools', status: 'tools', baggage: 'tools', retrieve: 'tools', timetable: 'tools' };

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    return parts;
  }

  function render() {
    const [r, a, b] = route();
    const name = views[r] ? r : 'home';
    if (PROTECTED.has(name) && !user) { location.hash = '#/signin'; return; }
    if ((name === 'trip' || name === 'boarding' || name === 'seats' || name === 'planner') && !user && !retrieved.has(a)) { location.hash = '#/retrieve'; return; }
    $('#view').innerHTML = views[name](a, b);
    document.body.dataset.route = name;
    renderChrome(NAV_GROUP[name]);
    window.scrollTo(0, 0);
  }

  function renderChrome(active) {
    document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('on', el.dataset.nav === active));
    const slot = $('#userSlot');
    slot.innerHTML = user
      ? `<a class="chip" href="#/profile"><span class="avatar">${esc(user.firstName[0] + user.lastName[0])}${user.verified ? tick('tick-av') : ''}</span><span class="chip-text">${esc(user.firstName)}${user.verified ? ' ' + tick() : ''} · ${esc(user.tier)}</span></a>`
      : `<a class="chip signin-chip" href="#/signin">Sign in / up</a>`;
    const tabProfile = $('#tabProfile');
    if (tabProfile) tabProfile.querySelector('span').textContent = user ? 'Profile' : 'Sign in';
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
        search.out = generateFlights(search.from, search.to, search.depart, search.cabin)[idx];
        if (search.type === 'return') { search.step = 'ret'; render(); } else location.hash = '#/confirm';
      } else {
        search.back = generateFlights(search.to, search.from, search.ret, search.cabin)[idx];
        location.hash = '#/confirm';
      }
    },
    'trips-tab'(el) { tripsTab = el.dataset.tab; render(); },
    checkin(el) {
      const t = findTrip(el.dataset.ref);
      if (t.cabin === 'Economy') { seatSel.key = ''; location.hash = `#/seats/${t.ref}/0`; return; }
      t.checkedIn = true;
      t.segments.forEach((s, i) => { if (!s.seat) s.seat = (10 + (hash(t.ref + i) % 30)) + 'ABCDEF'[hash(t.ref + i + 's') % 6]; });
      saveTrips(); toast('Checked in. Boarding pass ready.'); render();
    },
    'pick-seat'(el) {
      seatSel.seat = el.dataset.seat;
      document.querySelectorAll('.seat.mine').forEach((x) => x.classList.remove('mine'));
      const cell = document.querySelector(`.seat[data-seat="${seatSel.seat}"]`);
      if (cell) { cell.classList.add('mine'); if (cell !== el) cell.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const b = $('#seatConfirm');
      b.disabled = false; b.textContent = 'Confirm seat ' + seatSel.seat;
    },
    'confirm-seat'() {
      const { t, i } = seatCtx;
      t.segments[i].seat = seatSel.seat;
      seatSel.key = '';
      if (i < t.segments.length - 1) { saveTrips(); location.hash = `#/seats/${t.ref}/${i + 1}`; return; }
      t.checkedIn = true; saveTrips(); toast('Checked in. Boarding pass ready.');
      location.hash = '#/trip/' + t.ref;
    },
    'auto-seat'() {
      const { p } = seatCtx, ids = SZ.allSeats(p.cabin);
      const seat = ids.find((id) => !p.paid.has(id) && !p.at[id]) || ids.find((id) => !p.paid.has(id));
      if (seat) actions['pick-seat']({ dataset: { seat } });
    },
    'plan-sell'(el) {
      const { t, i, p: before } = seatCtx, id = el.dataset.seat, key = SZ.flightKey(t.segments[i]);
      const sales = store.get('sales', {});
      sales[key] = [...(sales[key] || []), id];
      store.set('sales', sales);
      const after = seatPlan(t, i), x = before.at[id];
      const moves = after.moved.map((m) => `${esc(m.me ? 'You' : m.name)} ${before.seatOf[m.id]} → ${after.seatOf[m.id]}`);
      planner.moved = new Set(after.moved.map((m) => after.seatOf[m.id]));
      planner.log.unshift(`<b>${id}</b> sold to a paying passenger${x ? ` (planned for ${esc(x.me ? 'you' : x.name)})` : ''}. ${moves.length ? 'Re-seated: ' + moves.join(', ') + '.' : 'No student had to move.'}`);
      const y = window.scrollY; render(); window.scrollTo(0, y);
    },
    'plan-reset'() {
      const { t, i } = seatCtx, key = SZ.flightKey(t.segments[i]);
      const sales = store.get('sales', {}), plans = store.get('seatplans', {});
      delete sales[key]; delete plans[key];
      store.set('sales', sales); store.set('seatplans', plans);
      Object.assign(planner, { log: [], moved: new Set() });
      const y = window.scrollY; render(); window.scrollTo(0, y);
    },
    cancel(el) {
      if (!confirm('Cancel this booking? (demo)')) return;
      const t = findTrip(el.dataset.ref); t.status = 'Cancelled'; saveTrips(); toast('Booking cancelled.'); render();
    },
    signout() { store.set('loggedOut', true); user = null; toast('Signed out.'); location.hash = '#/home'; render(); },
    'demo-login'() { store.set('loggedOut', false); loadState(); toast('Signed in as John Doe'); location.hash = '#/home'; render(); },
    'reset-demo'() { store.set('trips', null); store.set('prefs', null); store.set('verified', null); store.set('sales', {}); store.set('seatplans', {}); store.set('loggedOut', false); Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null }); loadState(); toast('Demo data reset.'); location.hash = '#/home'; render(); },
    unverify() { store.set('verified', null); user.verified = null; Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null }); toast('Verification removed.'); render(); },
    'verify-resend'() { startVerify(vs.email, true); },
    'verify-change'() { vs.step = 'email'; vs.msg = ''; render(); },
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
    if (id === 'searchForm') {
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
      const mk = (fl, i) => ({ number: fl.number, from: fl.from, to: fl.to, dep: fl.dep, arr: fl.arr, durMin: fl.durMin, stops: fl.stops, aircraft: fl.aircraft, seat: '' });
      const t = {
        ref, status: 'Confirmed', cabin: s.cabin, checkedIn: false, bought: toISO(new Date()),
        pax: Array.from({ length: s.pax }, (_, i) => ({ first: f.get('first' + i).trim(), last: f.get('last' + i).trim() })),
        total: Math.round(fare * 1.14), segments: [mk(s.out), ...(s.back ? [mk(s.back)] : [])],
      };
      trips.push(t); saveTrips(); retrieved.add(ref);
      search.out = null; search.back = null; search.step = 'out'; search.to = '';
      toast(`Booked! Reference ${ref}`);
      location.hash = '#/trip/' + ref;
    } else if (id === 'signinForm') {
      const em = String(f.get('email')).trim().toLowerCase();
      const ok = (em === SEED_USER.email || em.replace(/\s/g, '') === SEED_USER.memberId.replace(/\s/g, '').toLowerCase()) && f.get('password') === SEED_USER.password;
      const err = $('#signinErr');
      if (!ok) { err.textContent = 'Those details don\'t match the demo account.'; err.hidden = false; return; }
      actions['demo-login']();
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
    } else if (id === 'prefsForm') {
      const prefs = { seat: f.get('seat'), meal: f.get('meal'), notifications: f.get('notifications') === 'on' };
      store.set('prefs', prefs); user.prefs = prefs; toast('Preferences saved.');
    } else if (id === 'statusForm') {
      const num = String(f.get('num')).trim().toUpperCase().replace(/^AU\s*/, 'AU ');
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
      const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    let ok = false, msg = '';
    if (vs.localCode) {
      if (Date.now() > vs.localExpires) msg = 'That code has expired. Request a new one.';
      else if (code === vs.localCode) ok = true;
      else msg = 'That code is not correct.';
    } else {
      const r = await apiPost('/api/verify/confirm', { email: vs.email, code });
      if (r.unreachable) msg = 'Could not reach the verification server.';
      else if (r.ok && r.verified) ok = true;
      else msg = r.error || 'That code is not correct.';
    }
    vs.busy = false;
    if (ok) {
      const v = { email: vs.email, at: toISO(new Date()) };
      store.set('verified', v); user.verified = v; vs.step = 'done'; vs.msg = '';
      toast('Student status verified');
    } else vs.msg = msg;
    render();
  }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', () => {
    loadState();
    render();
    if (!location.hash) location.hash = '#/home';
  });
  window.__aurelia = { render, views };
})();
