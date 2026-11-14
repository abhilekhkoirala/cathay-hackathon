/* Student flight chat (mounted by server.js under /api/chat and /api/mod).
 *
 * Every rule is enforced HERE, on the server, never only in the browser:
 *  - who may join: a signed-in account, verified as a student by the server (university email + approved student ID,
 *    valid on the departure date), aged 18+
 *    on the departure date, with an active booking on that flight, not removed for conduct;
 *  - when: from 7 days before departure until 48 h after arrival (scheduled arrival in this prototype);
 *  - group conversation only: one room per flight, no private or one-to-one messages;
 *  - privacy: other members see a first name and, only if the student opted in when booking, a university.
 *    Never a surname, email, seat, booking reference or seating preference;
 *  - reporting, moderation with severity levels, two-strike rule (team policy, pending legal review):
 *    1st confirmed violation = warning, 2nd = booking cancelled with no refund;
 *  - retention: ordinary messages are deleted 48 h after arrival; evidence for a report is copied to a
 *    separate store with restricted (moderator-only) access and its own retention period.
 * Storage: db.js. Real-time delivery: Server-Sent Events, opened with a short-lived one-time ticket. */
'use strict';
const crypto = require('crypto');
const express = require('express');
const { db, save } = require('./db');
const { auth, ageOn, isModerator } = require('./accounts');
const live = require('./live');
const studentVerify = require('./student-verify');

const OPEN_BEFORE_MS = 7 * 24 * 3600 * 1000;
const DELETE_AFTER_MS = 48 * 3600 * 1000;
const EVIDENCE_DAYS = 180;          // kept only while an investigation or legal obligation needs it (proposal)
const DISMISSED_EVIDENCE_DAYS = 30;
const MAX_TEXT = 500;
const CATEGORIES = ['harassment', 'sexual', 'discrimination', 'bullying', 'threat', 'impersonation', 'doxxing', 'spam', 'solicitation', 'other'];
const SEVERITY = ['low', 'medium', 'high', 'critical'];

db.chat = db.chat || {};
const C = db.chat;
C.rooms = C.rooms || {};        // flightId -> { members: {uid: {joinedAt, left}}, messages: [] }
C.reports = C.reports || [];    // { id, fid, msgId, reporter, reported, category, note, status, severity, at, decidedAt, decision }
C.evidence = C.evidence || {};  // reportId -> { messages: [...], expiresAt, legalHold }
C.strikes = C.strikes || {};    // uid -> [{ reportId, fid, at, severity }]
C.removed = C.removed || {};    // fid -> { uid: reason }

const rid = () => crypto.randomBytes(8).toString('hex');
const now = () => Date.now();
const room = (fid) => (C.rooms[fid] = C.rooms[fid] || { members: {}, messages: [] });
const times = (f) => {
  const dep = new Date(f.seg.dep).getTime(), arr = new Date(f.seg.arr).getTime();
  return { opens: dep - OPEN_BEFORE_MS, deletes: (arr > dep ? arr : dep + 3600e3) + DELETE_AFTER_MS };
};

/* Can this user take part in this flight's chat? Returns '' or the reason they can't. */
function ineligible(u, fid) {
  const f = db.flights[fid];
  if (!f) return 'Unknown flight.';
  const elig = studentVerify.eligibleOn(u, f.seg.dep);
  if (!elig.ok) return elig.reason;
  if ((C.removed[fid] || {})[u.id]) return 'You have been removed from this chat for not following the student chat guidelines.';
  if (ageOn(u.dob, f.seg.dep) < 18) return 'The student chat is for students aged 18 and over.';
  if (!f.pax[u.id]) return 'Only passengers booked on this flight can join its chat.';
  const t = times(f);
  if (now() < t.opens) return `The chat opens 7 days before departure, on ${new Date(t.opens).toISOString().slice(0, 10)}.`;
  if (now() > t.deletes) return 'This chat has closed and its messages have been deleted.';
  return '';
}

/* What other members may see about a message author (data minimisation). */
function authorView(fid, uid) {
  const u = db.users[uid] || {}, p = (db.flights[fid] || { pax: {} }).pax[uid] || {};
  return { author: live.pseudo(uid, fid), name: u.firstName || 'Student', uni: p.share ? p.uni : '' };
}
const publicMsg = (fid, m) => ({ id: m.id, ts: m.ts, text: m.text, ...authorView(fid, m.uid) });

/* ---------- real-time (SSE) ---------- */
const streams = new Map(); // fid -> Set({ res, uid })
const tickets = new Map(); // ticket -> { uid, fid, exp }
function send(fid, event, data, onlyUid) {
  for (const s of streams.get(fid) || []) if (!onlyUid || s.uid === onlyUid) s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function kick(fid, uid, reason) {
  for (const s of streams.get(fid) || []) if (s.uid === uid) { s.res.write(`event: removed\ndata: ${JSON.stringify({ reason })}\n\n`); s.res.end(); }
}
setInterval(() => { for (const set of streams.values()) for (const s of set) s.res.write(': ping\n\n'); }, 20000).unref();

/* ---------- retention ---------- */
function purge() {
  let changed = false;
  for (const [fid, r] of Object.entries(C.rooms)) {
    const f = db.flights[fid];
    if (!f || now() > times(f).deletes) { delete C.rooms[fid]; changed = true; for (const s of streams.get(fid) || []) s.res.end(); streams.delete(fid); }
    else if (!r) delete C.rooms[fid];
  }
  for (const [id, e] of Object.entries(C.evidence)) if (!e.legalHold && now() > e.expiresAt) { delete C.evidence[id]; changed = true; }
  for (const [t, v] of tickets) if (v.exp < now()) tickets.delete(t);
  if (changed) save();
}
setInterval(purge, 10 * 60 * 1000).unref();

/* ---------- participant routes ---------- */
const router = express.Router();
const rate = new Map(); // uid -> [timestamps]
const FID = /^[A-Z0-9]{2,8}-\d{4}-\d{2}-\d{2}$/;
router.param('fid', (req, res, next, fid) => (FID.test(fid) ? next() : res.status(400).json({ ok: false, error: 'Bad flight.' })));

router.get('/chat/:fid/status', auth, (req, res) => {
  const fid = req.params.fid, f = db.flights[fid], why = ineligible(req.user, fid);
  const m = (C.rooms[fid] || { members: {} }).members[req.user.id];
  const strikes = (C.strikes[req.user.id] || []).length;
  res.json({ ok: true, eligible: !why, reason: why, member: Boolean(m && !m.left), strikes,
    opens: f ? new Date(times(f).opens).toISOString() : null, deletes: f ? new Date(times(f).deletes).toISOString() : null });
});

/* Joining is voluntary and requires accepting the guidelines. */
router.post('/chat/:fid/join', auth, (req, res) => {
  const fid = req.params.fid, why = ineligible(req.user, fid);
  if (why) return res.status(403).json({ ok: false, error: why });
  if (!(req.body && req.body.acceptGuidelines === true)) return res.status(400).json({ ok: false, error: 'Please accept the student chat guidelines to join.' });
  room(fid).members[req.user.id] = { joinedAt: new Date().toISOString(), left: false };
  save();
  res.json({ ok: true });
});

router.post('/chat/:fid/leave', auth, (req, res) => {
  const r = C.rooms[req.params.fid], m = r && r.members[req.user.id];
  if (m) { m.left = true; save(); kick(req.params.fid, req.user.id, 'You left the chat.'); }
  res.json({ ok: true });
});

const memberOk = (u, fid) => { const why = ineligible(u, fid); const m = (C.rooms[fid] || { members: {} }).members[u.id]; return why || (!m || m.left ? 'Join the chat first.' : ''); };

/* History + a one-time ticket to open the live stream (EventSource can't send an Authorization header). */
router.get('/chat/:fid/messages', auth, (req, res) => {
  const fid = req.params.fid, why = memberOk(req.user, fid);
  if (why) return res.status(403).json({ ok: false, error: why });
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { uid: req.user.id, fid, exp: now() + 60000 });
  res.json({ ok: true, me: live.pseudo(req.user.id, fid), messages: room(fid).messages.slice(-200).map((m) => publicMsg(fid, m)), ticket,
    warning: (C.strikes[req.user.id] || []).length === 1 });
});

router.get('/chat/:fid/stream', (req, res) => {
  const fid = req.params.fid, t = tickets.get(String(req.query.ticket || ''));
  tickets.delete(String(req.query.ticket || ''));
  if (!t || t.fid !== fid || t.exp < now() || memberOk(db.users[t.uid] || {}, fid)) return res.status(403).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const s = { res, uid: t.uid };
  if (!streams.has(fid)) streams.set(fid, new Set());
  streams.get(fid).add(s);
  req.on('close', () => streams.get(fid) && streams.get(fid).delete(s));
});

router.post('/chat/:fid/messages', auth, (req, res) => {
  const fid = req.params.fid, why = memberOk(req.user, fid);
  if (why) return res.status(403).json({ ok: false, error: why });
  const text = String((req.body && req.body.text) || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, MAX_TEXT);
  if (!text) return res.status(400).json({ ok: false, error: 'Empty message.' });
  const ts = (rate.get(req.user.id) || []).filter((x) => now() - x < 60000);
  if (ts.length >= 20 || (ts.length && now() - ts[ts.length - 1] < 800)) return res.status(429).json({ ok: false, error: 'Slow down a little.' });
  rate.set(req.user.id, [...ts, now()]);
  const m = { id: rid(), uid: req.user.id, text, ts: new Date().toISOString() };
  room(fid).messages.push(m);
  if (room(fid).messages.length > 1000) room(fid).messages.shift();
  save();
  send(fid, 'message', publicMsg(fid, m));
  res.json({ ok: true, message: publicMsg(fid, m) });
});

/* Report a message. The reported person is never told who reported them (protection against retaliation).
 * Evidence (the message and its context) is copied to a separate, moderator-only store. */
router.post('/chat/:fid/report', auth, (req, res) => {
  const fid = req.params.fid, b = req.body || {}, why = memberOk(req.user, fid);
  if (why) return res.status(403).json({ ok: false, error: why });
  const msgs = room(fid).messages, i = msgs.findIndex((m) => m.id === b.messageId);
  if (i < 0) return res.status(404).json({ ok: false, error: 'Message not found.' });
  if (msgs[i].uid === req.user.id) return res.status(400).json({ ok: false, error: "You can't report your own message." });
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  const r = { id: rid(), fid, msgId: msgs[i].id, reporter: req.user.id, reported: msgs[i].uid, category, note: String(b.note || '').slice(0, 500),
    status: 'open', severity: ['threat', 'sexual'].includes(category) ? 'high' : 'medium', at: new Date().toISOString() };
  C.reports.push(r);
  C.evidence[r.id] = { messages: msgs.slice(Math.max(0, i - 10), i + 3).map((m) => ({ ...m, name: (db.users[m.uid] || {}).firstName })), expiresAt: now() + EVIDENCE_DAYS * 864e5, legalHold: false };
  save();
  res.json({ ok: true, message: 'Thanks. A moderator will review this. The person will not be told who reported them.' });
});

/* Privately ask not to be seated next to the author of a message. Never disclosed to anyone. */
router.post('/chat/:fid/avoid', auth, (req, res) => {
  const fid = req.params.fid, why = memberOk(req.user, fid), f = db.flights[fid];
  if (why) return res.status(403).json({ ok: false, error: why });
  const m = room(fid).messages.find((x) => x.id === (req.body || {}).messageId);
  if (!m || m.uid === req.user.id) return res.status(400).json({ ok: false, error: 'Not possible for this message.' });
  f.avoid = f.avoid || {};
  const list = f.avoid[req.user.id] = f.avoid[req.user.id] || [];
  if (!list.includes(m.uid)) list.push(m.uid);
  live.replan(f); save(); live.broadcast(fid);
  res.json({ ok: true, message: "Done. We won't seat you next to this person. Nobody is told." });
});

/* ---------- moderation (accounts listed in MODERATORS) ---------- */
const mod = (req, res, next) => (isModerator(req.user) ? next() : res.status(403).json({ ok: false, error: 'Moderators only.' }));
router.get('/mod/reports', auth, mod, (req, res) => {
  res.json({ ok: true, reports: C.reports.slice().reverse().map((r) => ({
    ...r, reporter: undefined, reportedName: (db.users[r.reported] || {}).firstName, strikes: (C.strikes[r.reported] || []).length,
    flight: (db.flights[r.fid] || {}).seg, evidence: (C.evidence[r.id] || {}).messages || [],
  })) });
});

/* decision: 'dismiss' | 'warn' (confirmed violation) ; severity: low|medium|high|critical ; legalHold: keep evidence. */
router.post('/mod/reports/:id', auth, mod, (req, res) => {
  const r = C.reports.find((x) => x.id === req.params.id), b = req.body || {};
  if (!r) return res.status(404).json({ ok: false, error: 'Unknown report.' });
  if (r.status !== 'open') return res.status(409).json({ ok: false, error: 'Already decided.' });
  r.severity = SEVERITY.includes(b.severity) ? b.severity : r.severity;
  r.decidedAt = new Date().toISOString(); r.decidedBy = req.user.id;
  const ev = C.evidence[r.id];
  if (ev) ev.legalHold = Boolean(b.legalHold);
  let outcome = 'dismissed';
  if (b.decision === 'dismiss') {
    r.status = 'dismissed';
    if (ev) ev.expiresAt = now() + DISMISSED_EVIDENCE_DAYS * 864e5;
  } else {
    r.status = 'confirmed';
    // Remove the message for everyone.
    const rm = C.rooms[r.fid];
    if (rm) { rm.messages = rm.messages.filter((m) => m.id !== r.msgId); send(r.fid, 'deleted', { id: r.msgId }); }
    const list = C.strikes[r.reported] = C.strikes[r.reported] || [];
    list.push({ reportId: r.id, fid: r.fid, at: r.decidedAt, severity: r.severity });
    if (list.length === 1) {
      outcome = 'warning';
      send(r.fid, 'warning', { text: 'A moderator removed one of your messages for breaking the student chat guidelines. This is your warning: a second confirmed violation cancels your booking without refund.' }, r.reported);
      if (r.severity === 'critical') { // threats / safety: out of the chat now, and a human security review
        outcome = 'warning + removed from chat + escalated';
        (C.removed[r.fid] = C.removed[r.fid] || {})[r.reported] = r.id;
        r.escalated = 'Cathay security team';
        kick(r.fid, r.reported, 'You have been removed from this chat pending a safety review.');
      }
    } else {
      // 2nd confirmed violation (or a critical one): removed from the chat and booking cancelled, no refund (team policy).
      outcome = 'cancelled';
      (C.removed[r.fid] = C.removed[r.fid] || {})[r.reported] = r.id;
      const f = db.flights[r.fid];
      if (f && f.pax[r.reported]) { delete f.pax[r.reported]; live.replan(f); live.broadcast(r.fid); }
      const data = db.userData[r.reported] || {};
      (data.trips || []).forEach((t) => {
        if (t && t.status === 'Confirmed' && (t.segments || []).some((s) => live.flightId(s) === r.fid)) {
          t.status = 'Cancelled'; t.cancelReason = 'Cancelled for breaking the student chat guidelines (second confirmed violation). No refund.';
        }
      });
      kick(r.fid, r.reported, 'You have been removed from this chat and your booking on this flight was cancelled for breaking the student chat guidelines.');
      if (r.severity === 'critical') r.escalated = 'Cathay security team';
    }
  }
  r.outcome = outcome;
  save();
  res.json({ ok: true, outcome });
});

module.exports = { router, purge, _C: C };
