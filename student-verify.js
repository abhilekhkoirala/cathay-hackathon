/* Student eligibility verification (mounted by server.js under /api/student and /api/review).
 *
 * Two steps, both enforced HERE on the server:
 *   1. University email: the existing one-time code in server.js (/api/verify/start + /confirm). On success
 *      server.js calls recordEmailVerified(), which opens a verification record for the account.
 *   2. Student ID: the student uploads a photo, screenshot or PDF of their student ID (and, when the card has
 *      no expiry date, an optional enrolment letter / official digital student-status record).
 *
 * Statuses (student-facing): not_submitted → awaiting_document → pending_review → verified
 *                                                              ↘ rejected (more information needed) ↗
 *                            verified → expired (validity date passed, or the eligibility policy changed)
 *
 * Automated analysis (prototype) only FLAGS problems and, optionally, approves clear-cut digital PDFs.
 * It never rejects a student: only a trained human reviewer (accounts listed in VERIFIERS) can reject.
 *
 * Privacy and security:
 *  - documents are encrypted at rest (AES-256-GCM, random key per file wrapped by DOC_ENCRYPTION_KEY) in a private
 *    directory that server.js never serves; file names are random ids, never names or ID numbers;
 *  - only reviewers can open a document (never the uploader's fellow passengers, never other students), and
 *    every view, decision and deletion is written to an access log (no document contents in the log);
 *  - documents are deleted as soon as a decision is made (or after PENDING_RETENTION_DAYS if never reviewed);
 *    afterwards we keep only the outcome, the institution, the validity date and a SHA-256 of rejected files
 *    (to spot the same rejected file being sent again);
 *  - we never ask for passports or other identity documents, and never store student ID numbers. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { db, save } = require('./db');

/* ---------- policy (airline-configurable) ---------- */
const POLICY = {
  version: Number(process.env.STUDENT_POLICY_VERSION || 1), // bump to make every student re-verify
  maxValidityMonths: 12,          // re-verify at least once a year, even if the card is valid for longer
  academicYearEnd: { month: 8, day: 31 }, // validity for cards without an expiry date (reviewer can adjust)
  expirySoonDays: 30,             // remind the student to re-verify this many days before the end
  pendingRetentionDays: 30,       // unreviewed documents are deleted after this
  auditRetentionDays: 365,
  maxFileBytes: 5 * 1024 * 1024,
  minImageSide: 600,              // shorter images are flagged as possibly unreadable (never rejected)
  maxSubmissionsPerDay: 10,
  autoApprove: String(process.env.STUDENT_AUTO_APPROVE || 'off'), // 'pdf-text' to let clear digital PDFs through
};
const MIME = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'application/pdf': 'PDF' };
const ROLES = ['student_id', 'enrolment_proof'];
const REJECT_REASONS = {
  unreadable: 'The document is blurry, cropped or too dark to read. Upload a clear photo or screenshot of the whole card.',
  incomplete: 'Some required information is missing or hidden (full name, institution, or validity). Upload a version that shows all of it.',
  not_student_document: "This doesn't look like a student ID, enrolment letter or official student-status document.",
  name_mismatch: "The name on the document doesn't match the name on your Cathay account. Upload a document in your name, or contact us to update your account name.",
  institution_mismatch: "The institution on the document doesn't match your verified university email. Use the email and ID from the same institution.",
  institution_not_eligible: "This institution isn't an eligible university or higher-education institution under our student policy.",
  expired: 'This document has expired. Upload a current student ID or an enrolment letter for this academic year.',
  expires_before_flight: 'This document expires before your booked flight. Upload a document that is valid on your flight date, such as a current enrolment letter.',
  other: 'We need more information to confirm your student status.',
};

/* Recognised institutions (prototype registry). Production: the airline's approved list, checked against
 * official registers (e.g. Hong Kong EDB, UK OfS, US Dept. of Education, WHED). Unlisted .edu domains are
 * NOT rejected: they are sent to a reviewer. */
const INSTITUTIONS = [
  ['cuhk.edu.hk', 'The Chinese University of Hong Kong', 'HK', ['CUHK', 'Chinese University of Hong Kong']],
  ['polyu.edu.hk', 'The Hong Kong Polytechnic University', 'HK', ['PolyU', 'Hong Kong Polytechnic University']],
  ['cityu.edu.hk', 'City University of Hong Kong', 'HK', ['CityU']],
  ['hkbu.edu.hk', 'Hong Kong Baptist University', 'HK', ['HKBU']],
  ['ust.hk', 'The Hong Kong University of Science and Technology', 'HK', ['HKUST']],
  ['eduhk.hk', 'The Education University of Hong Kong', 'HK', ['EdUHK']],
  ['ln.edu.hk', 'Lingnan University', 'HK', ['Lingnan']],
  ['hkmu.edu.hk', 'Hong Kong Metropolitan University', 'HK', ['HKMU']],
  ['mit.edu', 'Massachusetts Institute of Technology', 'US', ['MIT']],
  ['nyu.edu', 'New York University', 'US', ['NYU']],
  ['columbia.edu', 'Columbia University', 'US', ['Columbia']],
  ['cornell.edu', 'Cornell University', 'US', ['Cornell']],
  ['uw.edu', 'University of Washington', 'US', ['UW']],
  ['stanford.edu', 'Stanford University', 'US', ['Stanford']],
  ['harvard.edu', 'Harvard University', 'US', ['Harvard']],
  ['berkeley.edu', 'University of California, Berkeley', 'US', ['UC Berkeley', 'Berkeley']],
  ['unsw.edu.au', 'UNSW Sydney', 'AU', ['UNSW', 'University of New South Wales']],
  ['sydney.edu.au', 'The University of Sydney', 'AU', ['University of Sydney', 'USYD']],
  ['unimelb.edu.au', 'The University of Melbourne', 'AU', ['University of Melbourne', 'UniMelb']],
  ['monash.edu', 'Monash University', 'AU', ['Monash']],
  ['anu.edu.au', 'The Australian National University', 'AU', ['ANU']],
  ['nus.edu.sg', 'National University of Singapore', 'SG', ['NUS']],
  ['ntu.edu.sg', 'Nanyang Technological University', 'SG', ['NTU']],
  ['smu.edu.sg', 'Singapore Management University', 'SG', ['SMU']],
  ['ntu.edu.tw', 'National Taiwan University', 'TW', ['NTU', 'National Taiwan University']],
  ['ku.edu.np', 'Kathmandu University', 'NP', ['Kathmandu University', 'KU']],
  ['tu.edu.np', 'Tribhuvan University', 'NP', ['Tribhuvan University', 'TU']],
  ['iitd.ac.in', 'Indian Institute of Technology Delhi', 'IN', ['IIT Delhi']],
  ['ubc.ca', 'The University of British Columbia', 'CA', ['UBC']],
].map(([domain, name, country, aliases]) => ({ domain, name, country, aliases }));

/* ---------- small helpers ---------- */
const DAY = 864e5;
let clock = () => Date.now();
const now = () => clock();
const today = () => new Date(now()).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => DATE_RE.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const minDate = (...a) => a.filter(Boolean).sort()[0] || null;
const rid = (p) => p + crypto.randomBytes(12).toString('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const words = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !['the', 'of', 'and', 'university', 'univ', 'college', 'institute'].includes(w));
const nameWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);

function institutionFor(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  const hit = INSTITUTIONS.find((i) => domain === i.domain || domain.endsWith('.' + i.domain));
  if (hit) return { domain, name: hit.name, country: hit.country, recognised: true, aliases: hit.aliases };
  const labels = domain.split('.'), guess = labels[Math.max(0, labels.indexOf('edu') - 1)] || labels[0] || '';
  return { domain, name: guess.length <= 5 ? guess.toUpperCase() : guess[0].toUpperCase() + guess.slice(1), country: '', recognised: false, aliases: [] };
}

/* 'match' | 'partial' | 'mismatch': order-insensitive, accent-insensitive, middle names allowed. */
function nameMatch(account, declared) {
  const a = nameWords(account), d = new Set(nameWords(declared));
  if (!a.length || !d.size) return 'mismatch';
  const hits = a.filter((w) => d.has(w)).length;
  if (hits === a.length) return 'match';
  const last = nameWords(account.split(' ').slice(-1)[0]);
  if (last.every((w) => d.has(w)) && hits >= 1) return 'partial'; // e.g. a different first name / nickname
  return 'mismatch';
}
function institutionMatch(inst, declared) {
  const d = words(declared).join(' ');
  if (!d) return 'mismatch';
  const names = [inst.name, ...(inst.aliases || [])].map((n) => words(n).join(' ')).filter(Boolean);
  if (names.some((n) => n === d || n.includes(d) || d.includes(n))) return 'match';
  const dw = new Set(words(declared));
  if (names.some((n) => n.split(' ').filter((w) => dw.has(w)).length >= Math.min(2, n.split(' ').length))) return 'partial';
  return 'mismatch';
}

/* ---------- file checks ---------- */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 1024).includes('%PDF-')) return 'application/pdf';
  return '';
}
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

/* Text from a digital PDF (uncompressed or Flate streams, simple fonts). Enough for most university-generated
 * enrolment letters; scanned PDFs and images need OCR from a real document-verification provider. */
function pdfText(buf) {
  const s = buf.toString('latin1'), out = [];
  let i = 0, streams = 0, total = 0;
  while ((i = s.indexOf('stream', i)) !== -1 && streams < 200 && total < 200000) {
    let start = i + 6;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    const end = s.indexOf('endstream', start);
    if (end === -1) break;
    const dict = s.slice(Math.max(0, i - 400), i);
    let body = buf.slice(start, end);
    if (/\/FlateDecode/.test(dict.slice(dict.lastIndexOf('<<')))) {
      try { body = zlib.inflateSync(body, { maxOutputLength: 2 * 1024 * 1024 }); } catch { try { body = zlib.inflateSync(body.slice(0, -1), { maxOutputLength: 2 * 1024 * 1024 }); } catch { body = null; } }
    }
    if (body) { const t = textOps(body.toString('latin1')); if (t) { out.push(t); total += t.length; } }
    streams++; i = end + 9;
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').trim().slice(0, 50000);
}
function textOps(c) {
  if (!/T[jJ]/.test(c)) return '';
  const lit = (x) => x.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));
  const parts = [];
  const re = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|Td|TD|ET)/g;
  let m;
  while ((m = re.exec(c))) {
    if (m[1] !== undefined) {
      let line = '';
      for (const p of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g)) {
        if (p[1] !== undefined) line += lit(p[1]); else if (Number(p[2]) < -200) line += ' ';
      }
      parts.push(line);
    } else if (m[2] !== undefined) parts.push(lit(m[2]));
    else parts.push('\n');
  }
  return parts.join('').replace(/ *\n */g, '\n');
}

/* Expiry/validity date in document text, only when next to a validity keyword (so a date of birth or an
 * issue date is never taken for an expiry date). Returns the latest such date (ISO) or null. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDate(t) {
  t = t.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  const mk = (y, mo, d) => { const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return isDate(iso) ? iso : null; };
  const eom = (y, mo) => new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t))) return mk(+m[3], +m[2], +m[1]); // day first (HK, UK, AU)
  if ((m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})/.exec(t)) && MONTHS.includes(m[2])) return mk(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  if ((m = /^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})/.exec(t)) && MONTHS.includes(m[1])) return mk(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  if ((m = /^(\d{1,2})[-/.](\d{4})/.exec(t))) return +m[1] >= 1 && +m[1] <= 12 ? eom(+m[2], +m[1]) : null; // MM/YYYY = end of month
  if ((m = /^([a-z]{3})[a-z]* (\d{4})/.exec(t)) && MONTHS.includes(m[1])) return eom(+m[2], MONTHS.indexOf(m[1]) + 1);
  return null;
}
const EXPIRY_KEY = /(valid\s*(?:until|thru|through|to|till)|expir(?:y|es|ation)(?:\s*date)?|exp\.?\s*date|exp\.|good\s*thru|(?:programme|program|course|study|enrol(?:l)?ment)\s*end(?:\s*date)?|end\s*date|expected\s*(?:completion|graduation)(?:\s*date)?|registered\s*until)\s*[:\-]?\s*/gi;
function findExpiry(text) {
  const found = [];
  let m;
  EXPIRY_KEY.lastIndex = 0;
  while ((m = EXPIRY_KEY.exec(text))) { const d = parseDate(text.slice(m.index + m[0].length, m.index + m[0].length + 30)); if (d) found.push(d); }
  return found.sort().pop() || null;
}

/* ---------- encrypted private storage ---------- */
const VAULT = process.env.DOC_VAULT || path.join(path.dirname(process.env.LIVE_DB || path.join(__dirname, 'data', 'live-db.json')), 'vault');
let masterKey = null;
function key() {
  if (masterKey) return masterKey;
  const env = String(process.env.DOC_ENCRYPTION_KEY || '');
  if (/^[a-f0-9]{64}$/i.test(env)) return (masterKey = Buffer.from(env, 'hex'));
  fs.mkdirSync(VAULT, { recursive: true, mode: 0o700 });
  const kf = path.join(VAULT, '.key');
  try { masterKey = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex'); } catch { /* none yet */ }
  if (!masterKey || masterKey.length !== 32) {
    masterKey = crypto.randomBytes(32);
    fs.writeFileSync(kf, masterKey.toString('hex'), { mode: 0o600 });
    console.warn('[student-verify] DOC_ENCRYPTION_KEY not set: generated a local demo key in the vault directory. Use a KMS-managed key in production.');
  }
  return masterKey;
}
const seal = (k, buf) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv); const enc = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]); };
const open = (k, buf) => { const d = crypto.createDecipheriv('aes-256-gcm', k, buf.slice(0, 12)); d.setAuthTag(buf.slice(12, 28)); return Buffer.concat([d.update(buf.slice(28)), d.final()]); };
const docFile = (id) => path.join(VAULT, id.replace(/[^a-z0-9_]/gi, '') + '.bin');
function storeDoc(id, buf) {
  fs.mkdirSync(VAULT, { recursive: true, mode: 0o700 });
  const dek = crypto.randomBytes(32); // a fresh data key per document, wrapped by the master key (envelope encryption)
  const wrapped = seal(key(), dek), body = seal(dek, buf);
  const head = Buffer.alloc(2); head.writeUInt16BE(wrapped.length);
  fs.writeFileSync(docFile(id), Buffer.concat([head, wrapped, body]), { mode: 0o600 });
}
function readDoc(id) {
  const f = fs.readFileSync(docFile(id)), n = f.readUInt16BE(0);
  return open(open(key(), f.slice(2, 2 + n)), f.slice(2 + n));
}
function deleteDoc(id) {
  try { const f = docFile(id), size = fs.statSync(f).size; fs.writeFileSync(f, crypto.randomBytes(Math.min(size, 1 << 20))); fs.unlinkSync(f); } catch { /* already gone */ }
}

/* ---------- records ---------- */
db.studentVerify = db.studentVerify || {};  // uid -> record (below)
db.verifyAudit = db.verifyAudit || [];      // access log: { at, actor, action, subject, ref, ip }
const R = db.studentVerify;
/* record: { email, emailVerifiedAt, institution, state: awaiting_document|pending_review|verified|rejected,
 *           submission: {...} | null, validUntil, validitySource, verifiedAt, policyVersion,
 *           decision: { at, outcome, reasonCode, message, auto }, rejectedHashes: [], submits: [ts], history: [] } */

function audit(actor, action, subject, ref, req) {
  db.verifyAudit.push({ at: new Date(now()).toISOString(), actor: actor || 'system', action, subject: subject || '', ref: ref || '', ip: req ? String(req.ip || '') : '' });
  if (db.verifyAudit.length > 20000) db.verifyAudit.splice(0, db.verifyAudit.length - 20000);
}
const hist = (rec, event, extra) => { rec.history = (rec.history || []).concat({ at: new Date(now()).toISOString(), event, ...extra }).slice(-50); };

/* Accounts verified before the two-step process (email only) must add their student ID. */
function migrate() {
  let changed = false;
  for (const u of Object.values(db.users || {})) {
    if (u.student && u.student.email && !R[u.id]) {
      R[u.id] = { email: u.student.email, emailVerifiedAt: u.student.at, institution: institutionFor(u.student.email), state: 'awaiting_document', submission: null, rejectedHashes: [], history: [] };
      hist(R[u.id], 'migrated_email_only');
      changed = true;
    }
    if ('student' in u) { delete u.student; changed = true; }
  }
  if (changed) save();
}
migrate();

/* The student-facing status, with time-based expiry applied (so access ends the moment eligibility ends). */
/* An approved verification that is still valid on `day` under the current policy. A re-verification in progress
 * (pending or rejected) doesn't take away a verification that is still valid. */
const active = (rec, day = today()) => Boolean(rec && rec.verifiedAt && rec.validUntil && rec.validUntil >= day && (rec.policyVersion || 0) >= POLICY.version);
function statusOf(u) {
  const rec = u && R[u.id];
  if (!rec || !rec.email) return 'not_submitted';
  if (rec.state === 'verified') return active(rec) ? 'verified' : 'expired';
  return rec.state;
}
const emailStale = (rec) => !rec.emailVerifiedAt || Date.parse(rec.emailVerifiedAt) < now() - (POLICY.maxValidityMonths + 1) * 30 * DAY;
/* Is this account an eligible verified student on a given date (e.g. a flight's departure)? */
function eligibleOn(u, when) {
  const st = statusOf(u), rec = u && R[u.id];
  const day = String(when || new Date(now()).toISOString()).slice(0, 10);
  if (active(rec, day)) return { ok: true, reason: '' };
  if (active(rec)) return { ok: false, status: 'verified', reason: `Your student verification is valid until ${rec.validUntil}, before this date. Re-verify with a document that is valid on the day you fly.` };
  const reason = {
    not_submitted: 'Verify your student status (university email and student ID) to use student features.',
    awaiting_document: 'Upload your student ID to finish verifying your student status.',
    pending_review: "Your student ID is being reviewed. Student features unlock once it's approved.",
    rejected: 'We need more information to confirm your student status. Check Settings → Student verification.',
    expired: 'Your student verification has expired. Re-verify to keep using student features.',
  }[st];
  return { ok: false, reason, status: st };
}

/* Upcoming flight dates booked on this account (from its trips), used to warn about expiry before a flight. */
function flightDates(uid) {
  const out = new Set();
  for (const t of ((db.userData || {})[uid] || {}).trips || []) {
    if (!t || t.status !== 'Confirmed') continue;
    for (const s of t.segments || []) { const d = String(s && s.dep || '').slice(0, 10); if (isDate(d) && d >= today()) out.add(d); }
  }
  return [...out].sort();
}
function defaultValidity(from = today()) {
  const { month, day } = POLICY.academicYearEnd;
  let y = Number(from.slice(0, 4)), d = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (d < addDays(from, 60)) d = `${y + 1}${d.slice(4)}`;
  return minDate(d, addMonths(from, POLICY.maxValidityMonths));
}

/* ---------- automated analysis (never rejects; flags for a reviewer) ---------- */
function analyse(u, rec, declared, docs) {
  const checks = [];
  const add = (id, result, label, detail = '') => checks.push({ id, result, label, detail });
  const account = `${u.firstName} ${u.lastName}`;
  const inst = rec.institution || institutionFor(rec.email);
  const text = docs.map((d) => d.text || '').join('\n');

  add('email', 'pass', 'University email verified', rec.email);
  add('institution', inst.recognised ? 'pass' : 'flag', inst.recognised ? 'Recognised institution' : 'Institution not on the recognised list', inst.recognised ? inst.name : `${inst.domain}: reviewer to confirm it is an eligible higher-education institution`);

  const nm = nameMatch(account, declared.fullName);
  add('name', nm === 'match' ? 'pass' : 'flag', nm === 'match' ? 'Name matches the account' : nm === 'partial' ? 'Name only partly matches the account' : "Name doesn't match the account", `Account: ${account} · On document: ${declared.fullName}`);
  const im = institutionMatch(inst, declared.institution);
  add('institution_match', im === 'mismatch' ? 'flag' : 'pass', im === 'mismatch' ? "Institution doesn't match the university email" : 'Institution matches the university email', `Email: ${inst.name} · On document: ${declared.institution}`);

  for (const d of docs) {
    const who = d.role === 'student_id' ? 'Student ID' : 'Enrolment proof';
    if (d.width && Math.min(d.width, d.height) < POLICY.minImageSide) add('quality_' + d.role, 'flag', `${who}: low resolution`, `${d.width}×${d.height}px, may be hard to read`);
    else if (d.mime !== 'application/pdf' && d.bytes < 30 * 1024) add('quality_' + d.role, 'flag', `${who}: very small file`, 'may be unreadable');
    if (d.mime === 'application/pdf') add('text_' + d.role, d.text ? 'info' : 'flag', d.text ? `${who}: text read from the PDF` : `${who}: no readable text (scanned PDF)`, d.text ? `${d.text.length} characters` : 'reviewer to read it');
    if ((rec.rejectedHashes || []).includes(d.sha256)) add('dup_' + d.role, 'flag', `${who}: same file as a previously rejected one`);
    const other = Object.entries(R).find(([uid, r]) => uid !== u.id && ((r.submission && r.submission.documents.some((x) => x.sha256 === d.sha256)) || (r.docHashes || []).includes(d.sha256)));
    if (other) add('reuse_' + d.role, 'flag', `${who}: the same file was submitted by another account`);
  }

  // Text evidence from digital PDFs (the only automated reading in the prototype; images need OCR).
  let textEvidence = false;
  if (text) {
    const tw = new Set(nameWords(text)), nameInText = nameWords(account).every((w) => tw.has(w));
    const instInText = institutionMatch(inst, text.slice(0, 5000)) !== 'mismatch' || [inst.name, ...(inst.aliases || [])].some((n) => text.toLowerCase().includes(n.toLowerCase()));
    add('text_name', nameInText ? 'pass' : 'flag', nameInText ? 'Account name found in the document text' : 'Account name not found in the document text');
    add('text_institution', instInText ? 'pass' : 'flag', instInText ? 'Institution found in the document text' : 'Institution not found in the document text');
    textEvidence = nameInText && instInText;
  }

  // Validity: a date read from the document beats the date the student typed.
  const detected = findExpiry(text);
  const expiry = detected || (declared.noExpiry ? null : declared.expiry);
  const source = detected ? 'document_text' : expiry ? 'student_declared' : 'none';
  const flights = flightDates(u.id), lastFlight = flights[flights.length - 1];
  if (detected && declared.expiry && detected !== declared.expiry) add('expiry_conflict', 'flag', 'Expiry date typed differs from the document', `Typed ${declared.expiry} · document ${detected}`);
  if (!expiry) add('expiry', 'info', 'No expiry date', docs.some((d) => d.role === 'enrolment_proof') ? 'Enrolment proof provided' : 'Reviewer to confirm current enrolment (policy validity applies)');
  else if (expiry < today()) add('expiry', 'flag', 'Document has expired', `${source === 'document_text' ? 'Read from document' : 'Typed by student'}: ${expiry}`);
  else if (lastFlight && expiry < lastFlight) add('expiry', 'flag', 'Expires before a booked flight', `Valid until ${expiry}; flight on ${flights.find((d) => d > expiry)}`);
  else add('expiry', 'pass', 'Valid on all booked flight dates', `Until ${expiry} (${source === 'document_text' ? 'read from document' : 'typed by student'})`);

  const flags = checks.filter((c) => c.result === 'flag').map((c) => c.id);
  const auto = POLICY.autoApprove === 'pdf-text' && !flags.length && textEvidence && Boolean(detected) && inst.recognised;
  return { checks, flags, detectedExpiry: detected, expiry, expirySource: source, auto };
}

/* ---------- views ---------- */
const COPY = {
  not_submitted: { label: 'Not submitted', tone: 'muted', text: "You haven't started student verification.", next: ['Enter your university email to get a one-time code.', 'Then upload a photo or PDF of your student ID.'] },
  awaiting_document: { label: 'Awaiting document upload', tone: 'warn', text: 'Your university email is verified. Upload your student ID to finish.', next: ['Upload a clear photo, screenshot or PDF of your student ID (JPG, PNG or PDF, up to 5 MB).', "No expiry date on your card? Add an enrolment letter or official student-status record, or submit anyway and we'll review it."] },
  pending_review: { label: 'Pending review', tone: 'warn', text: "We've received your document. A member of our verification team will check it, usually within 1–2 working days.", next: ['Nothing to do now. Student features unlock as soon as it is approved.', 'Uploaded the wrong file or a blurry photo? Replace it below.'] },
  verified: { label: 'Verified', tone: 'ok', text: "You're a verified student. Student features are unlocked.", next: ['Re-verify before your validity date to keep student features.'] },
  rejected: { label: 'Rejected — additional information required', tone: 'bad', text: "We couldn't confirm your student status with the document you sent.", next: ['Read the reason below and upload a new document.', 'You can also add a current enrolment letter or official student-status record.'] },
  expired: { label: 'Expired — re-verification required', tone: 'bad', text: 'Your student verification has ended, so student features are paused.', next: ['Upload a current student ID or enrolment letter to re-verify. Your university email stays verified.'] },
};
const STUDENT_FLAGS = new Set(['name', 'institution_match', 'expiry', 'expiry_conflict', 'quality_student_id', 'quality_enrolment_proof', 'text_student_id', 'text_enrolment_proof']);

function view(u) {
  const rec = R[u.id], st = statusOf(u), c = COPY[st];
  const v = { status: st, label: c.label, tone: c.tone, explanation: c.text, nextSteps: c.next, policyVersion: POLICY.version };
  if (!rec) return v;
  v.email = rec.email; v.emailVerifiedAt = rec.emailVerifiedAt;
  v.institution = { name: rec.institution.name, recognised: rec.institution.recognised };
  if (rec.validUntil) { v.validUntil = rec.validUntil; v.verifiedAt = rec.verifiedAt; }
  v.active = active(rec);
  if (v.active && st !== 'verified') v.explanation += ` Your current verification stays valid until ${rec.validUntil}.`;
  if (['expired', 'rejected', 'awaiting_document'].includes(st) && emailStale(rec)) v.needsEmail = true;
  if (v.active) {
    const days = Math.round((Date.parse(rec.validUntil + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / DAY);
    v.daysLeft = days; v.expiresSoon = days <= POLICY.expirySoonDays;
    v.flightsNotCovered = flightDates(u.id).filter((d) => d > rec.validUntil);
  }
  if (st === 'expired' && (rec.policyVersion || 0) < POLICY.version && rec.validUntil >= today()) v.explanation = 'Our student eligibility policy has been updated, so we need to check your student status again.';
  if (rec.submission && st === 'pending_review') {
    const s = rec.submission;
    v.submission = { id: s.id, submittedAt: s.submittedAt, declared: s.declared, documents: s.documents.map((d) => ({ role: d.role, mime: d.mime, bytes: d.bytes, name: d.name })),
      notices: s.checks.filter((x) => x.result === 'flag' && STUDENT_FLAGS.has(x.id)).map((x) => x.label) };
  }
  if (st === 'rejected' && rec.decision) v.rejection = { reasonCode: rec.decision.reasonCode, reason: REJECT_REASONS[rec.decision.reasonCode] || REJECT_REASONS.other, message: rec.decision.message || '', at: rec.decision.at };
  return v;
}
/* Minimal summary attached to the account (accounts.js publicUser, /me). The browser's copy is display-only. */
function summary(u) {
  const rec = u && R[u.id];
  if (!rec) return { status: 'not_submitted' };
  const st = statusOf(u);
  return { status: st, active: active(rec), email: rec.email, institution: rec.institution.name, validUntil: rec.validUntil || null, verifiedAt: rec.verifiedAt || null };
}
/* What the app treats as "verified" (null unless currently verified). */
function clientVerified(u) {
  const rec = u && R[u.id];
  return active(rec) ? { email: rec.email, at: rec.verifiedAt, until: rec.validUntil, institution: rec.institution.name } : null;
}

/* ---------- step 1 hook (server.js /api/verify/confirm) ---------- */
/* Another account already holding this university email (pending or verified)? One email, one account. */
function emailInUse(uid, email) {
  return Object.entries(R).some(([id, r]) => id !== uid && r.email === email && db.users[id] && ['pending_review', 'verified'].includes(statusOf(db.users[id])));
}
function recordEmailVerified(uid, email) {
  const u = db.users[uid];
  if (!u) return { ok: false };
  if (emailInUse(uid, email)) return { ok: false, error: 'This university email is already linked to another Cathay account.' };
  const prev = R[uid];
  if (prev && prev.email === email) { // same address confirmed again (e.g. at re-verification): keep the record
    prev.emailVerifiedAt = new Date(now()).toISOString(); hist(prev, 'email_reconfirmed'); save();
    return { ok: true };
  }
  if (prev && prev.submission) for (const d of prev.submission.documents) deleteDoc(d.id);
  R[uid] = { email, emailVerifiedAt: new Date(now()).toISOString(), institution: institutionFor(email), state: 'awaiting_document', submission: null,
    rejectedHashes: (prev && prev.rejectedHashes) || [], submits: (prev && prev.submits) || [], history: (prev && prev.history) || [] };
  hist(R[uid], 'email_verified');
  audit(uid, 'email_verified', uid);
  save();
  return { ok: true };
}

/* ---------- step 2: submission ---------- */
function decodeDoc(raw, i) {
  if (!raw || typeof raw !== 'object') return { error: 'Missing document.' };
  const role = ROLES.includes(raw.role) ? raw.role : null;
  if (!role) return { error: 'Unknown document type.' };
  const b64 = String(raw.data || '').replace(/^data:[^,]*,/, '');
  if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { error: 'The file could not be read. Try again.' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'The file is empty.' };
  if (buf.length > POLICY.maxFileBytes) return { error: `That file is too large (${(buf.length / 1048576).toFixed(1)} MB). The limit is 5 MB.` };
  const mime = sniff(buf);
  if (!mime) return { error: 'Unsupported file. Upload a JPG, PNG or PDF.' };
  if (raw.mime && MIME[raw.mime] && raw.mime !== mime) return { error: "The file's contents don't match its type. Upload a real JPG, PNG or PDF." };
  const d = { id: rid('doc_'), role, mime, bytes: buf.length, name: str(raw.name, 80) || `document-${i + 1}`, sha256: sha256(buf), buf };
  if (mime === 'application/pdf') {
    const s = buf.toString('latin1');
    if (/\/Encrypt\b/.test(s)) return { error: 'That PDF is password-protected. Upload an unprotected PDF, or a screenshot.' };
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(s)) return { error: 'That PDF contains scripts or attachments, so we can’t accept it. Save it as a plain PDF or upload a screenshot.' };
    d.pages = (s.match(/\/Type\s*\/Page(?!s)/g) || []).length || 1;
    if (d.pages > 10) return { error: 'That PDF has too many pages. Upload just the page(s) that show your student status.' };
    d.text = pdfText(buf);
  } else {
    const size = imageSize(buf, mime);
    if (!size || !size.width || !size.height) return { error: 'That image could not be read. Upload a JPG or PNG photo or screenshot.' };
    Object.assign(d, size);
  }
  return { doc: d };
}

function submit(u, body, req) {
  const rec = R[u.id], st = statusOf(u);
  if (!rec) return { status: 409, error: 'Verify your university email first.' };
  if (st === 'verified') {
    const v = view(u);
    if (!v.expiresSoon && !(v.flightsNotCovered || []).length) return { status: 409, error: "You're already verified. You can re-verify within 30 days of your validity date." };
  }
  if (emailStale(rec)) return { status: 409, error: 'Confirm your university email again first: it was last confirmed over a year ago.', needsEmail: true };
  const t = now();
  rec.submits = (rec.submits || []).filter((x) => t - x < DAY);
  if (rec.submits.length >= POLICY.maxSubmissionsPerDay) return { status: 429, error: 'Too many uploads today. Try again tomorrow.' };

  const b = body || {}, dec = b.declared || {};
  const declared = {
    fullName: str(dec.fullName, 100), institution: str(dec.institution, 120),
    expiry: isDate(dec.expiry) ? dec.expiry : null, noExpiry: dec.noExpiry === true,
  };
  if (declared.fullName.length < 2) return { status: 400, error: 'Enter your full name as it appears on the document.' };
  if (declared.institution.length < 2) return { status: 400, error: 'Enter the university or institution shown on the document.' };
  if (!declared.expiry && !declared.noExpiry) return { status: 400, error: "Enter the expiry or 'valid until' date, or tick 'My card has no expiry date'." };
  if (declared.noExpiry) declared.expiry = null;
  const raws = Array.isArray(b.documents) ? b.documents.slice(0, 3) : [];
  if (!raws.length) return { status: 400, error: 'Add a photo, screenshot or PDF of your student ID.' };
  const docs = [];
  for (let i = 0; i < raws.length; i++) {
    const r = decodeDoc(raws[i], i);
    if (r.error) return { status: 400, error: r.error };
    if (docs.some((d) => d.role === r.doc.role)) return { status: 400, error: 'Send one student ID and at most one enrolment proof.' };
    docs.push(r.doc);
  }
  if (!docs.some((d) => d.role === 'student_id')) return { status: 400, error: 'Add a photo, screenshot or PDF of your student ID.' };

  const analysis = analyse(u, rec, declared, docs);
  // Replace any earlier submission: its files are deleted now.
  if (rec.submission) { for (const d of rec.submission.documents) { deleteDoc(d.id); audit('system', 'document_deleted', u.id, d.id); } }
  for (const d of docs) storeDoc(d.id, d.buf);
  rec.submits.push(t);
  rec.submission = {
    id: rid('sub_'), submittedAt: new Date(t).toISOString(), declared,
    documents: docs.map(({ buf, text, ...meta }) => meta), // extracted text is used once and not stored
    checks: analysis.checks, flags: analysis.flags, detectedExpiry: analysis.detectedExpiry, expiry: analysis.expiry, expirySource: analysis.expirySource,
  };
  rec.state = 'pending_review';
  hist(rec, 'submitted', { flags: analysis.flags.length });
  audit(u.id, 'submitted', u.id, rec.submission.id, req);
  if (analysis.auto) {
    decide(u.id, { decision: 'approve', validUntil: minDate(analysis.detectedExpiry, addMonths(today(), POLICY.maxValidityMonths)), source: 'document_text' }, 'auto', req);
  }
  save();
  return { status: 200, view: view(u) };
}

/* Approve or reject. Called by reviewers (or by the automated check for clear-cut approvals; never to reject). */
function decide(uid, b, actor, req) {
  const rec = R[uid], u = db.users[uid];
  if (!rec || !u || rec.state !== 'pending_review' || !rec.submission) return { status: 409, error: 'Nothing to review for this student.' };
  if (b.submissionId && b.submissionId !== rec.submission.id) return { status: 409, error: 'The student replaced their document. Reload the queue.' };
  const at = new Date(now()).toISOString(), s = rec.submission;
  if (b.decision === 'approve') {
    const cap = addMonths(today(), POLICY.maxValidityMonths);
    let until = isDate(b.validUntil) ? b.validUntil : s.expiry || defaultValidity();
    if (until < today()) return { status: 400, error: 'The validity date is in the past. Reject as expired instead, or set a current date from the document.' };
    until = minDate(until, cap);
    rec.state = 'verified'; rec.validUntil = until; rec.verifiedAt = at; rec.policyVersion = POLICY.version;
    rec.validitySource = b.source || (isDate(b.validUntil) ? 'reviewer' : s.expiry ? s.expirySource : 'policy_default');
    rec.decision = { at, outcome: 'approved', auto: actor === 'auto' };
    rec.docHashes = s.documents.map((d) => d.sha256); // to spot the same card used by another account
  } else if (b.decision === 'reject') {
    if (actor === 'auto') return { status: 400, error: 'Automated checks cannot reject.' };
    const code = REJECT_REASONS[b.reasonCode] ? b.reasonCode : 'other';
    rec.state = 'rejected';
    rec.decision = { at, outcome: 'rejected', reasonCode: code, message: str(b.message, 400) };
    rec.rejectedHashes = [...new Set([...(rec.rejectedHashes || []), ...s.documents.map((d) => d.sha256)])].slice(-20);
  } else return { status: 400, error: 'Choose approve or reject.' };
  // The document has done its job: delete it, keep only the outcome and validity date.
  for (const d of s.documents) { deleteDoc(d.id); audit('system', 'document_deleted', uid, d.id); }
  rec.lastSubmission = { submittedAt: s.submittedAt, flags: s.flags, expirySource: s.expirySource };
  rec.submission = null;
  hist(rec, rec.decision.outcome, { by: actor === 'auto' ? 'auto' : 'reviewer', reasonCode: rec.decision.reasonCode });
  audit(actor, rec.decision.outcome, uid, s.id, req);
  save();
  return { status: 200, outcome: rec.decision.outcome, validUntil: rec.validUntil };
}

function withdraw(u, req) {
  const rec = R[u.id];
  if (!rec || !rec.submission) return { status: 409, error: 'No document to remove.' };
  for (const d of rec.submission.documents) { deleteDoc(d.id); audit(u.id, 'document_deleted', u.id, d.id, req); }
  rec.submission = null;
  rec.state = rec.verifiedAt ? 'verified' : 'awaiting_document'; // statusOf() shows 'expired' if it has run out
  hist(rec, 'withdrawn'); save();
  return { status: 200, view: view(u) };
}
/* The student removes their verification entirely (right to erasure). */
function erase(u, req) {
  const rec = R[u.id];
  if (rec && rec.submission) for (const d of rec.submission.documents) deleteDoc(d.id);
  delete R[u.id];
  audit(u.id, 'verification_erased', u.id, '', req); save();
  return { status: 200 };
}

/* ---------- retention ---------- */
function purge() {
  let changed = false;
  const cutoff = now() - POLICY.pendingRetentionDays * DAY;
  const live = new Set();
  for (const [uid, rec] of Object.entries(R)) {
    if (!db.users[uid]) { if (rec.submission) rec.submission.documents.forEach((d) => deleteDoc(d.id)); delete R[uid]; changed = true; continue; }
    const s = rec.submission;
    if (s && Date.parse(s.submittedAt) < cutoff) {
      s.documents.forEach((d) => { deleteDoc(d.id); audit('system', 'document_deleted_retention', uid, d.id); });
      rec.submission = null; rec.state = 'rejected';
      rec.decision = { at: new Date(now()).toISOString(), outcome: 'rejected', reasonCode: 'other', message: `We couldn't review your document within ${POLICY.pendingRetentionDays} days, so it was deleted. Please upload it again.` };
      hist(rec, 'deleted_unreviewed'); changed = true;
    } else if (s) s.documents.forEach((d) => live.add(d.id + '.bin'));
  }
  try { for (const f of fs.readdirSync(VAULT)) if (f.endsWith('.bin') && !live.has(f)) deleteDoc(f.slice(0, -4)); } catch { /* no vault yet */ }
  const keepFrom = new Date(now() - POLICY.auditRetentionDays * DAY).toISOString();
  const n = db.verifyAudit.length;
  while (db.verifyAudit.length && db.verifyAudit[0].at < keepFrom) db.verifyAudit.shift();
  if (changed || db.verifyAudit.length !== n) save();
}
setInterval(purge, 60 * 60 * 1000).unref();

/* ---------- routes ---------- */
const isReviewer = (u) => Boolean(u) && String(process.env.VERIFIERS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(u.email);

function createRouter({ auth }) {
  const router = express.Router();
  const big = express.json({ limit: '16mb' });
  const send = (res, r) => res.status(r.status).json(r.status === 200 ? { ok: true, ...r, status: undefined } : { ok: false, error: r.error, needsEmail: r.needsEmail });

  router.get('/student/status', auth, (req, res) => res.json({ ok: true, verification: view(req.user) }));
  router.post('/student/submission', big, auth, (req, res) => send(res, submit(req.user, req.body, req)));
  router.delete('/student/submission', auth, (req, res) => send(res, withdraw(req.user, req)));
  router.delete('/student/verification', auth, (req, res) => send(res, erase(req.user, req)));

  /* Reviewer console (accounts listed in VERIFIERS). Every access is logged. */
  const reviewer = (req, res, next) => (isReviewer(req.user) ? next() : res.status(403).json({ ok: false, error: 'Verification team only.' }));
  router.get('/review/queue', auth, reviewer, (req, res) => {
    const items = Object.entries(R).filter(([, r]) => r.state === 'pending_review' && r.submission).map(([uid, r]) => {
      const u = db.users[uid] || {};
      return { uid, own: uid === req.user.id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), universityEmail: r.email, institution: { name: r.institution.name, recognised: r.institution.recognised, domain: r.institution.domain },
        submission: { ...r.submission, documents: r.submission.documents.map(({ sha256: _h, ...d }) => d) }, flights: flightDates(uid), suggestedValidUntil: minDate(r.submission.expiry || defaultValidity(), addMonths(today(), POLICY.maxValidityMonths)),
        previous: r.lastSubmission || null, history: (r.history || []).slice(-5) };
    }).sort((a, b) => a.submission.submittedAt.localeCompare(b.submission.submittedAt));
    audit(req.user.id, 'queue_viewed', '', String(items.length), req); save();
    res.json({ ok: true, items, reasons: REJECT_REASONS, policy: { maxValidityMonths: POLICY.maxValidityMonths, defaultValidity: defaultValidity() } });
  });
  router.get('/review/document/:id', auth, reviewer, (req, res) => {
    const id = String(req.params.id);
    const hit = Object.entries(R).find(([, r]) => r.submission && r.submission.documents.some((d) => d.id === id));
    if (!hit) return res.status(404).json({ ok: false, error: 'Document not found (it may have been deleted).' });
    if (hit[0] === req.user.id) return res.status(403).json({ ok: false, error: "You can't review your own document." });
    const meta = hit[1].submission.documents.find((d) => d.id === id);
    let buf;
    try { buf = readDoc(id); } catch { return res.status(410).json({ ok: false, error: 'Document unavailable.' }); }
    audit(req.user.id, 'document_viewed', hit[0], id, req); save();
    res.set({ 'Content-Type': meta.mime, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="document"', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(buf);
  });
  router.post('/review/:uid/decision', auth, reviewer, (req, res) => {
    const uid = String(req.params.uid);
    if (uid === req.user.id) return res.status(403).json({ ok: false, error: "You can't review your own verification." });
    send(res, decide(uid, req.body || {}, req.user.id, req));
  });
  router.get('/review/audit', auth, reviewer, (req, res) => res.json({ ok: true, entries: db.verifyAudit.slice(-200).reverse() }));
  return router;
}

module.exports = {
  createRouter, recordEmailVerified, emailInUse, statusOf, eligibleOn, summary, clientVerified, view, isReviewer, purge,
  institutionFor, nameMatch, institutionMatch, findExpiry, pdfText, sniff, imageSize, defaultValidity, POLICY, REJECT_REASONS,
  _R: R, _setClock: (fn) => { clock = fn || (() => Date.now()); },
};
