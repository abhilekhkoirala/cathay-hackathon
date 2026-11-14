/* Flight search for the app (mounted by server.js under /api/live): real Cathay schedules from OAG (oag.js),
 * cached per route and day; simulated (generateFlights in data.js) when OAG is not configured, fails or has no
 * flight that day. Seats left come from the seating service (seating/service.js), which owns seat inventory.
 * Storage: db.js (a JSON file). Fine for a demo; DynamoDB in production. */
'use strict';
const express = require('express');
const oag = require('./oag');

/* ---------- shared definitions (data.js) and the seating service ---------- */
const { D } = require('./seating/shared');
const seating = require('./seating/service');

/* ---------- storage (db.js: one JSON file shared with accounts.js) ---------- */
const { db, save } = require('./db');

/* ---------- validation ---------- */
const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const flightId = seating.flightId;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

/* ---------- student counts, shown only as privacy-safe bands ---------- */
const MIN_STUDENTS = 3;
const studentCount = (f) => (f ? Object.values(f.pax).filter((p) => p.student).length : 0);
const band = (n) => (n >= 10 ? '10+' : n >= 5 ? '5+' : n >= MIN_STUDENTS ? '3+' : null);
const studentBand = (f) => band(studentCount(f));

/* ---------- flights search (OAG, cached) ---------- */
const SEARCH_TTL_MS = 12 * 3600 * 1000;
function price(f, cabin) {
  const r = D.mulberry32(D.hash(f.number + f.dep));
  return Math.round(D.basePrice(f.from, f.to) * (D.CABIN_MULT[cabin] || 1) * (0.85 + r() * 0.5));
}
function estimateDur(f) { return f.durMin || Math.round((D.distanceKm(f.from, f.to) / 800) * 60 + 35) + 8; }
const seatsLeft = (f) => seating.seatsLeft(f); // from the seating service (inventory + assignments)

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
  const flights = s.flights.map((f) => ({ ...f, durMin: estimateDur(f), price: price(f, cabin), seatsLeft: seatsLeft(f), students: studentBand(db.flights[flightId(f)]) }));
  res.json({ ok: true, source: s.source, note: s.note, cached: !!s.cached, flights });
});

/* Dates near the one searched (±3 days, same route) whose flights already have the most students booked.
 * Privacy: only students who chose student seating are counted, and only as a band (3+, 5+, 10+); flights
 * with fewer than 3 students are never mentioned, so nobody can be singled out. No names, no exact counts. */
router.get('/student-dates', (req, res) => {
  const from = str(req.query.from, 3).toUpperCase(), to = str(req.query.to, 3).toUpperCase(), date = str(req.query.date, 10);
  if (!IATA_RE.test(from) || !IATA_RE.test(to) || !DATE_RE.test(date)) return res.status(400).json({ ok: false, error: 'Bad search.' });
  const day = (d) => new Date(d + 'T12:00').getTime(), base = day(date), nowMs = Date.now();
  const best = {};
  for (const f of Object.values(db.flights)) {
    const s = f.seg, d = s.dep.slice(0, 10), n = studentCount(f);
    if (s.from !== from || s.to !== to || Math.abs(day(d) - base) > 3 * 864e5 || new Date(s.dep).getTime() < nowMs || n < MIN_STUDENTS) continue;
    if (!best[d] || n > best[d].n) best[d] = { n, date: d, number: s.number, dep: s.dep };
  }
  const dates = Object.values(best).sort((a, b) => b.n - a.n || Math.abs(day(a.date) - base) - Math.abs(day(b.date) - base))
    .map(({ n, ...x }) => ({ ...x, students: band(n) }));
  res.json({ ok: true, dates });
});

/* Seats, bookings, check-in and the Student Zone moved to the seating service (/api/seating, seating/*.js):
 * authenticated, per passenger and per flight. The old public per-flight endpoints are gone on purpose. */

module.exports = { router, _db: () => db, _schedule: schedule, _save: save };
