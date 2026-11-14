/* Live demo: shared flights and seats for every device (mounted by server.js under /api/live).
 *
 * - Flights: real Cathay schedules from OAG (oag.js), cached per route and day; simulated
 *   (generateFlights in data.js) when OAG is not configured, fails or has no flight that day.
 * - Seats: one shared record per flight. Booking, check-in and the planner all write here, and every
 *   open phone gets the new state within a second over Server-Sent Events.
 * - Student seating runs the SAME planner as the app (student-zone.js, loaded below), so real students
 *   booked on different phones are seated together with the simulated ones.
 * Storage: db.js (a JSON file, written atomically). Fine for a demo; DynamoDB in production. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const oag = require('./oag');
const { auth } = require('./accounts'); // who is booking comes from the login, never from the request body

/* ---------- reuse the browser code (data.js + student-zone.js) without copying it ---------- */
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['data.js', 'student-zone.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
const D = sandbox.window.AURELIA, SZ = sandbox.window.AURELIA_SZ;

/* ---------- storage (db.js: one JSON file shared with accounts.js) ---------- */
const { db, save } = require('./db');

/* ---------- validation ---------- */
const ID_RE = /^[A-Z0-9]{2,8}-\d{4}-\d{2}-\d{2}$/;
const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SEAT_RE = /^\d{1,2}[A-K]$/;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const flightId = (seg) => seg.number.replace(/\s+/g, '') + '-' + seg.dep.slice(0, 10);

function cleanSeg(s) {
  if (!s || typeof s !== 'object') return null;
  const seg = {
    number: str(s.number, 10).toUpperCase(), from: str(s.from, 3).toUpperCase(), to: str(s.to, 3).toUpperCase(),
    dep: str(s.dep, 16), arr: str(s.arr, 16), aircraft: str(s.aircraft, 30) || 'A350-900',
    durMin: Math.max(0, Math.min(2000, Number(s.durMin) || 0)), stops: Number(s.stops) ? 1 : 0,
  };
  if (!/^[A-Z0-9]{2} ?\d{1,4}[A-Z]?$/.test(seg.number) || !IATA_RE.test(seg.from) || !IATA_RE.test(seg.to) || !ISO_RE.test(seg.dep) || !ISO_RE.test(seg.arr)) return null;
  return seg;
}

/* ---------- flight state + planner ---------- */
function getFlight(id, seg) {
  let f = db.flights[id];
  if (!f && seg) { f = db.flights[id] = { id, seg, sales: {}, pax: {}, order: 0, plan: {}, log: [], v: 0 }; replan(f); save(); }
  return f || null;
}
/* Privacy: other devices never see a passenger's name or account id, only a per-flight pseudonym
 * (the owner's phone computes its own the same way), and a student's university only if they chose to share it. */
const pseudo = (uid, fid) => 'p' + D.hash(uid + '|' + fid).toString(36);
const uniTag = (uni) => (uni ? 'u' + D.hash(String(uni).toLowerCase()).toString(36) : '');
const CAB = (p) => p.cabin || 'Economy';
const studentsOf = (f) => Object.entries(f.pax).filter(([, p]) => p.student).sort((a, b) => a[1].n - b[1].n)
  .map(([uid, p]) => ({ id: pseudo(uid, f.id), name: 'Student', uni: p.uni, share: !!p.share, year: '', field: '', locked: p.locked || null }));
/* Seats taken in one cabin (the planner only uses Economy). */
const soldOf = (f, cabin = 'Economy') => Object.keys(f.sales).filter((s) => SZ.allSeats(SZ.cabin(f.seg, cabin)).includes(s))
  .concat(Object.values(f.pax).filter((p) => !p.student && p.seat && CAB(p) === cabin).map((p) => p.seat));

/* Re-runs the student planner with everything sold so far; only students whose group broke move. */
function replan(f) {
  const apart = Object.entries(f.avoid || {}).flatMap(([a, list]) => list.map((b) => [pseudo(a, f.id), pseudo(b, f.id)])); // [asker, other]: the planner moves the other person, never the one who asked
  const p = SZ.plan(f.seg, { real: studentsOf(f), sold: soldOf(f), prev: f.plan, apart });
  const moved = p.moved.map((m) => `${f.plan[m.id]} → ${p.seatOf[m.id]}`);
  f.plan = { ...p.seatOf };
  f.v++;
  return { p, moved };
}

/* Can `seat` be bought or chosen by `by`? Planned (not checked-in) student seats can: that's what makes students move. */
function seatFree(f, seat, by, cabin = 'Economy') {
  if (!SZ.allSeats(SZ.cabin(f.seg, cabin)).includes(seat)) return 'No such seat in this cabin.';
  if (SZ.paidSeats(f.seg, cabin).has(seat)) return 'That seat is already taken.';
  if (f.sales[seat]) return 'That seat was just taken.';
  for (const [id, p] of Object.entries(f.pax)) {
    if (id === by) continue;
    if ((!p.student && p.seat === seat) || (p.student && p.locked === seat)) return 'That seat was just taken.';
  }
  return '';
}

const view = (id, f) => ({
  id, v: f.v, seg: f.seg, sales: Object.keys(f.sales), plan: f.plan, log: f.log.slice(0, 12),
  pax: Object.entries(f.pax).sort((a, b) => a[1].n - b[1].n).map(([uid, p]) => ({
    id: pseudo(uid, id), cabin: CAB(p), student: !!p.student, share: !!p.share,
    uniTag: p.student ? uniTag(p.uni) : '', uni: p.student && p.share ? p.uni : '', seat: p.seat || null, locked: p.locked || null,
  })),
});

/* ---------- live updates (Server-Sent Events) ---------- */
const listeners = new Map(); // flight id -> Set(res)
function broadcast(id) {
  const f = db.flights[id], set = listeners.get(id);
  if (!f || !set) return;
  const msg = `data: ${JSON.stringify(view(id, f))}\n\n`;
  for (const res of set) res.write(msg);
}
setInterval(() => { for (const set of listeners.values()) for (const res of set) res.write(': ping\n\n'); }, 20000).unref();

/* ---------- flights search (OAG, cached) ---------- */
const SEARCH_TTL_MS = 12 * 3600 * 1000;
function price(f, cabin) {
  const r = D.mulberry32(D.hash(f.number + f.dep));
  return Math.round(D.basePrice(f.from, f.to) * (D.CABIN_MULT[cabin] || 1) * (0.85 + r() * 0.5));
}
function estimateDur(f) { return f.durMin || Math.round((D.distanceKm(f.from, f.to) / 800) * 60 + 35) + 8; }
function seatsLeft(f) {
  const st = db.flights[flightId(f)];
  const c = SZ.cabin(f), taken = SZ.paidSeats(f).size + (st ? soldOf(st).length : 0);
  return Math.max(0, Math.min(9, SZ.allSeats(c).length - taken));
}

async function schedule(from, to, date) {
  const key = `${from}-${to}-${date}`, hit = db.searches[key];
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return { ...hit, cached: true };
  let flights = [], source = 'oag', note = '';
  try {
    flights = await oag.searchFlights(from, to, date);
    console.log(`[live] OAG ${key}: ${flights.length} flights`);
  } catch (e) {
    source = 'sim'; note = e.message;
    console.warn(`[live] OAG ${key} failed (${e.message}); using simulated schedule`);
  }
  if (!flights.length) {
    if (source === 'oag') note = 'No Cathay flight on this route that day (OAG)';
    source = 'sim';
    flights = D.generateFlights(from, to, date, 'Economy').map(({ price: _p, seatsLeft: _s, ...f }) => f);
  }
  const entry = { at: Date.now(), source, note, flights };
  if (source === 'oag') { db.searches[key] = entry; save(); } // only real answers are cached; a failure retries next time
  return entry;
}

/* ---------- routes ---------- */
const router = express.Router();
const hits = new Map();
router.use((req, res, next) => { // generous limit: phones sync and poll often during a demo
  const ip = req.ip || 'x', now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) { h = { n: 0, reset: now + 60000 }; hits.set(ip, h); }
  if (++h.n > 300) return res.status(429).json({ ok: false, error: 'Too many requests.' });
  next();
});

router.get('/health', (_req, res) => res.json({ ok: true, oag: Boolean(process.env.OAG_KEY), flights: Object.keys(db.flights).length }));

router.get('/flights', async (req, res) => {
  const from = str(req.query.from, 3).toUpperCase(), to = str(req.query.to, 3).toUpperCase(), date = str(req.query.date, 10);
  const cabin = D.CABINS.includes(req.query.cabin) ? req.query.cabin : 'Economy';
  if (!IATA_RE.test(from) || !IATA_RE.test(to) || !DATE_RE.test(date)) return res.status(400).json({ ok: false, error: 'from, to (IATA) and date (YYYY-MM-DD) are required.' });
  const s = await schedule(from, to, date);
  const flights = s.flights.map((f) => ({ ...f, durMin: estimateDur(f), price: price(f, cabin), seatsLeft: seatsLeft(f) }));
  res.json({ ok: true, source: s.source, note: s.note, cached: !!s.cached, flights });
});

router.post('/flights/:id/ensure', (req, res) => {
  const id = req.params.id, seg = cleanSeg(req.body && req.body.seg);
  if (!ID_RE.test(id) || !seg || flightId(seg) !== id) return res.status(400).json({ ok: false, error: 'Bad flight.' });
  res.json({ ok: true, state: view(id, getFlight(id, seg)) });
});

router.get('/flights/:id', (req, res) => {
  const f = ID_RE.test(req.params.id) && db.flights[req.params.id];
  if (!f) return res.status(404).json({ ok: false, error: 'Unknown flight.' });
  res.json({ ok: true, state: view(req.params.id, f) });
});

router.get('/flights/:id/events', (req, res) => {
  const id = req.params.id, f = ID_RE.test(id) && db.flights[id];
  if (!f) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 2000\ndata: ${JSON.stringify(view(id, f))}\n\n`);
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(res);
  req.on('close', () => listeners.get(id).delete(res));
});

/* The signed-in user's booking on this flight (idempotent: phones re-send it whenever their trip changes).
 * body: { seg, cabin, student: { uni, share } | null, seat, locked, active } */
router.post('/flights/:id/pax', auth, (req, res) => {
  const id = req.params.id, b = req.body || {};
  const f = ID_RE.test(id) && getFlight(id, cleanSeg(b.seg));
  if (!f) return res.status(400).json({ ok: false, error: 'Bad flight.' });
  const uid = req.user.id, cabin = D.CABINS.includes(b.cabin) ? b.cabin : 'Economy';
  if (((db.chat || {}).removed || {})[id] && db.chat.removed[id][uid] && ((db.chat.strikes || {})[uid] || []).length >= 2) {
    return res.status(403).json({ ok: false, error: 'This booking was cancelled for breaking the student chat guidelines.' });
  }
  const old = f.pax[uid];
  if (b.active === false) {
    if (old) { delete f.pax[uid]; replan(f); save(); broadcast(id); }
    return res.json({ ok: true, state: view(id, f) });
  }
  const student = Boolean(b.student && typeof b.student === 'object') && cabin === 'Economy';
  const seat = SEAT_RE.test(b.seat) ? b.seat : null, locked = SEAT_RE.test(b.locked) ? b.locked : null;
  const next = {
    n: old ? old.n : ++f.order, cabin, student, uni: student ? str(b.student.uni, 60) : '', share: student && b.student.share === true,
    seat: student ? null : seat, locked: student ? locked : null,
  };
  const want = next.seat || next.locked;
  const had = old && (old.seat || old.locked);
  if (want && want !== had) {
    const planned = student && f.plan[pseudo(uid, id)] === want;
    const why = planned ? '' : seatFree(f, want, uid, cabin);
    if (why) return res.status(409).json({ ok: false, error: why, state: view(id, f) });
  }
  if (old && JSON.stringify(old) === JSON.stringify(next)) return res.json({ ok: true, state: view(id, f) });
  f.pax[uid] = next;
  if (want && f.sales[want]) delete f.sales[want];
  const tookPlanned = !student && want && want !== had && Object.values(f.plan).includes(want);
  const { moved } = replan(f);
  if (tookPlanned || (moved.length && !student)) { // a real passenger took a seat planned for a student: say who moved (no names)
    const n = moved.length;
    f.log.unshift(`A passenger chose ${want}${tookPlanned ? ' (planned for a student)' : ''}. ${n ? `Re-seated ${n} student${n > 1 ? 's' : ''}: ${moved.join(', ')}.` : 'No student had to move.'}`);
    f.log = f.log.slice(0, 30);
  }
  save(); broadcast(id);
  res.json({ ok: true, state: view(id, f) });
});

module.exports = { router, flightId, pseudo, replan, broadcast, _db: () => db, _schedule: schedule };
