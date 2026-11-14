/* Aurelia Air demo — student verification backend.
 * Sends a 6-digit code to a .edu address via SMTP (e.g. Amazon SES SMTP) and confirms it.
 * Secrets come from environment variables / .env — never from the frontend.
 * Without SMTP configured it runs in demo mode and returns the code in the response. */
'use strict';
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }
const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const BRAND = 'Aurelia Student Verify';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM
);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true for 465, false for 587 (STARTTLS)
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

/* A .edu address: the domain must contain an "edu" label after the first label
 * (mit.edu, cuhk.edu.hk, student.unsw.edu.au ...). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEduEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) return false;
  const labels = email.split('@')[1].toLowerCase().split('.');
  return labels.slice(1).includes('edu');
}

const mask = (e) => {
  const [u, d] = e.split('@');
  return u[0] + '•'.repeat(Math.max(1, u.length - 2)) + u.slice(-1) + '@' + d;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- in-memory state (fine for a demo; use Redis/DynamoDB for real) ---------- */
const pending = new Map(); // email -> { salt, hash, expires, attempts, lastSent, sends: [ts] }
const hits = new Map(); // ip -> { n, reset }

const hashCode = (code, salt) => crypto.createHmac('sha256', salt).update(code).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown', now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) { h = { n: 0, reset: now + 15 * 60 * 1000 }; hits.set(ip, h); }
  if (++h.n > 40) return res.status(429).json({ ok: false, error: 'Too many requests. Try again in a few minutes.' });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now > v.expires + 60000) pending.delete(k);
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60 * 1000).unref();

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2kb' }));

const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, mail: smtpConfigured ? 'smtp' : 'demo' }));

app.post('/api/verify/start', rateLimit, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const firstName = String((req.body && req.body.firstName) || '').slice(0, 40);
  if (!isEduEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Use your university email — the domain must include .edu (e.g. name@uni.edu or name@uni.edu.hk).' });
  }
  const now = Date.now();
  const prev = pending.get(email);
  const sends = ((prev && prev.sends) || []).filter((t) => now - t < 3600 * 1000);
  if (prev && now - prev.lastSent < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - prev.lastSent)) / 1000);
    return res.status(429).json({ ok: false, error: `Please wait ${wait}s before requesting another code.` });
  }
  if (sends.length >= MAX_SENDS_PER_HOUR) {
    return res.status(429).json({ ok: false, error: 'Too many codes requested for this address. Try again later.' });
  }

  const code = newCode(), salt = crypto.randomBytes(16).toString('hex');
  const entry = { salt, hash: hashCode(code, salt), expires: now + CODE_TTL_MS, attempts: 0, lastSent: now, sends: [...sends, now] };

  if (!transporter) {
    pending.set(email, entry);
    return res.json({ ok: true, sent: false, demoMode: true, demoCode: code, expiresInSec: CODE_TTL_MS / 1000 });
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: `Your Aurelia verification code: ${code}`,
      text:
`Hi${firstName ? ' ' + firstName : ''},

Your ${BRAND} code is: ${code}

It expires in 10 minutes. If you didn't request this, you can ignore this email.

Aurelia Air is a fictional airline built for a hackathon demo.`,
      html:
`<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:440px;margin:auto;padding:24px;color:#14183a">
  <h2 style="margin:0 0 8px;color:#232e6b">${esc(BRAND)}</h2>
  <p>Hi${firstName ? ' ' + esc(firstName) : ''}, use this code to verify your student status:</p>
  <p style="font-size:34px;letter-spacing:8px;font-weight:800;background:#f0f2ff;border-radius:12px;padding:16px;text-align:center;margin:16px 0">${code}</p>
  <p style="color:#6a6f8f;font-size:13px">It expires in 10 minutes. If you didn't request this, ignore this email.<br>Aurelia Air is a fictional airline built for a hackathon demo.</p>
</div>`,
    });
  } catch (err) {
    console.error('[mail] send failed:', err && err.code, err && err.responseCode, err && err.message);
    return res.status(502).json({ ok: false, error: 'We could not send the email. Check the sender/recipient setup and try again.' });
  }
  pending.set(email, entry);
  res.json({ ok: true, sent: true, to: mask(email), expiresInSec: CODE_TTL_MS / 1000 });
});

app.post('/api/verify/confirm', rateLimit, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();
  if (!isEduEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ ok: false, error: 'Enter the 6-digit code.' });
  }
  const entry = pending.get(email);
  if (!entry || Date.now() > entry.expires) {
    pending.delete(email);
    return res.status(400).json({ ok: false, error: 'That code has expired or was never requested. Request a new one.' });
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    pending.delete(email);
    return res.status(429).json({ ok: false, error: 'Too many wrong attempts. Request a new code.' });
  }
  entry.attempts++;
  const a = Buffer.from(hashCode(code, entry.salt)), b = Buffer.from(entry.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ ok: false, error: `That code is not correct. ${MAX_ATTEMPTS - entry.attempts} attempts left.` });
  }
  pending.delete(email);
  res.json({ ok: true, verified: true, email, verifiedAt: new Date().toISOString() });
});

/* Serve only the app's own files (not server.js, package.json, .env ...). */
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/mobile.html': 'mobile.html', '/styles.css': 'styles.css', '/app.js': 'app.js', '/data.js': 'data.js', '/student-zone.js': 'student-zone.js', '/config.js': 'config.js' };
app.get(Object.keys(FILES), (req, res) => res.sendFile(path.join(__dirname, FILES[req.path])));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Aurelia Air demo running at http://localhost:${PORT}`);
    console.log(smtpConfigured
      ? `Email: SMTP via ${process.env.SMTP_HOST} (from ${process.env.MAIL_FROM})`
      : 'Email: DEMO MODE — no SMTP configured, codes are shown on screen. Copy .env.example to .env to send real email.');
  });
}
module.exports = { app, isEduEmail };
