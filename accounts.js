/* Accounts for the live app (mounted by server.js under /api): sign up, log in, and each user's app data
 * (trips, preferences, student verification, perks) so the same account works on any phone or laptop.
 * Passwords are hashed with scrypt and a per-user salt; sessions are random 32-byte tokens (30 days).
 * Storage: db.js (JSON file). Demo-grade: no email confirmation, no password reset. */
'use strict';
const crypto = require('crypto');
const express = require('express');
const { db, save } = require('./db');

const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_DATA = 200 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function checkPw(pw, u) {
  const a = Buffer.from(hashPw(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rand = (n, a = ALPHA) => Array.from(crypto.randomBytes(n), (b) => a[b % a.length]).join('');
const byEmail = (email) => Object.values(db.users).find((u) => u.email === email);
const byCode = (code) => Object.values(db.users).find((u) => u.refCode === code);

function newRefCode(firstName) {
  const base = firstName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'CATHAY';
  let code;
  do { code = `${base}-${rand(4)}`; } while (byCode(code));
  return code;
}
function newMemberId() {
  let id;
  do { id = `CS ${new Date().getFullYear()} ${rand(4, '0123456789')}`; } while (Object.values(db.users).some((u) => u.memberId === id));
  return id;
}
/* What the browser may see about its own account. */
const publicUser = (u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, dob: u.dob, memberId: u.memberId, refCode: u.refCode, invitedBy: u.invitedBy || '', memberSince: u.createdAt.slice(0, 4), student: u.student || null, moderator: isModerator(u) });

function startSession(res, u) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { uid: u.id, exp: Date.now() + SESSION_MS };
  save();
  res.json({ ok: true, token, user: publicUser(u), data: db.userData[u.id] || {} });
}
/* The signed-in user for a request (Bearer token), or null. */
function userFromReq(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = /^[a-f0-9]{64}$/.test(token) && db.sessions[token];
  return s && s.exp > Date.now() && db.users[s.uid] ? { user: db.users[s.uid], token } : null;
}
function auth(req, res, next) {
  const who = userFromReq(req);
  if (!who) return res.status(401).json({ ok: false, error: 'Please sign in again.' });
  req.user = who.user; req.token = who.token;
  next();
}
/* Student status as recorded by the SERVER when the university-email code was confirmed (the browser's copy is not trusted). */
function recordStudent(uid, email) {
  if (!db.users[uid]) return;
  db.users[uid].student = { email, at: new Date().toISOString() };
  save();
}
const ageOn = (dob, when) => {
  const b = new Date(dob), d = new Date(when);
  let a = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
  return a;
};
const isModerator = (u) => String(process.env.MODERATORS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(u.email);

const router = express.Router();
const hits = new Map();
const limit = (max) => (req, res, next) => {
  const k = (req.ip || 'x') + req.path, now = Date.now();
  let h = hits.get(k);
  if (!h || now > h.reset) { h = { n: 0, reset: now + 15 * 60 * 1000 }; hits.set(k, h); }
  if (++h.n > max) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
  next();
};
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now > h.reset) hits.delete(k);
  let changed = false;
  for (const [t, s] of Object.entries(db.sessions)) if (s.exp < now) { delete db.sessions[t]; changed = true; }
  if (changed) save();
}, 10 * 60 * 1000).unref();

router.post('/auth/signup', limit(20), (req, res) => {
  const b = req.body || {};
  const firstName = str(b.firstName, 30), lastName = str(b.lastName, 40), email = str(b.email, 254).toLowerCase();
  const password = String(b.password || ''), dob = str(b.dob, 10), invite = str(b.invite, 20).toUpperCase();
  if (!firstName || !lastName) return res.status(400).json({ ok: false, error: 'Enter your first and last name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ ok: false, error: 'Use a password of at least 8 characters.' });
  const born = new Date(dob);
  if (!DATE_RE.test(dob) || Number.isNaN(+born) || born > new Date() || born.getFullYear() < 1900) return res.status(400).json({ ok: false, error: 'Enter your date of birth.' });
  if (byEmail(email)) return res.status(409).json({ ok: false, error: 'An account with this email already exists. Sign in instead.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'), firstName, lastName, email, dob, salt, hash: hashPw(password, salt),
    memberId: newMemberId(), refCode: newRefCode(firstName), createdAt: new Date().toISOString(),
    invitedBy: invite && byCode(invite) ? invite : '',
  };
  db.users[u.id] = u;
  db.userData[u.id] = {};
  startSession(res, u);
});

router.post('/auth/login', limit(30), (req, res) => {
  const b = req.body || {};
  const id = str(b.email, 254).toLowerCase(), pw = String(b.password || '');
  const u = byEmail(id) || Object.values(db.users).find((x) => x.memberId.replace(/\s/g, '').toLowerCase() === id.replace(/\s/g, ''));
  if (!u || !checkPw(pw, u)) return res.status(401).json({ ok: false, error: "Those details don't match an account." });
  startSession(res, u);
});

router.post('/auth/logout', auth, (req, res) => { delete db.sessions[req.token]; save(); res.json({ ok: true }); });

router.get('/me', auth, (req, res) => res.json({ ok: true, user: publicUser(req.user), data: db.userData[req.user.id] || {} }));

router.put('/me/data', express.json({ limit: '220kb' }), auth, (req, res) => {
  const data = req.body && req.body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ ok: false, error: 'Bad data.' });
  const clean = {};
  for (const k of ['trips', 'prefs', 'verified', 'perks', 'chatName']) if (k in data) clean[k] = data[k];
  if (JSON.stringify(clean).length > MAX_DATA) return res.status(413).json({ ok: false, error: 'Too much data.' });
  // Cancellations made by the server (chat conduct) can't be undone by a device sending an older copy.
  const prev = (db.userData[req.user.id] || {}).trips || [];
  prev.filter((t) => t && t.cancelReason).forEach((old) => {
    const t = Array.isArray(clean.trips) && clean.trips.find((x) => x && x.ref === old.ref);
    if (t) { t.status = old.status; t.cancelReason = old.cancelReason; } else if (Array.isArray(clean.trips)) clean.trips.push(old);
  });
  db.userData[req.user.id] = clean;
  save();
  res.json({ ok: true });
});

/* Friends who signed up with my invite code. Only a first-name initial is shared. */
router.get('/me/referrals', auth, (req, res) => {
  const list = Object.values(db.users).filter((u) => u.invitedBy && u.invitedBy === req.user.refCode)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((u) => {
      const d = db.userData[u.id] || {};
      return { name: u.firstName[0] + '.', joined: u.createdAt.slice(0, 10), verified: Boolean(d.verified), flown: (d.trips || []).some((t) => t && t.checkedIn) };
    });
  res.json({ ok: true, referrals: list });
});

module.exports = { router, auth, userFromReq, recordStudent, ageOn, isModerator };
