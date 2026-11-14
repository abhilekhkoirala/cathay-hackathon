/* End-to-end tests for two-step student verification (university email + student ID) and its enforcement in
 * the student chat, student seating and student perks. Runs the real Express app on a temporary database.
 * Run from the repo root:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

/* ---------- isolated environment (set BEFORE the app is loaded) ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-test-'));
process.env.LIVE_DB = path.join(TMP, 'db.json');
process.env.DOC_VAULT = path.join(TMP, 'vault');
process.env.DOC_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.VERIFIERS = 'reviewer@cathay.example';
process.env.MODERATORS = '';
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'OAG_KEY']) delete process.env[k];
// A legacy account verified with the old email-only flow, to check it is asked for a student ID.
fs.writeFileSync(process.env.LIVE_DB, JSON.stringify({ users: { u_legacy: { id: 'u_legacy', firstName: 'Lee', lastName: 'Old', email: 'lee@example.com', dob: '2000-01-01', memberId: 'CS 1', refCode: 'LEE-1', createdAt: '2025-01-01T00:00:00Z', salt: 'x', hash: 'y', student: { email: 'lee@cuhk.edu.hk', at: '2025-02-01T00:00:00Z' } } }, sessions: {}, userData: {}, flights: {}, searches: {} }));

const { app } = require('../server');
const SV = require('../student-verify');
const { db } = require('../db');

let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); SV._setClock(null); fs.rmSync(TMP, { recursive: true, force: true }); });

/* ---------- helpers ---------- */
let ip = 0; // each request from a different client address, so the per-IP rate limits don't interfere
async function call(method, p, body, token) {
  ip++;
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${ip >> 8 & 255}.${ip & 255}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? { status: res.status, ...(await res.json()) } : { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}
let n = 0;
async function signup(first = 'Jane', last = 'Doe') {
  const r = await call('POST', '/api/auth/signup', { firstName: first, lastName: last, email: `user${++n}@example.com`, password: 'password123', dob: '2002-05-05' });
  assert.equal(r.status, 200, r.error);
  return { token: r.token, user: r.user };
}
async function verifyEmail(token, email) {
  const s = await call('POST', '/api/verify/start', { email }, token);
  assert.equal(s.status, 200, s.error); assert.match(s.demoCode, /^\d{6}$/);
  const c = await call('POST', '/api/verify/confirm', { email, code: s.demoCode }, token);
  return c;
}
let reviewerToken = null;
async function getReviewer() {
  if (reviewerToken) return reviewerToken;
  const r = await call('POST', '/api/auth/signup', { firstName: 'Rita', lastName: 'Reviewer', email: 'reviewer@cathay.example', password: 'password123', dob: '1990-01-01' });
  reviewerToken = r.token; return reviewerToken;
}

/* Test documents: a "photo" (PNG with real dimensions), a JPEG, and a digital PDF with text. */
function png(width = 1200, height = 760, size = 60 * 1024) {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  for (let i = 40; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}
function jpeg(width = 1600, height = 1000) {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([head, Buffer.alloc(50 * 1024, 7), Buffer.from([0xff, 0xd9])]);
}
function pdf(lines, { encrypt = false, js = false } = {}) {
  const content = 'BT /F1 12 Tf 72 720 Td ' + lines.map((l) => `(${l.replace(/[()\\]/g, (c) => '\\' + c)}) Tj T*`).join(' ') + ' ET';
  const z = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${js ? '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' : ''}>> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    z, Buffer.from(`\nendstream\nendobj\n${encrypt ? 'trailer << /Encrypt 5 0 R >>\n' : ''}%%EOF\n`, 'latin1'),
  ]);
}
const doc = (buf, mime, role = 'student_id', name = 'id') => ({ role, mime, name, data: buf.toString('base64') });
const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const declared = (o = {}) => ({ fullName: 'Jane Doe', institution: 'The Chinese University of Hong Kong', expiry: inDays(400), ...o });
const flags = (v) => (v.submission ? v.submission.notices : []);
const vaultFiles = () => { try { return fs.readdirSync(process.env.DOC_VAULT).filter((f) => f.endsWith('.bin')); } catch { return []; } };
async function newStudent(first = 'Jane', last = 'Doe', email) {
  const a = await signup(first, last);
  const c = await verifyEmail(a.token, email || `${first.toLowerCase()}${n}@link.cuhk.edu.hk`);
  assert.equal(c.status, 200, c.error);
  return a;
}
async function queueItem(uid) {
  const q = await call('GET', '/api/review/queue', undefined, await getReviewer());
  assert.equal(q.status, 200);
  return q.items.find((i) => i.uid === uid);
}
const seg = (dep) => ({ number: 'CX 250', from: 'HKG', to: 'LHR', dep: dep + 'T10:00', arr: dep + 'T18:00', aircraft: 'A350-1000', durMin: 780, stops: 0 });
const trip = (dep) => ({ ref: 'R' + dep.replace(/-/g, ''), status: 'Confirmed', cabin: 'Economy', segments: [{ ...seg(dep), fare: 'Essential', seat: '' }], pax: [{ first: 'Jane', last: 'Doe' }] });

/* ---------- tests ---------- */
test('step 1 (email) alone is not enough: status is awaiting_document and student features stay locked', async () => {
  const a = await newStudent();
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'awaiting_document');
  assert.match(s.verification.label, /Awaiting document upload/);
  assert.ok(s.verification.nextSteps.length);
  const me = await call('GET', '/api/me', undefined, a.token);
  assert.equal(me.data.verified, null);
  assert.equal(me.user.student.status, 'awaiting_document');
  assert.ok(!SV.eligibleOn(db.users[a.user.id], inDays(10)).ok);
});

test('not submitted: a new account has status not_submitted', async () => {
  const a = await signup();
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'not_submitted');
  const up = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  assert.equal(up.status, 409); // email first
});

test('successful email + student ID: pending review → approved → verified; document deleted, outcome kept', async () => {
  const a = await newStudent();
  const before = vaultFiles().length;
  const up = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(jpeg(), 'image/jpeg')] }, a.token);
  assert.equal(up.status, 200, up.error);
  assert.equal(up.view.status, 'pending_review');
  assert.deepEqual(flags(up.view), []);
  assert.equal(vaultFiles().length, before + 1);

  // Stored encrypted: the vault file doesn't contain the uploaded bytes.
  const item = await queueItem(a.user.id);
  const raw = fs.readFileSync(path.join(process.env.DOC_VAULT, item.submission.documents[0].id + '.bin'));
  assert.equal(raw.includes(jpeg().slice(0, 64)), false);
  assert.ok(item.submission.checks.find((c) => c.id === 'institution' && c.result === 'pass'));
  assert.ok(item.submission.checks.find((c) => c.id === 'name' && c.result === 'pass'));

  // A reviewer can open it (and it's logged); the student and other users cannot.
  const d = await call('GET', '/api/review/document/' + item.submission.documents[0].id, undefined, await getReviewer());
  assert.equal(d.status, 200); assert.equal(d.headers.get('cache-control'), 'no-store, private'); assert.ok(d.buf.equals(jpeg()));
  assert.equal((await call('GET', '/api/review/document/' + item.submission.documents[0].id, undefined, a.token)).status, 403);
  assert.ok(db.verifyAudit.some((e) => e.action === 'document_viewed' && e.subject === a.user.id));

  const dec = await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', submissionId: item.submission.id }, await getReviewer());
  assert.equal(dec.status, 200, dec.error); assert.equal(dec.outcome, 'approved');
  assert.ok(dec.validUntil <= inDays(366));
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'verified');
  assert.equal(vaultFiles().length, before); // deleted after the decision
  assert.ok(db.verifyAudit.some((e) => e.action === 'document_deleted' && e.subject === a.user.id));
  assert.equal(SV._R[a.user.id].submission, null);
  const me = await call('GET', '/api/me', undefined, a.token);
  assert.equal(me.data.verified.email, SV._R[a.user.id].email);
});

test('expired student ID is flagged (not auto-rejected); reviewer rejects; student resubmits with enrolment letter', async () => {
  const a = await newStudent();
  const up = await call('POST', '/api/student/submission', { declared: declared({ expiry: inDays(-20) }), documents: [doc(png(), 'image/png')] }, a.token);
  assert.equal(up.status, 200); assert.equal(up.view.status, 'pending_review');
  assert.ok(flags(up.view).includes('Document has expired'));

  const item = await queueItem(a.user.id);
  // Approving with a date in the past is refused.
  assert.equal((await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', validUntil: inDays(-20) }, await getReviewer())).status, 400);
  const rej = await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'reject', reasonCode: 'expired', submissionId: item.submission.id }, await getReviewer());
  assert.equal(rej.outcome, 'rejected');
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'rejected');
  assert.match(s.verification.label, /additional information required/);
  assert.match(s.verification.rejection.reason, /expired/);

  // Resubmission (same card + a current enrolment letter): goes back to review; same rejected file is flagged for the reviewer.
  const re = await call('POST', '/api/student/submission', { declared: declared({ expiry: null, noExpiry: true }), documents: [doc(png(), 'image/png'), doc(pdf(['Jane Doe', 'The Chinese University of Hong Kong', 'Programme end date: 30/06/2027']), 'application/pdf', 'enrolment_proof')] }, a.token);
  assert.equal(re.status, 200, re.error); assert.equal(re.view.status, 'pending_review');
  const it2 = await queueItem(a.user.id);
  assert.ok(it2.submission.checks.some((c) => c.id === 'dup_student_id'));
  assert.equal(it2.submission.detectedExpiry, '2027-06-30'); // read from the PDF text
});

test('student ID without an expiry date: accepted for review, approved with the policy validity', async () => {
  const a = await newStudent();
  const up = await call('POST', '/api/student/submission', { declared: declared({ expiry: null, noExpiry: true }), documents: [doc(png(), 'image/png')] }, a.token);
  assert.equal(up.status, 200); assert.equal(up.view.status, 'pending_review');
  const item = await queueItem(a.user.id);
  assert.ok(item.submission.checks.some((c) => c.id === 'expiry' && c.result === 'info'));
  assert.equal(item.suggestedValidUntil, SV.defaultValidity());
  const dec = await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve' }, await getReviewer());
  assert.equal(dec.validUntil, SV.defaultValidity());
  assert.equal(SV._R[a.user.id].validitySource, 'policy_default');
  // Missing both an expiry and the "no expiry" tick is a form error, not a rejection.
  const b = await newStudent();
  assert.equal((await call('POST', '/api/student/submission', { declared: declared({ expiry: null }), documents: [doc(png(), 'image/png')] }, b.token)).status, 400);
});

test('mismatched names or institutions are flagged for a reviewer, never auto-rejected', async () => {
  const a = await newStudent();
  const up = await call('POST', '/api/student/submission', { declared: declared({ fullName: 'John Smith', institution: 'University of Oxford' }), documents: [doc(png(), 'image/png')] }, a.token);
  assert.equal(up.view.status, 'pending_review');
  assert.ok(flags(up.view).includes("Name doesn't match the account"));
  assert.ok(flags(up.view).includes("Institution doesn't match the university email"));
  const rej = await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'reject', reasonCode: 'name_mismatch', message: 'Please upload your own card.' }, await getReviewer());
  assert.equal(rej.outcome, 'rejected');
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.rejection.reasonCode, 'name_mismatch');
  assert.equal(s.verification.rejection.message, 'Please upload your own card.');
  // Matching rules: order, accents and middle names don't matter.
  assert.equal(SV.nameMatch('Jane Doe', 'DOE Jane Mary'), 'match');
  assert.equal(SV.nameMatch('José Núñez', 'Jose Nunez'), 'match');
  assert.equal(SV.nameMatch('Jane Doe', 'Janie Doe'), 'partial');
  assert.equal(SV.institutionMatch(SV.institutionFor('a@link.cuhk.edu.hk'), 'CUHK'), 'match');
  // Unlisted .edu institution: flagged for review, not rejected.
  const b = await newStudent('Jane', 'Doe', `jane${n}@smallcollege.edu`);
  const up2 = await call('POST', '/api/student/submission', { declared: declared({ institution: 'Smallcollege' }), documents: [doc(png(), 'image/png')] }, b.token);
  assert.equal(up2.view.status, 'pending_review');
  assert.ok((await queueItem(b.user.id)).submission.flags.includes('institution'));
});

test('blurry/low-resolution, incomplete and unsupported documents', async () => {
  const a = await newStudent();
  const post = (documents, d = declared()) => call('POST', '/api/student/submission', { declared: d, documents }, a.token);
  assert.match((await post([{ role: 'student_id', mime: 'image/gif', data: Buffer.from('GIF89a....').toString('base64') }])).error, /JPG, PNG or PDF/);
  assert.match((await post([doc(Buffer.from('hello world'), 'image/png')])).error, /JPG, PNG or PDF/);
  assert.match((await post([doc(png(), 'application/pdf')])).error, /don't match/); // spoofed type
  assert.match((await post([doc(Buffer.concat([png(), Buffer.alloc(5.5 * 1024 * 1024)]), 'image/png')])).error, /too large/);
  assert.match((await post([doc(pdf(['x'], { encrypt: true }), 'application/pdf')])).error, /password-protected/);
  assert.match((await post([doc(pdf(['x'], { js: true }), 'application/pdf')])).error, /scripts/);
  assert.match((await post([doc(png(), 'image/png', 'enrolment_proof')])).error, /student ID/); // the ID itself is required
  assert.match((await post([doc(png(), 'image/png')], declared({ fullName: '' }))).error, /full name/);
  assert.equal(SV._R[a.user.id].state, 'awaiting_document'); // none of those changed the status
  // Low resolution: accepted but flagged so the student can replace it and the reviewer knows.
  const low = await post([doc(png(320, 200), 'image/png')]);
  assert.equal(low.status, 200);
  assert.ok(flags(low.view).includes('Student ID: low resolution'));
});

test('manual review and resubmission: replace and remove a pending document', async () => {
  const a = await newStudent();
  const first = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(400, 300), 'image/png')] }, a.token);
  const firstId = (await queueItem(a.user.id)).submission.documents[0].id;
  const second = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(jpeg(), 'image/jpeg')] }, a.token);
  assert.equal(second.view.status, 'pending_review');
  assert.notEqual(second.view.submission.id, first.view.submission.id);
  assert.equal(fs.existsSync(path.join(process.env.DOC_VAULT, firstId + '.bin')), false); // replaced file deleted
  // A stale decision (made on the replaced file) is refused.
  assert.equal((await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', submissionId: first.view.submission.id }, await getReviewer())).status, 409);
  const rm = await call('DELETE', '/api/student/submission', undefined, a.token);
  assert.equal(rm.view.status, 'awaiting_document');
  assert.equal((await queueItem(a.user.id)), undefined);
});

test('expiry before a booked flight: flagged; verification does not cover that flight; student seating refused there', async () => {
  const a = await newStudent();
  const near = inDays(20), far = inDays(200);
  await call('PUT', '/api/me/data', { data: { trips: [trip(near), trip(far)] } }, a.token);
  const up = await call('POST', '/api/student/submission', { declared: declared({ expiry: inDays(90) }), documents: [doc(png(), 'image/png')] }, a.token);
  assert.ok(flags(up.view).includes('Expires before a booked flight'));
  await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', validUntil: inDays(90) }, await getReviewer());
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'verified');
  assert.deepEqual(s.verification.flightsNotCovered, [far]);
  const u = db.users[a.user.id];
  assert.equal(SV.eligibleOn(u, near + 'T10:00').ok, true);
  assert.equal(SV.eligibleOn(u, far + 'T10:00').ok, false);
  const ok = await call('POST', `/api/live/flights/CX250-${near}/pax`, { seg: seg(near), cabin: 'Economy', student: { share: true } }, a.token);
  assert.equal(ok.studentDenied, undefined);
  assert.equal(db.flights[`CX250-${near}`].pax[a.user.id].student, true);
  assert.equal(db.flights[`CX250-${near}`].pax[a.user.id].uni, 'CUHK'); // from the verified email, not the request
  const no = await call('POST', `/api/live/flights/CX250-${far}/pax`, { seg: seg(far), cabin: 'Economy', student: { uni: 'Fake U', share: true } }, a.token);
  assert.match(no.studentDenied, /valid until/);
  assert.equal(db.flights[`CX250-${far}`].pax[a.user.id].student, false);
  // Re-verification is allowed early because a booked flight isn't covered, and the current verification stays active meanwhile.
  const re = await call('POST', '/api/student/submission', { declared: declared({ expiry: inDays(300) }), documents: [doc(jpeg(), 'image/jpeg')] }, a.token);
  assert.equal(re.status, 200, re.error); assert.equal(re.view.status, 'pending_review'); assert.equal(re.view.active, true);
  assert.equal(SV.eligibleOn(u, near).ok, true);
});

test('student features are refused without verified status (chat, seating, perks, client-set flags)', async () => {
  const a = await newStudent(); // email only
  const dep = inDays(3);
  await call('POST', `/api/live/flights/CX251-${dep}/pax`, { seg: { ...seg(dep), number: 'CX 251' }, cabin: 'Economy', student: { uni: 'CUHK', share: true } }, a.token);
  assert.equal(db.flights[`CX251-${dep}`].pax[a.user.id].student, false);
  const chat = await call('GET', `/api/chat/CX251-${dep}/status`, undefined, a.token);
  assert.equal(chat.eligible, false); assert.match(chat.reason, /Upload your student ID/);
  assert.equal((await call('POST', `/api/chat/CX251-${dep}/join`, { acceptGuidelines: true }, a.token)).status, 403);
  // A device can't make itself verified or grant itself student perks.
  await call('PUT', '/api/me/data', { data: { verified: { email: 'x@mit.edu' }, perks: { welcome: 1500, redeemed: [{ id: 'lounge', ref: 'X', pts: 6000 }], seatBuys: [{ with: 'sp', amount: 1000 }, { with: 'miles', amount: 2500 }] } } }, a.token);
  const me = await call('GET', '/api/me', undefined, a.token);
  assert.equal(me.data.verified, null);
  assert.equal(me.data.perks.welcome, undefined); assert.equal(me.data.perks.redeemed, undefined);
  assert.deepEqual(me.data.perks.seatBuys, [{ with: 'miles', amount: 2500 }]);
  // Reviewer console is for the verification team only.
  assert.equal((await call('GET', '/api/review/queue', undefined, a.token)).status, 403);
  assert.equal((await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve' }, a.token)).status, 403);
  assert.equal((await call('GET', '/api/student/status')).status, 401);
});

test('verified students: chat opens; then eligibility ends on the validity date and on a policy change', async () => {
  const a = await newStudent();
  await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', validUntil: inDays(40) }, await getReviewer());
  const dep = inDays(3);
  await call('POST', `/api/live/flights/CX252-${dep}/pax`, { seg: { ...seg(dep), number: 'CX 252' }, cabin: 'Economy', student: { share: false } }, a.token);
  const chat = await call('GET', `/api/chat/CX252-${dep}/status`, undefined, a.token);
  assert.equal(chat.eligible, true, chat.reason);
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.expiresSoon, false);

  try {
    SV._setClock(() => Date.now() + 15 * 864e5); // 15 days later: expiring soon
    assert.equal((await call('GET', '/api/student/status', undefined, a.token)).verification.expiresSoon, true);
    SV._setClock(() => Date.now() + 45 * 864e5); // after the validity date
    const st = await call('GET', '/api/student/status', undefined, a.token);
    assert.equal(st.verification.status, 'expired');
    assert.match(st.verification.label, /re-verification required/);
    assert.equal((await call('GET', '/api/me', undefined, a.token)).data.verified, null);
    assert.equal(SV.eligibleOn(db.users[a.user.id]).ok, false);
  } finally { SV._setClock(null); }

  SV.POLICY.version = 2; // the airline changes its eligibility policy
  try {
    const st = await call('GET', '/api/student/status', undefined, a.token);
    assert.equal(st.verification.status, 'expired');
    assert.match(st.verification.explanation, /policy has been updated/);
    const chat2 = await call('GET', `/api/chat/CX252-${dep}/status`, undefined, a.token);
    assert.equal(chat2.eligible, false);
  } finally { SV.POLICY.version = 1; }
});

test('university email that is over a year old must be confirmed again at re-verification', async () => {
  const a = await newStudent();
  await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  await call('POST', `/api/review/${a.user.id}/decision`, { decision: 'approve', validUntil: inDays(30) }, await getReviewer());
  try {
    SV._setClock(() => Date.now() + 400 * 864e5);
    const st = await call('GET', '/api/student/status', undefined, a.token);
    assert.equal(st.verification.status, 'expired'); assert.equal(st.verification.needsEmail, true);
    const up = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
    assert.equal(up.status, 409); assert.equal(up.needsEmail, true);
  } finally { SV._setClock(null); }
});

test('one university email per account; reviewers cannot review themselves', async () => {
  const email = `shared${Date.now()}@link.cuhk.edu.hk`;
  const a = await newStudent('Jane', 'Doe', email);
  await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  const b = await signup('Other', 'Person');
  const s = await call('POST', '/api/verify/start', { email }, b.token);
  assert.equal(s.status, 409);
  const rt = await getReviewer();
  const rid = (await call('GET', '/api/me', undefined, rt)).user.id;
  assert.equal((await call('POST', `/api/review/${rid}/decision`, { decision: 'approve' }, rt)).status, 403);
});

test('automated approval of a clear digital PDF (when enabled); expiry read from the document', async () => {
  SV.POLICY.autoApprove = 'pdf-text';
  try {
    const a = await newStudent();
    const p = pdf(['STUDENT CARD', 'The Chinese University of Hong Kong', 'Name: DOE Jane', 'Date of birth: 05/05/2002', 'Valid until: 31 Aug 2027']);
    const up = await call('POST', '/api/student/submission', { declared: declared({ expiry: '2027-08-31' }), documents: [doc(p, 'application/pdf')] }, a.token);
    assert.equal(up.status, 200, up.error);
    assert.equal(up.view.status, 'verified');
    assert.equal(SV._R[a.user.id].validitySource, 'document_text');
    assert.equal(SV._R[a.user.id].decision.auto, true);
    // A photo can't be read automatically in the prototype, so it always goes to a person.
    const b = await newStudent();
    const up2 = await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, b.token);
    assert.equal(up2.view.status, 'pending_review');
  } finally { SV.POLICY.autoApprove = 'off'; }
});

test('expiry detection only uses dates next to a validity keyword', () => {
  assert.equal(SV.findExpiry('Date of birth 01/02/2001\nExpiry: 2027-07-31'), '2027-07-31');
  assert.equal(SV.findExpiry('Valid thru 08/2028'), '2028-08-31');
  assert.equal(SV.findExpiry('Expected graduation: June 2027'), '2027-06-30');
  assert.equal(SV.findExpiry('Issued 01/09/2025, DOB 03/03/2003'), null);
  assert.equal(SV.sniff(Buffer.from('GIF89a')), '');
});

test('legacy email-only verification is migrated to awaiting_document', () => {
  assert.equal(SV.statusOf(db.users.u_legacy), 'awaiting_document');
  assert.equal(db.users.u_legacy.student, undefined);
});

test('erase: the student can remove their verification entirely', async () => {
  const a = await newStudent();
  await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  const id = (await queueItem(a.user.id)).submission.documents[0].id;
  assert.equal((await call('DELETE', '/api/student/verification', undefined, a.token)).status, 200);
  assert.equal(fs.existsSync(path.join(process.env.DOC_VAULT, id + '.bin')), false);
  assert.equal((await call('GET', '/api/student/status', undefined, a.token)).verification.status, 'not_submitted');
});

test('retention: unreviewed documents are deleted after 30 days and the student is asked to upload again', async () => {
  const a = await newStudent();
  await call('POST', '/api/student/submission', { declared: declared(), documents: [doc(png(), 'image/png')] }, a.token);
  const id = (await queueItem(a.user.id)).submission.documents[0].id;
  try {
    SV._setClock(() => Date.now() + 31 * 864e5);
    SV.purge();
  } finally { SV._setClock(null); }
  assert.equal(fs.existsSync(path.join(process.env.DOC_VAULT, id + '.bin')), false);
  const s = await call('GET', '/api/student/status', undefined, a.token);
  assert.equal(s.verification.status, 'rejected');
  assert.match(s.verification.rejection.message, /upload it again/);
});
