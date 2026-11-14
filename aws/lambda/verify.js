/* Cathay Student demo — student verification logic (AWS Lambda edition).
 * Same rules as server.js, but state lives in DynamoDB and the email goes out through SES.
 * Everything AWS-specific is injected (store, mailer), so this file is unit-testable without AWS. */
'use strict';
const crypto = require('crypto');

const BRAND = 'Cathay Student Verify';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const IP_LIMIT = 40; // requests per IP per window
const IP_WINDOW_SEC = 15 * 60;
const MAX_BODY_BYTES = 2048;

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
const hashCode = (code, salt) => crypto.createHmac('sha256', salt).update(code).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

function parseBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (_) { return {}; }
}

/* CloudFront sets CloudFront-Viewer-Address ("1.2.3.4:5678" or "[2001:db8::1]:5678") itself and
 * overwrites anything the client sends, so unlike X-Forwarded-For it can't be spoofed. */
function clientIp(event) {
  const h = (event.headers && event.headers['cloudfront-viewer-address']) || '';
  if (h) {
    if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
    const i = h.lastIndexOf(':');
    return i > 0 ? h.slice(0, i) : h;
  }
  return (event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp) || 'unknown';
}

function buildEmail(code, firstName) {
  const name = firstName ? ' ' + firstName : '';
  return {
    subject: `Your Cathay Student verification code: ${code}`,
    text:
`Hi${name},

Your ${BRAND} code is: ${code}

It expires in 10 minutes. If you didn't request this, you can ignore this email.

Cathay Student is a concept prototype built for a hackathon demo.`,
    html:
`<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:440px;margin:auto;padding:24px;color:#10261c">
  <h2 style="margin:0 0 8px;color:#0b4a35">${esc(BRAND)}</h2>
  <p>Hi${firstName ? ' ' + esc(firstName) : ''}, use this code to verify your student status:</p>
  <p style="font-size:34px;letter-spacing:8px;font-weight:800;background:#e8eee2;border-radius:12px;padding:16px;text-align:center;margin:16px 0">${code}</p>
  <p style="color:#66756b;font-size:13px">It expires in 10 minutes. If you didn't request this, ignore this email.<br>Cathay Student is a concept prototype built for a hackathon demo.</p>
</div>`,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store   { hit, getPending, putPending, bumpAttempts, deletePending }
 * @param {object} deps.mailer  { send({ to, subject, text, html }) }
 * @param {'ses'|'demo'} deps.mailMode  'demo' returns the code in the response instead of emailing it
 * @param {() => number} [deps.now]
 */
function createHandler({ store, mailer, mailMode, now = Date.now }) {
  async function rateLimited(event) {
    const bucket = Math.floor(now() / 1000 / IP_WINDOW_SEC);
    const n = await store.hit(`rl#${clientIp(event)}#${bucket}`, (bucket + 1) * IP_WINDOW_SEC + 60);
    return n > IP_LIMIT;
  }

  async function start(event, body) {
    const email = String(body.email || '').trim().toLowerCase();
    const firstName = String(body.firstName || '').slice(0, 40);
    if (!isEduEmail(email)) {
      return json(400, { ok: false, error: 'Use your university email — the domain must include .edu (e.g. name@uni.edu or name@uni.edu.hk).' });
    }
    const t = now();
    const prev = await store.getPending(email);
    const sends = ((prev && prev.sends) || []).filter((ts) => t - ts < 3600 * 1000);
    if (prev && t - prev.lastSent < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (t - prev.lastSent)) / 1000);
      return json(429, { ok: false, error: `Please wait ${wait}s before requesting another code.` });
    }
    if (sends.length >= MAX_SENDS_PER_HOUR) {
      return json(429, { ok: false, error: 'Too many codes requested for this address. Try again later.' });
    }

    const code = newCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const entry = { salt, hash: hashCode(code, salt), expires: t + CODE_TTL_MS, attempts: 0, lastSent: t, sends: [...sends, t] };

    if (mailMode === 'demo') {
      await store.putPending(email, entry);
      return json(200, { ok: true, sent: false, demoMode: true, demoCode: code, expiresInSec: CODE_TTL_MS / 1000 });
    }

    try {
      await mailer.send({ to: email, ...buildEmail(code, firstName) });
    } catch (err) {
      console.error('[mail] send failed:', err && err.name, err && err.message);
      const sandbox = err && err.name === 'MessageRejected' && /not verified/i.test(err.message || '');
      return json(502, {
        ok: false,
        error: sandbox
          ? 'This demo can only email pre-approved addresses right now (the AWS SES sandbox). Ask the team to approve your address.'
          : 'We could not send the email. Check the sender/recipient setup and try again.',
      });
    }
    await store.putPending(email, entry);
    return json(200, { ok: true, sent: true, to: mask(email), expiresInSec: CODE_TTL_MS / 1000 });
  }

  async function confirm(event, body) {
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    if (!isEduEmail(email) || !/^\d{6}$/.test(code)) {
      return json(400, { ok: false, error: 'Enter the 6-digit code.' });
    }
    // Atomic increment: concurrent guesses can't dodge the attempt limit.
    const entry = await store.bumpAttempts(email);
    if (!entry || now() > entry.expires) {
      await store.deletePending(email);
      return json(400, { ok: false, error: 'That code has expired or was never requested. Request a new one.' });
    }
    if (entry.attempts > MAX_ATTEMPTS) {
      await store.deletePending(email);
      return json(429, { ok: false, error: 'Too many wrong attempts. Request a new code.' });
    }
    const a = Buffer.from(hashCode(code, entry.salt));
    const b = Buffer.from(entry.hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json(400, { ok: false, error: `That code is not correct. ${MAX_ATTEMPTS - entry.attempts} attempts left.` });
    }
    await store.deletePending(email);
    return json(200, { ok: true, verified: true, email, verifiedAt: new Date(now()).toISOString() });
  }

  return async function handler(event) {
    try {
      const method = event.requestContext && event.requestContext.http && event.requestContext.http.method;
      const path = event.rawPath;
      if (method === 'GET' && path === '/api/health') return json(200, { ok: true, mail: mailMode === 'demo' ? 'demo' : 'ses' });
      if (method === 'POST' && (path === '/api/verify/start' || path === '/api/verify/confirm')) {
        if (await rateLimited(event)) return json(429, { ok: false, error: 'Too many requests. Try again in a few minutes.' });
        const body = parseBody(event);
        if (body.tooLarge) return json(413, { ok: false, error: 'Request too large.' });
        return path === '/api/verify/start' ? await start(event, body) : await confirm(event, body);
      }
      return json(404, { ok: false, error: 'Not found.' });
    } catch (err) {
      console.error('[handler] unexpected error:', err && err.stack || err);
      return json(500, { ok: false, error: 'Something went wrong on our side. Please try again.' });
    }
  };
}

module.exports = { createHandler, isEduEmail, clientIp, buildEmail, BRAND };
