/* Seating HTTP API (mounted by server.js under /api/seating).
 *
 * Passenger routes need a signed-in account and a booking on that flight: the passenger is always the account
 * of the session, never an id from the request, and nobody can read another flight's seating.
 * Operations routes need an account listed in SEAT_OPS. */
'use strict';
const express = require('express');
const { auth } = require('../accounts');
const S = require('./service');

const router = express.Router();
const hits = new Map();
router.use((req, res, next) => {
  const k = req.ip || 'x', t = Date.now();
  let h = hits.get(k);
  if (!h || t > h.reset) { h = { n: 0, reset: t + 60000 }; hits.set(k, h); }
  if (++h.n > 300) return res.status(429).json({ ok: false, error: 'Too many requests.' });
  next();
});
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (t > h.reset) hits.delete(k); }, 60000).unref();
router.param('fid', (req, res, next, fid) => (S.ID_RE.test(fid) ? next() : res.status(400).json({ ok: false, error: 'Bad flight.' })));

/* Wrap a service call: SeatError → its status; anything else → 500 without internals. */
const run = (fn) => async (req, res) => {
  try { res.json({ ok: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof S.SeatError) return res.status(e.status).json({ ok: false, error: e.message, ...(e.extra || {}) });
    if (e && e.code === 'CONFLICT') return res.status(409).json({ ok: false, error: 'Seats changed at the same moment. Try again.' });
    console.error('[seating]', e); res.status(500).json({ ok: false, error: 'Something went wrong.' });
  }
};

/* ---------- passenger ---------- */
router.put('/flights/:fid/booking', auth, run((req) => S.book(req.user, req.params.fid, req.body || {})));
router.delete('/flights/:fid/booking', auth, run((req) => S.cancel(req.user.id, req.params.fid)));
router.get('/flights/:fid/seatmap', auth, run(async (req) => ({ view: await S.view(req.user.id, req.params.fid) })));
router.post('/flights/:fid/select', auth, run((req) => S.select(req.user.id, req.params.fid, (req.body || {}).seat || null)));
router.post('/flights/:fid/hold', auth, run((req) => S.hold(req.user.id, req.params.fid, String((req.body || {}).seat || ''))));
router.delete('/flights/:fid/hold', auth, run((req) => S.dropHold(req.user.id, req.params.fid)));
router.post('/flights/:fid/checkin', auth, run((req) => S.checkin(req.user.id, req.params.fid, req.body || {})));
router.post('/flights/:fid/seat-unlock', auth, run((req) => S.unlock(req.user, req.params.fid, (req.body || {}).with)));
router.get('/flights/:fid/participants', auth, run((req) => S.participants(req.user.id, req.params.fid)));
router.put('/flights/:fid/exclusions', auth, run((req) => S.setExclusions(req.user.id, req.params.fid, (req.body || {}).handles)));
/* Live updates: EventSource can't send an Authorization header, so the app gets a one-time ticket first. */
router.get('/flights/:fid/ticket', auth, run(async (req) => ({ ticket: S.ticket(req.user.id, req.params.fid) })));
router.get('/flights/:fid/stream', (req, res) => { if (!S.openStream(req.params.fid, String(req.query.ticket || ''), res)) res.status(403).end(); });

/* ---------- operations ---------- */
const ops = (req, res, next) => (S.isOps(req.user) ? next() : res.status(403).json({ ok: false, error: 'Airline operations only.' }));
router.get('/ops/flights', auth, ops, run(async () => ({ flights: S.opsQueue(), inventory: S.inventory.kind })));
router.get('/ops/flights/:fid', auth, ops, run(async (req) => ({ flight: await S.opsView(req.user, req.params.fid, req) })));
router.put('/ops/flights/:fid/zone', auth, ops, run((req) => S.opsZone(req.user, req.params.fid, req.body || {})));
router.post('/ops/flights/:fid/inventory', auth, ops, run((req) => S.opsInventory(req.user, req.params.fid, req.body || {})));
router.post('/ops/flights/:fid/assign', auth, ops, run((req) => S.opsAssign(req.user, req.params.fid, req.body || {})));
router.post('/ops/flights/:fid/reviews/:id/resolve', auth, ops, run((req) => S.opsResolve(req.user, req.params.fid, String(req.params.id), (req.body || {}).note)));

module.exports = { router };
