/* Cathay Student — DEMO app. All data is illustrative and stored in localStorage. */
(() => {
  'use strict';
  const D = window.AURELIA;
  const { AIRPORTS, CABINS, SEED_USER, SEED_USERS, generateFlights, distanceKm, basePrice, airport, hash, mulberry32, toISO, toDate } = D;

  /* ---------- demo users ---------- */
  const USERS = (SEED_USERS && SEED_USERS.length) ? SEED_USERS : [SEED_USER];
  let activeId = SEED_USER.id; /* which seeded user's data is loaded; set in loadState() */

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  /* Per-user keys are namespaced by user id so each demo user has their own trips, prefs, verification and perks.
   * The first user keeps the original un-prefixed keys, so browsers that already visited keep their data. */
  const PER_USER = new Set(['trips', 'prefs', 'verified', 'perks', 'invitedBy', 'chatName']);
  const skey = (k) => 'cathay.' + (PER_USER.has(k) && activeId !== SEED_USER.id ? activeId + '.' : '') + k;
  const mem = {};
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(skey(k));
        return v === null ? d : JSON.parse(v);
      } catch { return skey(k) in mem ? mem[skey(k)] : d; }
    },
    set(k, v) {
      mem[skey(k)] = v;
      try { localStorage.setItem(skey(k), JSON.stringify(v)); } catch {}
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
  const vs = { step: 'email', email: '', demo: false, demoCode: '', msg: '', busy: false, localCode: null, localExpires: 0 };
  const search = { type: 'return', from: 'HKG', to: '', depart: shiftDate(todayStr(), 14), ret: shiftDate(todayStr(), 21), cabin: 'Economy', pax: 1, step: 'out', out: null, back: null };
  const SZ = window.AURELIA_SZ;
  const seatSel = { key: '', seat: '' };

  function loadState() {
    const base = USERS.find((x) => x.id === store.get('activeUser', SEED_USER.id)) || SEED_USER;
    activeId = base.id;
    trips = store.get('trips', null);
    if (!trips) { trips = D.seedTrips(base); store.set('trips', trips); }
    const loggedOut = store.get('loggedOut', false);
    const saved = store.get('prefs', null);
    const u = JSON.parse(JSON.stringify(base));
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
  const studentEligible = (t) => t.cabin === 'Economy' && studentOk(t.segments[0].dep);
  /* Only students who answered "yes" are seated next to students; "no" books like everyone else. */
  const studentTrip = (t) => studentEligible(t) && t.studentSeat === true;
  const who = (x) => `<b>${esc(x.name)}</b> · ${esc(x.uni)}`;
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
    if (!user.verified) return `<a class="banner" href="#/verify" data-action="go-verify">${icon('cap')}<span><b>Fly next to other students</b><br><span class="muted sm">Verify your student status and we'll seat you next to another student.</span></span>${icon('arrow')}</a>`;
    if (!SZ.isAdult(user.dob, iso)) return `<div class="card empty sm">Student seating is open to verified students aged 18+.</div>`;
    return '';
  }

  function studentCard(t) {
    if (!user || t.cabin !== 'Economy' || !isUpcoming(t)) return '';
    const planner = `<a class="btn btn-ghost block sm-btn" href="#/planner/${t.ref}/0">See how students are seated (demo)</a>`;
    if (!studentEligible(t)) return studentGate(t.segments[0].dep) + `<div class="stack">${planner}</div>`;
    const seated = studentTrip(t) && t.checkedIn ? t.segments.map((s, i) => {
      const p = seatPlan(t, i), nb = p.neighboursOf(p.students.find((x) => x.me));
      return nb.length ? `<p class="sm" style="margin:0">${esc(s.number)} · seat ${esc(s.seat)}, next to ${nb.map(who).join(' and ')}</p>` : '';
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
    return `<div class="sz-choice ${yes ? 'yes' : 'no'}">
      <span>${yes ? 'Student seating selected · your seat will be assigned at check-in' : 'Standard seating selected'}</span>
      <button type="button" class="link-btn" ${change}>Change</button></div>${ref ? '' : `<input type="hidden" name="szSeat" value="${yes ? 'yes' : 'no'}">`}`;
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
  const PERKS = { referralMiles: 1000, referralCap: 10, gradMiles: 3000, boostMonths: 12, spRate: 1.5, spConvert: 0.7 };
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
  const spSpent = (p) => (p.redeemed || []).reduce((n, r) => n + r.pts, 0);
  const spLeft = (p) => (p.graduated ? 0 : (user.points || 0) + (p.sp || 0) - spSpent(p));
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
  /* Miles earned through student perks. */
  function perkMiles(p = perks()) {
    const refs = p.referrals || [];
    return {
      credited: refs.filter((r) => r.flown).length * PERKS.referralMiles + (p.graduated ? PERKS.gradMiles + (p.gradConverted || 0) : 0),
      pending: refs.filter((r) => !r.flown).length * PERKS.referralMiles,
    };
  }
  const asiaMiles = () => (user.asiaMiles || 0) + perkMiles().credited;
  const currentTier = () => (user.verified && gradBoostUntil(perks()) ? SZ.tierUp(user.tier) : user.tier);
  const refLink = () => `${location.origin}${location.pathname}#/r/${SZ.referralCode(user.firstName, user.verified.email)}`;
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
    const bd = user.breakdown;
    const items = [['Flights', 'flights', 'lime'], ['Campus', 'campus', 'leaf'], ['Partners', 'partners', 'amber']];
    return `<section class="points">
      <div class="pts-main">
        <span class="lab">Your student points</span>
        <div class="pts-num">${pts(spLeft(perks()))}</div>
        <div class="pts-sub">points available</div>
        <span class="earned">${icon('up')} ${pts(user.earnedThisMonth)} earned this month</span>
        <p class="pts-note">Illustrative balance · ${pts(user.earnedThisMonth)} earned this month</p>
      </div>
      <div class="bd-wrap">
        <span class="lab d-only">Points breakdown</span>
        <div class="bd">${donut(bd, spLeft(perks()))}
          <ul class="legend d-only">${items.map(([n, k, c]) => `<li><i class="dot ${c}"></i>${n}<b>${bd[k]}%</b></li>`).join('')}</ul></div>
        <p class="m-legend m-only">${bd.flights}% flights · ${bd.campus}% campus<br>${bd.partners}% partners</p>
        <p class="foot-note d-only">Illustrative balance · refreshed just now</p>
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
          <p class="sm">${link(`#/chat/${next.ref}/0`, 'Demo: preview the chat now')}</p></div>`;
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

  const activityRow = (a) => `<div class="card act"><span class="ibadge">${icon('sparkle')}</span>
    <div><b>${esc(a.title)}</b><span class="s">${fmtDate(a.date + 'T12:00', { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(a.note)}</span></div>
    <b class="pts">+${pts(a.pts)} pts</b></div>`;

  function signedOutHome() {
    return `<div class="home noflight">
      <header class="pagehead"><div><p class="crumb">Overview / Student home</p><h1>Welcome to Cathay Student</h1>
        <p class="sub">Sign in to see your points and flights, or find an existing booking.</p></div></header>
      <section class="points"><div class="pts-main"><span class="lab">Your student points</span>
        <div class="pts-num sm-num">Sign in to see your balance</div><a class="btn btn-lime" href="#/signin">Sign in / up</a></div></section>
      <div class="g2 mid" style="margin-top:20px">
        <section class="card companion"><h3>Already booked?</h3><p class="sub" style="margin-bottom:16px">Find your booking with its reference and your family name.</p>
          <a class="btn btn-primary" href="#/retrieve">Retrieve booking</a></section>
        ${exclCard(null)}
      </div></div>`;
  }

  views.home = () => {
    if (!user) return signedOutHome();
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
      <div class="g2">${pointsCard()}${next ? nextFlightCard(next) : noFlightCard()}</div>
      <div class="sect d-only"><h2>Made for your next journey</h2><p class="sub">Student-only tools, ready when you are.</p></div>
      <div class="sect m-only"><h2>Your flight companion</h2>${next ? '<p class="sub">Your personal trip support</p>' : ''}</div>
      <div class="g2 mid">${companionCard(next)}<div class="rcol">${exclCard(next)}${quickLinks()}</div></div>
      <div class="d-only"><div class="sect-head"><h3>Recent activity</h3>${link('#/rewards', 'View all')}</div>${activityRow(user.activity[0])}</div>
    </div>`;
  };

  function memberCard() {
    return `<div class="member">
      <div class="row between"><span class="lab">Student member</span>${currentTier() !== user.tier ? `<span class="tier">${esc(currentTier())} · graduation gift</span>` : ''}</div>
      <div class="member-name">${esc(user.firstName)} ${esc(user.lastName)}${user.verified ? ' ' + tick() : ''}</div>
      <div class="mono">${esc(user.memberId)}</div>
      <div class="row between stats"><div><span class="lab">Student points</span><b>${pts(spLeft(perks()))}</b></div>
        <div><span class="lab">Asia Miles</span><b>${pts(asiaMiles())}</b></div>
        <div><span class="lab">Earned this month</span><b>+${pts(user.earnedThisMonth)}</b></div></div>
    </div>`;
  }

  views.rewards = () => `
    <div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">Points &amp; rewards</p><h1>Your student points</h1>
        <p class="sub">Earn on flights, campus and partners; spend on student rewards; 70% of what's left becomes Asia Miles when you graduate.</p></div></header>
      ${pointsCard()}
      ${perksBody()}
      <div class="sect-head"><h3>Recent activity</h3></div>
      <div class="stack" style="margin-top:0">${user.activity.map(activityRow).join('')}</div>
    </div>`;

  const OFFER_TONES = [['#0b4a35', '#2f8a62'], ['#164b36', '#3f9a72'], ['#27502f', '#8aa83a'], ['#3a4f1d', '#a9c24a'], ['#0f3d4a', '#3f8f9a'], ['#5a3a14', '#d98b3f']];
  views.offers = () => {
    const cards = ['SIN', 'NRT', 'ICN', 'BKK', 'SYD', 'LHR'].map((c, i) => `
      <button class="offer" data-action="offer" data-code="${c}" style="background:linear-gradient(145deg,${OFFER_TONES[i][0]},${OFFER_TONES[i][1]})">
        <span>From Hong Kong</span><b>${esc(city(c))}</b><span>Fares from ${money(basePrice('HKG', c))}</span></button>`).join('');
    const verify = !user ? '' : user.verified
      ? `<div class="banner">${tick()}<span><b>Student status verified</b><br><span class="muted sm">Verified with ${esc(user.verified.email)}.</span></span></div>`
      : `<a class="banner" href="#/verify">${tick('tick-off')}<span><b>Verify your student status</b><br><span class="muted sm">Use your .edu email to unlock student offers and earn a green tick.</span></span>${icon('arrow')}</a>`;
    return `<div class="narrow wide">
      <header class="pagehead"><div><p class="crumb">Student offers</p><h1>Student offers</h1>
        <p class="sub">Fares and perks picked for students flying from Hong Kong.</p></div></header>
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
        ${me ? `<div class="pass-zone">${icon('cap')} ${nb.length ? 'Seated next to ' + nb.map((x) => `${esc(x.name)} (${esc(x.uni)})`).join(' and ') : 'Student'}</div>` : ''}
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
  const seatEl = (id, cls, inner = '', action = '', label = '') => action
    ? `<button class="seat ${cls}" data-action="${action}" data-seat="${id}" aria-label="Seat ${id}${esc(label)}" title="${id}${esc(label)}">${inner}</button>`
    : `<span class="seat ${cls}" aria-label="Seat ${id}${esc(label)}" title="${id}${esc(label)}">${inner}</span>`;
  const legend = (items) => `<div class="seat-legend">${items.map(([cls, label]) => `<span><i class="${cls}"></i>${label}</span>`).join('')}</div>`;

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
      <h1>Settings</h1>
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
             <a class="btn btn-primary block" href="#/rewards">${icon('gift')} Student perks</a>
             <button class="btn btn-ghost block sm-btn" data-action="unverify" style="margin-top:8px">Remove verification (demo)</button>`
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
    const back = vs.returnTo ? backLink(vs.returnTo, 'Back') : backLink('#/profile', 'Settings');
    const done = user.verified || vs.step === 'done';
    if (done) {
      const v = user.verified;
      return `<div class="narrow">${back}
        <div class="card verify-done">${tick('tick-xl')}<h1>You're verified</h1>
          <p class="muted">${esc(user.firstName)} ${esc(user.lastName)} now has a green tick next to their name.${v ? '<br>Verified with <b>' + esc(v.email) + '</b>.' : ''}</p>
          <a class="btn btn-primary block" href="${vs.returnTo || '#/home'}">${vs.returnTo ? 'Continue' : 'Back to home'}</a></div></div>`;
    }
    const err = vs.msg ? `<p class="err" role="alert">${esc(vs.msg)}</p>` : '';
    if (vs.step === 'code') {
      return `<div class="narrow">${back}
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
    return `<div class="narrow">${back}
      <h1>Verify student status</h1>
      ${store.get('invitedBy', '') ? `<div class="sz-choice yes"><span>${icon('share')} A friend invited you (${esc(store.get('invitedBy', ''))}). Verify and you'll both get ${PERKS.referralMiles.toLocaleString()} miles after your first flight.</span></div>` : ''}
      <p class="muted">Enter your university email. We'll send a 6-digit code — any address whose domain includes <b>.edu</b> works (e.g. <span class="mono">name@uni.edu</span>, <span class="mono">name@uni.edu.hk</span>).</p>
      <form id="verifyEmailForm" class="card form" novalidate>
        <label class="field"><span>University email</span><input type="email" name="email" placeholder="name@university.edu" value="${esc(vs.email)}" required autocomplete="email"></label>
        ${err}
        <button class="btn btn-primary block" type="submit">Send code</button>
      </form>
      <p class="muted sm">Student verification is a demo feature. Your address is used only to send the code.</p>
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
        <label class="field"><span>Booking reference</span><input name="ref" required maxlength="6" class="mono" placeholder="${upcoming()[0] ? upcoming()[0].ref : 'K7M2QX'}"></label>
        <p id="retrieveErr" class="err" hidden></p>
        <button class="btn btn-primary block" type="submit">Continue</button>
      </form>
      ${trips[0] ? `<p class="muted sm">Demo hint: try <b class="mono">${esc((upcoming()[0] || trips[0]).ref)}</b> with family name <b>${esc((upcoming()[0] || trips[0]).pax[0].last)}</b>.</p>` : ''}
    </div>`;

  views.signin = () => `
    <div class="signin">
      <div class="signin-brand"><h1>Cathay Student</h1><p>Earn points, unlock student offers and manage your flights.</p></div>
      <div class="narrow">
        <h1 class="mob-only">Sign in</h1>
        <form id="signinForm" class="card form">
          <label class="field"><span>Email or member number</span><input name="email" value="abhilekh@example.com" required></label>
          <label class="field"><span>Password</span><input type="password" name="password" value="demo1234" required></label>
          <p id="signinErr" class="err" hidden></p>
          <button class="btn btn-primary block" type="submit">Sign in</button>
          ${USERS.map((u) => `<button class="btn btn-ghost block" type="button" data-action="demo-login" data-user="${u.id}">Continue as ${esc(u.firstName)} (demo)</button>`).join('')}
        </form>
        <p class="muted sm center">Demo credentials are pre-filled. ${USERS.length > 1 ? `Other demo accounts: ${USERS.slice(1).map((u) => `<b>${esc(u.email)}</b>`).join(', ')} (same password).` : ''} This is a concept prototype; no real accounts exist.</p>
      </div></div>`;

  /* Student perks section of the Points & rewards page. */
  function perksBody() {
    if (!user.verified) return studentGate(toISO(new Date()));
    const p = perks(), m = perkMiles(p), refs = p.referrals || [];
    const country = studyCountry(), plug = SZ.countryPlug(country), at = adapterTrip(p), claimed = adapterClaimed(p);
    const adapterRow = (t, right) => `<div class="perk-row"><div><b>${esc(city(t.segments[0].from))} → ${esc(city(t.segments[0].to))}</b><div class="muted sm">${fmtDate(t.segments[0].dep, { day: 'numeric', month: 'short', year: 'numeric' })} · Type ${esc(plug)}</div></div>${right}</div>`;
    const adapter = !country ? '<p class="muted sm">We couldn\'t tell your university\'s country from your email.</p>'
      : claimed ? adapterRow(at, '<span class="badge ok">Claimed · collect on board</span>')
      : at ? adapterRow(at, `<button class="btn btn-primary sm-btn" data-action="claim-adapter" data-ref="${at.ref}">Claim free</button>`)
      : `<p class="muted sm">It will appear here when you book your first flight to ${esc(countryName(country))}.</p>`;
    const friends = refs.map((r, i) => `<div class="perk-row"><div><b>${esc(r.name)}</b><div class="muted sm">${esc(r.uni)} · ${r.flown ? 'took their first flight' : 'verified · first flight pending'}</div></div>
      ${r.flown ? `<span class="badge ok">+${PERKS.referralMiles.toLocaleString()} miles</span>` : `<button class="btn btn-ghost sm-btn" data-action="ref-flown" data-i="${i}">Simulate flight</button>`}</div>`).join('');
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

      <div class="card perk">
        <div class="perk-head">${icon('share')}<div><h3>Invite friends</h3><p class="muted sm">When a friend verifies as a student with your link and takes their first flight, you both get ${PERKS.referralMiles.toLocaleString()} miles. Up to ${PERKS.referralCap} friends a year.</p></div></div>
        <div class="ref-link"><span class="mono">${esc(refLink())}</span><button class="btn btn-primary sm-btn" data-action="ref-copy">${navigator.share ? 'Share' : 'Copy'}</button></div>
        ${friends}
        <button class="btn btn-ghost block sm-btn" data-action="ref-demo">Simulate a friend joining (demo)</button>
      </div>

      <div class="card perk">
        <div class="perk-head">${icon('tag')}<div><h3>Student points</h3><p class="muted sm">Your flights earn ${PERKS.spRate} student points for every Asia Mile a normal member would earn (instead of miles). Spend them on student rewards now; when you graduate, ${Math.round(PERKS.spConvert * 100)}% of what's left becomes Asia Miles and the rest expires.</p></div></div>
        ${p.graduated
          ? `<div class="sp-row"><div><b>${(p.gradPoints || 0).toLocaleString()}</b><span>student points left</span></div>${icon('arrow')}<div><b>${(p.gradConverted || 0).toLocaleString()}</b><span>Asia Miles credited</span></div></div>`
          : `<div class="sp-row"><div><b>${spLeft(p).toLocaleString()}</b><span>student points</span></div>${icon('arrow')}<div><b>${spConverted(spLeft(p)).toLocaleString()}</b><span>Asia Miles at graduation</span></div></div>
             <button class="btn btn-ghost block sm-btn" data-action="sp-demo">Simulate a term flight (demo)</button>
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

  /* Invite link: remember who invited, then verify. */
  views.r = (code) => {
    store.set('invitedBy', String(code || '').toUpperCase());
    if (user && user.verified) { toast('You are already a verified student.'); return redirect('#/rewards'); }
    vs.returnTo = '#/rewards';
    return redirect(user ? '#/verify' : '#/signin');
  };

  /* ---------- flight chat (transports live in chat.js) ---------- */
  const CHAT = window.AureliaChat;
  let chatConn = null;
  function chatLeave() { if (chatConn) { chatConn.close(); chatConn = null; } }
  const chatName = () => store.get('chatName', '') || (user ? `${user.firstName} ${user.lastName[0]}.` : 'Guest');

  // One room per flight and day: everyone booked on CX 521 on 1 Dec lands in the same room.
  views.chat = (ref, idx) => {
    const t = findTrip(ref), i = Number(idx) || 0, s = t && t.segments[i];
    const room = s && CHAT ? CHAT.roomFor(s.number, s.dep) : '';
    if (!room) return notFound();
    return `<div class="narrow fc-page">
      ${backLink('#/trip/' + t.ref, 'Back to booking')}
      <section class="card fc" id="fcBox" data-room="${room}">
        <header class="fc-head">
          <div><p class="lab">Flight chat</p><h1>${esc(s.number)} · ${esc(s.from)} → ${esc(s.to)}</h1><p class="muted sm">${esc(fmtDate(s.dep))}</p></div>
          <span class="fc-stat" id="fcStat" data-state="connecting">Connecting…</span>
        </header>
        <div class="fc-log" id="fcLog" role="log" aria-label="Flight chat messages"></div>
        <p class="fc-as sm muted">Chatting as <b id="fcAs"></b> <button type="button" class="fc-link" id="fcRename">Change name</button></p>
        <form class="fc-name" id="fcNameForm" hidden><input id="fcName" maxlength="30" placeholder="Your name in this chat" aria-label="Your name in this chat"><button class="btn btn-ghost" type="submit">Save</button></form>
        <form class="fc-compose" id="fcForm" autocomplete="off"><input id="fcInput" maxlength="${CHAT.MAX_TEXT}" placeholder="Message your flight…" aria-label="Message" enterkeyhint="send"><button class="btn btn-primary" type="submit">Send</button></form>
      </section></div>`;
  };

  // Everything the user or the network supplies goes in through textContent, never innerHTML.
  function mountChat() {
    const box = $('#fcBox');
    if (!box || !CHAT) return;
    const room = box.dataset.room, log = $('#fcLog'), stat = $('#fcStat'), input = $('#fcInput');
    const LABEL = { connecting: 'Connecting…', ready: 'Live', reconnecting: 'Reconnecting…', error: 'Chat unavailable', local: 'Demo · this browser only' };
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let conn = null, lastSend = 0, lastState = '';

    log.appendChild(el('div', 'fc-note', CHAT.live
      ? 'Say hello to the students on your flight. Be kind and keep personal details private. Messages are not stored: you see what is sent while you are here.'
      : 'Demo mode: messages stay in this browser. Open this page in a second tab to try it. Deploy the chat service (aws/chat-deploy.sh) to talk across devices.'));

    function addMsg(m) {
      const mine = m.sid === CHAT.sid, stick = mine || nearBottom();
      const row = el('div', 'fc-msg' + (mine ? ' mine' : ''));
      row.dataset.id = m.id;
      const body = el('div', 'fc-body'), meta = el('div', 'fc-meta');
      meta.appendChild(el('b', '', mine ? 'You' : m.name));
      if (m.verified) meta.insertAdjacentHTML('beforeend', tick());          // static markup, no user data
      if (m.uni) meta.appendChild(el('span', 'fc-uni', m.uni));
      meta.appendChild(el('time', '', new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
      body.appendChild(meta);
      body.appendChild(el('p', 'fc-text', m.text));
      if (!mine) row.appendChild(el('span', 'fc-av c' + (hash(m.sid) % 6), (Array.from(m.name)[0] || '?').toUpperCase()));
      row.appendChild(body);
      log.appendChild(row);
      if (stick) log.scrollTop = log.scrollHeight;
      return row;
    }

    function push(m, row) {
      conn.send(m).catch(() => {
        row.classList.add('failed');
        const b = el('button', 'fc-fail', 'Not sent · Retry');
        b.type = 'button';
        b.addEventListener('click', () => { b.remove(); row.classList.remove('failed'); push(m, row); });
        row.querySelector('.fc-body').appendChild(b);
      });
    }

    conn = chatConn = CHAT.join(room, {
      onMessage: addMsg,
      onStatus: ({ state, detail }) => {
        stat.dataset.state = state;
        stat.textContent = LABEL[state] || state;
        stat.title = detail || '';
        if (state === 'error' && lastState !== 'error') toast('Chat: ' + (detail || 'the service is not reachable.'));
        lastState = state;
      },
    });
    conn.history.forEach(addMsg);
    log.scrollTop = log.scrollHeight;

    $('#fcAs').textContent = chatName();
    $('#fcRename').addEventListener('click', () => {
      const f = $('#fcNameForm'), n = $('#fcName');
      f.hidden = !f.hidden;
      if (!f.hidden) { n.value = chatName(); n.focus(); n.select(); }
    });
    $('#fcNameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      store.set('chatName', $('#fcName').value.trim().slice(0, 30));
      $('#fcAs').textContent = chatName();
      e.currentTarget.hidden = true;
      input.focus();
    });
    $('#fcForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (Date.now() - lastSend < 700) { toast('Slow down a little.'); return; }
      lastSend = Date.now();
      const m = CHAT.makeMessage({
        room, text, name: chatName(),
        uni: user && user.verified ? SZ.universityFromEmail(user.verified.email) : '',
        verified: !!(user && user.verified),
      });
      if (!m) return;
      input.value = '';
      push(m, addMsg(m));
      input.focus();
    });
    if (window.matchMedia && matchMedia('(pointer:fine)').matches) input.focus();
  }

  const notFound = () => `<div class="narrow"><div class="card empty">We couldn't find that page. <a href="#/home">Go home</a></div></div>`;
  function redirect(to) { setTimeout(() => { location.hash = to; }, 0); return ''; }

  /* ---------- router ---------- */
  const PROTECTED = new Set(['trips', 'profile', 'verify', 'rewards', 'perks']);
  const NAV_GROUP = { home: 'home', book: 'trips', results: 'trips', confirm: 'trips', trips: 'trips', trip: 'trips', boarding: 'trips', seats: 'trips', planner: 'trips', chat: 'trips', retrieve: 'trips', tools: 'trips', status: 'trips', baggage: 'trips', timetable: 'trips', rewards: 'rewards', perks: 'rewards', r: 'rewards', offers: 'offers', profile: 'profile', verify: 'profile', signin: 'profile' };

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
  }

  function renderChrome(active) {
    document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('on', el.dataset.nav === active));
    const ini = user ? esc(user.firstName[0] + user.lastName[0]) : '';
    const slot = $('#userSlot');
    slot.href = user ? '#/profile' : '#/signin';
    slot.innerHTML = user
      ? `<span class="avatar">${ini}${user.verified ? tick('tick-av') : ''}</span><div><b>${esc(user.firstName)} ${esc(user.lastName[0])}.${user.verified ? ' ' + tick() : ''}</b><span class="s">${currentTier() !== user.tier ? esc(currentTier()) + ' · graduation gift' : 'Student member'}</span></div>`
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
      t.checkedIn = true; saveTrips();
      if (user && user.verified && !t.studentPoints) {
        const p = perks();
        t.studentPoints = Math.round(t.segments.reduce((n, s) => n + flightMiles(s, t.cabin), 0) * PERKS.spRate);
        p.sp = (p.sp || 0) + t.studentPoints; savePerks(p); saveTrips();
        toast(`Checked in. +${t.studentPoints.toLocaleString()} student points`);
      } else toast('Checked in. Boarding pass ready.');
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
    'demo-login'(el) { const u = USERS.find((x) => x.id === (el && el.dataset && el.dataset.user)) || SEED_USER; store.set('activeUser', u.id); store.set('loggedOut', false); loadState(); toast('Signed in as ' + u.firstName); location.hash = '#/home'; render(); },
    'reset-demo'() { store.set('trips', null); store.set('prefs', null); store.set('verified', null); store.set('sales', {}); store.set('seatplans', {}); store.set('perks', {}); store.set('invitedBy', ''); store.set('loggedOut', false); Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null }); loadState(); toast('Demo data reset.'); location.hash = '#/home'; render(); },
    unverify() { store.set('verified', null); user.verified = null; Object.assign(vs, { step: 'email', email: '', demo: false, demoCode: '', msg: '', localCode: null }); toast('Verification removed.'); render(); },
    'verify-resend'() { startVerify(vs.email, true); },
    'verify-change'() { vs.step = 'email'; vs.msg = ''; render(); },
    'claim-adapter'(el) {
      const p = perks(), t = findTrip(el.dataset.ref);
      p.adapter = { email: user.verified.email, ref: t.ref, at: toISO(new Date()) };
      savePerks(p); rerender();
      flashTick(`Type ${SZ.plugFor(t.segments[0].to)} adapter claimed`);
    },
    'ref-copy'() {
      const link = refLink();
      if (navigator.share) { navigator.share({ title: 'Fly with me on Cathay', text: 'Verify as a student with my link and we both get bonus miles.', url: link }).catch(() => {}); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied'), () => toast(link));
    },
    'ref-demo'() {
      const p = perks(), refs = p.referrals || [];
      if (refs.length >= Math.min(PERKS.referralCap, SZ.FRIENDS.length)) return toast('Invite limit reached for this year.');
      const [name, uni] = SZ.FRIENDS[refs.length];
      p.referrals = [...refs, { name, uni, flown: false }];
      savePerks(p); rerender(); toast(`${name} verified with your link`);
    },
    'ref-flown'(el) {
      const p = perks(), r = p.referrals[Number(el.dataset.i)];
      r.flown = true; savePerks(p); rerender();
      toast(`+${PERKS.referralMiles.toLocaleString()} miles for you and ${r.name}`);
    },
    'sp-demo'() {
      // A typical term flight: Moscow → Hong Kong in Economy.
      const p = perks(), pts = Math.round(flightMiles({ from: 'SVO', to: 'HKG' }, 'Economy') * PERKS.spRate);
      p.sp = (p.sp || 0) + pts; savePerks(p); rerender();
      toast(`+${pts.toLocaleString()} student points`);
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
      if (f.get('szSeat')) t.studentSeat = f.get('szSeat') === 'yes';
      trips.push(t); saveTrips(); retrieved.add(ref);
      search.out = null; search.back = null; search.step = 'out'; search.to = '';
      toast(`Booked! Reference ${ref}`);
      location.hash = '#/trip/' + ref;
    } else if (id === 'signinForm') {
      const em = String(f.get('email')).trim().toLowerCase();
      const match = USERS.find((u) => (em === u.email || em.replace(/\s/g, '') === u.memberId.replace(/\s/g, '').toLowerCase()) && f.get('password') === u.password);
      const err = $('#signinErr');
      if (!match) { err.textContent = 'Those details don\'t match a demo account.'; err.hidden = false; return; }
      actions['demo-login']({ dataset: { user: match.id } });
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

  document.addEventListener('change', (e) => {
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
      if (vs.returnTo) { const to = vs.returnTo; vs.returnTo = ''; location.hash = to; return; }
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
