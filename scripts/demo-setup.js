#!/usr/bin/env node
/* Prepares a live demo on a running Cathay Student server, through its normal public API (no database access).
 * Safe to run again: existing accounts are signed in, finished steps are skipped.
 *
 *   node scripts/demo-setup.js                                # local server (npm start)
 *   BASE=http://13.237.37.96 node scripts/demo-setup.js       # the cloud server
 *
 * It creates (demo accounts only; the app itself has no built-in users):
 *   - Alex Chan  (presenter phone 1): verified student, NOT booked -> books on stage
 *   - Jamie Wong (presenter phone 2): verified student, booked on the demo flight
 *   - Mei, Leo (CUHK) and Sara (PolyU): verified students booked on the same flight; Mei and Sara share their
 *     university, Leo doesn't. With Jamie that's 4 students -> the flight shows "3+ students".
 *   - a short hello in the flight chat from Mei and Sara
 *   - the reviewer (student IDs) and moderator (chat reports) accounts
 * Student IDs are synthetic test images, approved by the reviewer account: the server must list REVIEWER in VERIFIERS.
 *
 * Env: BASE, DEMO_PASSWORD (default CathayDemo2026), REVIEWER / MODERATOR emails (default: first of VERIFIERS /
 * MODERATORS in .env), DATE (YYYY-MM-DD, default tomorrow), FROM / TO (default HKG / LHR), FARE (default Essential). */
'use strict';
const fs = require('fs');
const path = require('path');

const envFile = (() => { try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); } catch { return ''; } })();
const fromEnvFile = (k) => ((envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '').split(',')[0].trim();
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || 'CathayDemo2026';
// The reviewer: the seeded verifier from .env (SEED_VERIFIER_EMAIL / _PASSWORD) when set, else the first VERIFIERS email.
const SEED_REV = process.env.SEED_VERIFIER_EMAIL || fromEnvFile('SEED_VERIFIER_EMAIL'), SEED_REV_PW = process.env.SEED_VERIFIER_PASSWORD || fromEnvFile('SEED_VERIFIER_PASSWORD');
const REVIEWER = process.env.REVIEWER || SEED_REV || fromEnvFile('VERIFIERS') || 'reviewer@demo.cathay.test';
const MODERATOR = process.env.MODERATOR || fromEnvFile('MODERATORS') || 'moderator@demo.cathay.test';
const tomorrow = () => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DATE = process.env.DATE || tomorrow();
const FROM = process.env.FROM || 'HKG', TO = process.env.TO || 'LHR', FARE = process.env.FARE || 'Essential';

const PEOPLE = [
  { key: 'alex', first: 'Alex', last: 'Chan', email: 'alex@demo.cathay.test', uni: 'alex.chan@link.cuhk.edu.hk', inst: 'The Chinese University of Hong Kong', book: false },
  { key: 'jamie', first: 'Jamie', last: 'Wong', email: 'jamie@demo.cathay.test', uni: 'jamie.wong@link.cuhk.edu.hk', inst: 'The Chinese University of Hong Kong', book: true, share: true },
  { key: 'mei', first: 'Mei', last: 'Lau', email: 'mei@demo.cathay.test', uni: 'mei.lau@link.cuhk.edu.hk', inst: 'The Chinese University of Hong Kong', book: true, share: true, hello: 'Hi! First year at CUHK, flying out for an exchange term. Anyone else on this flight?' },
  { key: 'leo', first: 'Leo', last: 'Ho', email: 'leo@demo.cathay.test', uni: 'leo.ho@link.cuhk.edu.hk', inst: 'The Chinese University of Hong Kong', book: true, share: false },
  { key: 'sara', first: 'Sara', last: 'Ng', email: 'sara@demo.cathay.test', uni: 'sara.ng@polyu.edu.hk', inst: 'The Hong Kong Polytechnic University', book: true, share: true, hello: 'Hello from PolyU! Any tips for getting from Heathrow to central London?' },
];

const say = (m) => console.log('  ' + m);
async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ...j };
}
async function account(first, last, email) {
  const pw = email === SEED_REV && SEED_REV_PW ? SEED_REV_PW : PASSWORD;
  let r = await call('POST', '/api/auth/signup', { firstName: first, lastName: last, email, password: pw, dob: '2003-05-20' });
  if (r.status === 409) r = await call('POST', '/api/auth/login', { email, password: pw });
  if (!r.token) throw new Error(`${email}: ${r.error || 'could not sign up or sign in (different password?)'}`);
  return r;
}
/* A small synthetic JPEG (valid header + size), like the project's tests use. Never a real person's document. */
function testJpeg(w = 1600, h = 1000) {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([head, Buffer.alloc(50 * 1024, 7), Buffer.from([0xff, 0xd9])]).toString('base64');
}
const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function makeStudent(p, reviewerToken) {
  const a = await account(p.first, p.last, p.email);
  let st = (await call('GET', '/api/student/status', null, a.token)).verification || {};
  if (st.status === 'verified') return a;
  if (['not_submitted', 'expired', undefined].includes(st.status) || !st.email) {
    const s = await call('POST', '/api/verify/start', { email: p.uni, firstName: p.first }, a.token);
    if (!s.demoCode) throw new Error(`${p.uni}: no demo code (${s.error || 'is SMTP configured on the server? then verify by email'})`);
    const c = await call('POST', '/api/verify/confirm', { email: p.uni, code: s.demoCode }, a.token);
    if (c.status !== 200) throw new Error(`${p.uni}: ${c.error}`);
    st = (await call('GET', '/api/student/status', null, a.token)).verification || {};
  }
  if (st.status !== 'pending_review') {
    const up = await call('POST', '/api/student/submission', {
      declared: { fullName: `${p.first} ${p.last}`, institution: p.inst, expiry: inDays(400) },
      documents: [{ role: 'student_id', mime: 'image/jpeg', name: 'student-id', data: testJpeg() }],
    }, a.token);
    if (up.status !== 200) throw new Error(`${p.email} student ID: ${up.error}`);
  }
  const d = await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve' }, reviewerToken);
  if (d.status !== 200) throw new Error(`approve ${p.email}: ${d.error} (is ${REVIEWER} listed in VERIFIERS on the server?)`);
  return a;
}

(async () => {
  console.log(`Demo setup on ${BASE} · flight ${FROM} → ${TO} on ${DATE} (${FARE})`);
  const h = await call('GET', '/api/live/health').catch(() => null);
  if (!h || !h.ok) throw new Error(`The server at ${BASE} is not answering /api/live/health. Start it first.`);
  say(`server ok · OAG ${h.oag ? 'configured' : 'NOT configured (simulated schedule)'}`);

  const reviewer = await account('Rita', 'Reviewer', REVIEWER);
  await account('Mo', 'Moderator', MODERATOR);
  say(`staff: reviewer ${REVIEWER}, moderator ${MODERATOR}`);

  const fl = await call('GET', `/api/live/flights?from=${FROM}&to=${TO}&date=${DATE}&cabin=Economy`);
  if (!fl.flights || !fl.flights.length) throw new Error('No flights found for that route and date.');
  const f = fl.flights[0];
  const seg = { number: f.number, from: f.from, to: f.to, dep: f.dep, arr: f.arr, aircraft: f.aircraft, durMin: f.durMin, stops: f.stops };
  const fid = f.number.replace(/\s+/g, '') + '-' + f.dep.slice(0, 10);
  say(`demo flight: ${f.number} ${f.dep.replace('T', ' ')} (${fl.source === 'oag' ? 'real OAG schedule' : 'simulated schedule'})`);

  const tokens = {};
  for (const p of PEOPLE) {
    const a = await makeStudent(p, reviewer.token);
    tokens[p.key] = a.token;
    if (!p.book) { say(`${p.first}: verified student, not booked`); continue; }
    const me = await call('GET', '/api/me', null, a.token);
    const trips = (me.data && me.data.trips) || [];
    const ref = 'D' + p.key.toUpperCase().slice(0, 4).padEnd(5, 'X');
    if (!trips.some((t) => t.ref === ref)) {
      trips.push({ ref, status: 'Confirmed', cabin: 'Economy', fare: FARE, studentSeat: true, showUni: p.share, checkedIn: false, bought: new Date().toISOString().slice(0, 16),
        pax: [{ first: p.first, last: p.last }], total: Math.round(f.price * 1.14), segments: [{ ...seg, fare: FARE, seat: '' }] });
      const data = { ...(me.data || {}), trips };
      delete data.verified;
      await call('PUT', '/api/me/data', { data }, a.token);
    }
    const r = await call('PUT', `/api/seating/flights/${fid}/booking`, { seg, cabin: 'Economy', fare: FARE, ref, showUni: p.share, studentSeating: true }, a.token);
    if (r.status !== 200) throw new Error(`${p.first} booking: ${r.error}`);
    if (r.studentDenied) throw new Error(`${p.first} not accepted in the Student Zone: ${r.studentDenied}`);
    say(`${p.first}: verified student, booked ${ref}, ${p.share ? 'shares' : 'hides'} university`);
  }

  for (const p of PEOPLE.filter((x) => x.hello)) {
    await call('POST', `/api/chat/${fid}/join`, { acceptGuidelines: true }, tokens[p.key]);
    const msgs = await call('GET', `/api/chat/${fid}/messages`, null, tokens[p.key]);
    if (msgs.ok && !msgs.messages.some((m) => m.text === p.hello)) await call('POST', `/api/chat/${fid}/messages`, { text: p.hello }, tokens[p.key]);
  }
  say('chat: hello messages from Mei and Sara');

  const sd = await call('GET', `/api/live/student-dates?from=${FROM}&to=${TO}&date=${DATE}`);
  say(`student counts on that flight: ${(sd.dates || []).map((d) => `${d.date} ${d.students}`).join(', ') || 'none'}`);
  console.log(`\nReady. Phones: alex@demo.cathay.test and jamie@demo.cathay.test, password ${PASSWORD}`);
  console.log(`Book on stage: ${FROM} → ${TO} on ${DATE}, ${f.number}, Economy ${FARE}, answer Yes to student seating.`);
})().catch((e) => { console.error('\nDemo setup failed: ' + e.message); process.exit(1); });
