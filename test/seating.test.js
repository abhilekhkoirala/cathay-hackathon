/* Student Zone seating: allocation engine (unit) and the seating API end to end (real Express app, temporary DB).
 * Run from the repo root:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-test-'));
process.env.LIVE_DB = path.join(TMP, 'db.json');
process.env.DOC_VAULT = path.join(TMP, 'vault');
process.env.DOC_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.SEAT_OPS = 'ops@cathay.example';
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'OAG_KEY', 'VERIFIERS', 'MODERATORS']) delete process.env[k];

const engine = require('../seating/engine');
const { app } = require('../server');
const S = require('../seating/service');
const SV = require('../student-verify');
const { db } = require('../db');

/* ======================= engine (pure) ======================= */
const WIDE = { blocks: [['A', 'B', 'C'], ['D', 'E', 'G'], ['H', 'J', 'K']], first: 40, last: 62 };
const st = (id, extra = {}) => ({ id, uni: 'X', order: Number(id.replace(/\D/g, '')) || 0, locked: null, prev: null, ...extra });
const ok = (out, pairs) => assert.deepEqual(engine.violations(WIDE, out.seatOf, pairs), []);

test('engine: adjacency is same row, same block; an aisle breaks it', () => {
  assert.deepEqual(engine.adjacent(WIDE, '50B').sort(), ['50A', '50C']);
  assert.deepEqual(engine.adjacent(WIDE, '50C'), ['50B']);       // 50D is across the aisle
  assert.deepEqual(engine.adjacent(WIDE, '50D'), ['50E']);
  assert.ok(!engine.adjacent(WIDE, '50A').includes('51A'));     // different rows are never adjacent
  assert.deepEqual(engine.adjacent(WIDE, '99A'), []);
});

test('engine: groups students side by side when nothing forbids it', () => {
  const out = engine.allocate({ layout: WIDE, zoneSeats: engine.seatsOf(WIDE, [50, 50]), students: [st('s1'), st('s2'), st('s3')], pairs: [] });
  assert.equal(Object.keys(out.seatOf).length, 3);
  const seats = Object.values(out.seatOf).sort();
  assert.deepEqual(engine.runs(WIDE, seats, () => true).map((r) => r.length), [3]);
});

test('engine: an exclusion in either direction keeps the pair apart; multiple and overlapping exclusions', () => {
  const zone = engine.seatsOf(WIDE, [50, 50]);
  for (const pairs of [[['s1', 's2']], [['s2', 's1']], [['s1', 's2'], ['s2', 's1']]]) ok(engine.allocate({ layout: WIDE, zoneSeats: zone, students: [st('s1'), st('s2')], pairs }), pairs);
  const many = [['s1', 's2'], ['s1', 's3'], ['s1', 's4']];
  const out = engine.allocate({ layout: WIDE, zoneSeats: zone, students: ['s1', 's2', 's3', 's4'].map((x) => st(x)), pairs: many });
  ok(out, many); assert.equal(out.unplaced.length, 0);
  // Dense, overlapping restrictions in a small zone: the exact solver must find a valid arrangement.
  const students = ['s1', 's2', 's3', 's4', 's5', 's6'].map((x) => st(x));
  const dense = [['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s4', 's5'], ['s5', 's6'], ['s1', 's3'], ['s2', 's4'], ['s3', 's5'], ['s4', 's6']];
  const out2 = engine.allocate({ layout: WIDE, zoneSeats: zone, students, pairs: dense });
  ok(out2, dense); assert.equal(out2.unplaced.length, 0);
});

test('engine: impossible arrangement is never forced: student left for review', () => {
  const pairs = [['s1', 's2'], ['s2', 's3'], ['s1', 's3']];
  const out = engine.allocate({ layout: WIDE, zoneSeats: ['50A', '50B', '50C'], students: ['s1', 's2', 's3'].map((x) => st(x)), pairs });
  ok(out, pairs);
  assert.equal(out.unplaced.length, 1); assert.equal(out.unplaced[0].reason, 'constraint');
});

test('engine: capacity, locked seats, previous seats', () => {
  const zone = ['50A', '50B', '50C'];
  const cap = engine.allocate({ layout: WIDE, zoneSeats: zone, students: ['s1', 's2', 's3', 's4'].map((x) => st(x)), pairs: [] });
  assert.deepEqual(cap.unplaced, [{ id: 's4', reason: 'capacity' }]); // latest booking waits
  // Locked never moves: the unlocked one moves away from the locked one it is restricted with.
  const out = engine.allocate({ layout: WIDE, zoneSeats: engine.seatsOf(WIDE, [50, 50]), students: [st('s1', { locked: '50B' }), st('s2', { prev: '50C' })], pairs: [['s1', 's2']] });
  assert.equal(out.seatOf.s1, '50B'); assert.notEqual(out.seatOf.s2, '50C'); ok(out, [['s1', 's2']]);
  // Two locked passengers who break a restriction are reported, not moved.
  const lc = engine.allocate({ layout: WIDE, zoneSeats: zone, students: [st('s1', { locked: '50A' }), st('s2', { locked: '50B' })], pairs: [['s1', 's2']] });
  assert.deepEqual(lc.conflicts, [['s1', 's2']]); assert.equal(lc.seatOf.s1, '50A'); assert.equal(lc.seatOf.s2, '50B');
  // Previous seats are kept: only the student whose seat disappeared moves.
  const prev = { s1: '50A', s2: '50B', s3: '51A' };
  const again = engine.allocate({ layout: WIDE, zoneSeats: engine.seatsOf(WIDE, [50, 51]).filter((x) => x !== '51A'), students: ['s1', 's2', 's3'].map((x) => st(x, { prev: prev[x] })), pairs: [] });
  assert.deepEqual(again.moved, ['s3']); assert.equal(again.seatOf.s1, '50A'); assert.equal(again.seatOf.s2, '50B');
});

/* ======================= API end to end ======================= */
let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); S._setClock(null); fs.rmSync(TMP, { recursive: true, force: true }); });

let ip = 0, n = 0;
async function call(method, p, body, token) {
  ip++;
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${ip >> 8 & 255}.${ip & 255}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: res.status, raw: text, ...j };
}
const UNIS = ['link.cuhk.edu.hk', 'nus.edu.sg', 'mit.edu'];
/* An account; `student` makes it a verified student (verification itself is tested in student-verify.test.js). */
async function person(first, { student = true, uni = 0, email } = {}) {
  const r = await call('POST', '/api/auth/signup', { firstName: first, lastName: 'T' + (++n), email: email || `p${n}@example.com`, password: 'password123', dob: '2001-01-01' });
  assert.equal(r.status, 200, r.error);
  if (student) SV._R[r.user.id] = { email: `${first.toLowerCase()}${n}@${UNIS[uni]}`, emailVerifiedAt: new Date().toISOString(), institution: SV.institutionFor('x@' + UNIS[uni]),
    state: 'verified', validUntil: '2099-12-31', verifiedAt: new Date().toISOString(), policyVersion: SV.POLICY.version, history: [], rejectedHashes: [] };
  return { token: r.token, id: r.user.id, name: first };
}
const hoursFromNow = (h) => { const d = new Date(Date.now() + h * 3600e3); return d.toISOString().slice(0, 16); };
let fno = 100;
function flight(hours = 30, aircraft = 'A350-900') {
  const dep = hoursFromNow(hours), number = 'CX ' + (++fno);
  const seg = { number, from: 'HKG', to: 'LHR', dep, arr: hoursFromNow(hours + 13), aircraft };
  return { seg, fid: number.replace(' ', '') + '-' + dep.slice(0, 10) };
}
const book = (p, F, o = {}) => call('PUT', `/api/seating/flights/${F.fid}/booking`, { seg: F.seg, cabin: 'Economy', fare: 'Essential', studentSeating: true, ...o }, p.token);
const map = async (p, F) => (await call('GET', `/api/seating/flights/${F.fid}/seatmap`, undefined, p.token)).view;
const rec = (F) => db.flights[F.fid];
const seatOf = (F, p) => rec(F).pax[p.id].seat;
const adjacentTo = (F, a, b) => engine.adjacent({ ...WIDE, first: 40, last: 62 }, seatOf(F, a)).includes(seatOf(F, b));
async function joinChat(F, ...people) { for (const p of people) { const r = await call('POST', `/api/chat/${F.fid}/join`, { acceptGuidelines: true }, p.token); assert.equal(r.status, 200, r.error); } }
async function exclude(F, who, ...targets) {
  const list = (await call('GET', `/api/seating/flights/${F.fid}/participants`, undefined, who.token)).participants;
  const handles = targets.map((t) => list.find((x) => x.name === t.name).handle);
  return call('PUT', `/api/seating/flights/${F.fid}/exclusions`, { handles }, who.token);
}
let opsToken;
const ops = async () => opsToken || (opsToken = (await call('POST', '/api/auth/signup', { firstName: 'Olga', lastName: 'Ops', email: 'ops@cathay.example', password: 'password123', dob: '1980-01-01' })).token);
const noViolations = (F) => {
  const pairs = Object.entries(db.seatPrefs[F.fid] || {}).flatMap(([a, r]) => r.excludes.map((b) => [a, b]));
  const seats = Object.fromEntries(Object.entries(rec(F).pax).map(([u, p]) => [u, p.seat]));
  assert.deepEqual(engine.violations(WIDE, seats, pairs), []);
};

test('verified students are allocated in the Student Zone; booking fields from the client are not trusted', async () => {
  const F = flight();
  const a = await person('Ann'), b = await person('Ben'), c = await person('Cat', { student: false });
  for (const p of [a, b]) assert.equal((await book(p, F)).status, 200);
  const r = await book(c, F, { student: true, uni: 'Fake' });
  assert.match(r.studentDenied, /Verify your student status/);
  const v = await map(a, F);
  assert.equal(v.me.alloc, 'assigned'); assert.equal(v.me.student, true);
  assert.ok(v.me.seat >= '48' && v.zone.rows[0] === 48);
  assert.ok(adjacentTo(F, a, b), 'two students are grouped side by side');
  assert.equal(rec(F).pax[c.id].student, false); assert.equal(rec(F).pax[c.id].seat, null);
  assert.equal(v.zone.students, 2); assert.equal(v.zone.available, v.zone.capacity - 2);
  // The non-student sees zone seats as reserved, not free; no other passenger's id or name appears in any view.
  const cv = await map(c, F);
  assert.equal(cv.seats[seatOf(F, a)], 'x'); assert.ok(Object.values(cv.seats).includes('zone'));
  const raw = JSON.stringify([v, cv]);
  for (const p of [a, b, c]) { assert.ok(!raw.includes(p.id)); assert.ok(!raw.includes(S.pseudo(p.id, F.fid)) || p === a); }
  assert.ok(!raw.includes('Ben') && !raw.includes('exclu'));
});

test('unilateral exclusion → mutual restriction, invisible to the other student', async () => {
  const F = flight();
  const a = await person('Amy'), b = await person('Bob'), c = await person('Cid');
  for (const p of [a, b, c]) await book(p, F);
  await joinChat(F, a, b, c);
  assert.ok(adjacentTo(F, a, b) || adjacentTo(F, b, c) || adjacentTo(F, a, c));
  const before = JSON.stringify(await map(b, F));
  const r = await exclude(F, a, b);
  assert.equal(r.status, 200); assert.match(r.message, /private/);
  assert.equal(adjacentTo(F, a, b), false); noViolations(F);
  // Bob only sees his own seat; nothing says why or by whom. His participant list doesn't show Amy's choice.
  const bv = await map(b, F), blist = (await call('GET', `/api/seating/flights/${F.fid}/participants`, undefined, b.token)).participants;
  assert.ok(!JSON.stringify(bv).match(/exclu|Amy|restrict/i)); void before;
  assert.equal(blist.find((x) => x.name === 'Amy').excluded, false);
  // Handles differ per viewer, so lists can't be compared to identify people.
  const alist = (await call('GET', `/api/seating/flights/${F.fid}/participants`, undefined, a.token)).participants;
  assert.notEqual(alist.find((x) => x.name === 'Cid').handle, blist.find((x) => x.name === 'Cid').handle);
  // Audit records that preferences changed, never who was excluded.
  const e = db.seatAudit.filter((x) => x.fid === F.fid && x.action === 'exclusions_updated');
  assert.ok(e.length && e.every((x) => !JSON.stringify(x).includes(b.id) && !JSON.stringify(x).includes('Bob')));
  // Mutual submission, then Amy withdraws: Bob's own exclusion still keeps them apart.
  await exclude(F, b, a); await exclude(F, a);
  assert.equal(adjacentTo(F, a, b), false); noViolations(F);
});

test('one student excluding several, and several overlapping exclusions', async () => {
  const F = flight();
  const ppl = [];
  for (const nm of ['Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo']) ppl.push(await person(nm, { uni: ppl.length % 2 }));
  for (const p of ppl) await book(p, F);
  await joinChat(F, ...ppl);
  const [d, e, f2, g, h, i, j] = ppl;
  assert.equal((await exclude(F, d, e, f2, g)).status, 200);
  await exclude(F, e, f2); await exclude(F, g, h, i); await exclude(F, i, j, e);
  noViolations(F);
  assert.ok(ppl.every((p) => rec(F).pax[p.id].alloc === 'assigned'), 'everyone still has a zone seat');
});

test('insufficient Student Zone capacity: waitlisted, reviewed, then placed when operations enlarge the zone', async () => {
  const F = flight(), O = await ops();
  const ppl = [];
  for (let k = 0; k < 4; k++) ppl.push(await person('Zed' + k));
  await book(ppl[0], F);
  assert.equal((await call('PUT', `/api/seating/ops/flights/${F.fid}/zone`, { firstRow: 50, lastRow: 50, reason: 'test' }, ppl[0].token)).status, 403); // passengers can't
  assert.equal((await call('PUT', `/api/seating/ops/flights/${F.fid}/zone`, { firstRow: 50, lastRow: 50, reason: 'small zone' }, O)).status, 200);
  // Fill the zone row: block 6 seats so only 3 are usable, then book 4 students.
  for (const s of ['50D', '50E', '50G', '50H', '50J', '50K']) await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: s, action: 'block', reason: 'test' }, O);
  for (const p of ppl.slice(1)) await book(p, F);
  const last = await map(ppl[3], F);
  assert.equal(last.me.alloc, 'waitlisted'); assert.match(last.me.notice, /full/); assert.equal(last.me.seat, null);
  assert.equal(last.zone.available, 0);
  const ov = (await call('GET', `/api/seating/ops/flights/${F.fid}`, undefined, O)).flight;
  assert.ok(ov.reviews.some((r) => r.kind === 'capacity' && r.status === 'open'));
  // No phantom seats: blocked seats are not counted as zone capacity.
  assert.equal(last.zone.capacity, 3);
  await call('PUT', `/api/seating/ops/flights/${F.fid}/zone`, { firstRow: 50, lastRow: 51, reason: 'demand' }, O);
  assert.equal((await map(ppl[3], F)).me.alloc, 'assigned');
  assert.ok((await call('GET', `/api/seating/ops/flights/${F.fid}`, undefined, O)).flight.reviews.every((r) => r.kind !== 'capacity' || r.status === 'resolved'));
});

test('a seat becoming unavailable moves only the affected student; a checked-in passenger is never moved automatically', async () => {
  const F = flight(), O = await ops();
  const a = await person('Kim'), b = await person('Lou'), c = await person('Max');
  for (const p of [a, b, c]) await book(p, F);
  const before = { a: seatOf(F, a), b: seatOf(F, b), c: seatOf(F, c) };
  assert.equal((await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: before.c, action: 'block', reason: 'broken recline' }, O)).status, 200);
  assert.notEqual(seatOf(F, c), before.c); assert.equal(seatOf(F, a), before.a); assert.equal(seatOf(F, b), before.b);
  // Zone seats can't be sold through another channel while the zone is protected.
  const sell = await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: seatOf(F, a), action: 'sell' }, O);
  assert.equal(sell.status, 409); assert.match(sell.error, /protected for the Student Zone/);
  // A checked-in passenger whose seat becomes unusable stays put and is flagged for operations.
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, a.token)).status, 200);
  const locked = seatOf(F, a);
  await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: locked, action: 'block', reason: 'broken' }, O);
  assert.equal(seatOf(F, a), locked);
  assert.ok(rec(F).reviews.some((r) => r.kind === 'seat_unavailable' && r.status === 'open' && r.uids.includes(a.id)));
  // Only an authorised operational move, with a reason, relocates them (audited).
  assert.equal((await call('POST', `/api/seating/ops/flights/${F.fid}/assign`, { uid: a.id, seat: '60A' }, O)).status, 400);
  assert.equal((await call('POST', `/api/seating/ops/flights/${F.fid}/assign`, { uid: a.id, seat: '60A', reason: 'seat broken' }, O)).status, 200);
  assert.equal(seatOf(F, a), '60A');
  assert.ok(db.seatAudit.some((x) => x.fid === F.fid && x.action === 'ops_moved_checked_in' && x.reason === 'seat broken'));
});

test('cancelling or changing a booking', async () => {
  const F = flight();
  const a = await person('Ned'), b = await person('Oli');
  await book(a, F); await book(b, F); await joinChat(F, a, b);
  await exclude(F, a, b);
  assert.equal((await book(a, F, { fare: 'Flex' })).status, 409); // fare/cabin changes need a new booking
  const freed = seatOf(F, b);
  assert.equal((await call('DELETE', `/api/seating/flights/${F.fid}/booking`, undefined, b.token)).status, 200);
  assert.equal(rec(F).pax[b.id], undefined);
  assert.ok(!JSON.stringify(db.seatPrefs[F.fid] || {}).includes(b.id), 'exclusions naming a cancelled passenger are deleted');
  assert.equal((await map(a, F)).seats[freed], 'free');
  // Saying "no" to student seating releases the zone seat.
  await book(a, F, { studentSeating: false });
  assert.equal(seatOf(F, a), null); assert.equal(rec(F).pax[a.id].student, false);
});

test('checked-in students are locked: the other one moves, and two locked restricted passengers go to review', async () => {
  const F = flight();
  const a = await person('Pia'), b = await person('Quin'), c = await person('Rae'), d = await person('Sol');
  for (const p of [a, b]) await book(p, F);
  await joinChat(F, a, b);
  assert.ok(adjacentTo(F, a, b));
  await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, a.token);
  const aSeat = seatOf(F, a);
  await exclude(F, b, a);
  assert.equal(seatOf(F, a), aSeat, 'checked-in student never moves'); assert.equal(adjacentTo(F, a, b), false);
  // Both checked in next to each other before a late exclusion: no automatic move, operational review.
  const G = flight();
  for (const p of [c, d]) await book(p, G);
  await joinChat(G, c, d);
  assert.ok(adjacentTo(G, c, d), 'students are grouped side by side');
  await call('POST', `/api/seating/flights/${G.fid}/checkin`, {}, c.token);
  await call('POST', `/api/seating/flights/${G.fid}/checkin`, {}, d.token);
  const cs = seatOf(G, c), ds = seatOf(G, d);
  assert.equal((await exclude(G, c, d)).status, 200);
  assert.equal(seatOf(G, c), cs); assert.equal(seatOf(G, d), ds);
  const O = await ops();
  const ov = (await call('GET', `/api/seating/ops/flights/${G.fid}`, undefined, O)).flight;
  const rv = ov.reviews.find((r) => r.kind === 'locked_conflict' && r.status === 'open');
  assert.ok(rv); assert.equal(rv.restrictions.length, 1);
  assert.ok(!('by' in rv.restrictions[0]), 'staff see the restricted pair, not who asked');
});

test('impossible arrangement: flagged for review with a neutral message, then resolved manually', async () => {
  const F = flight(), O = await ops();
  const ppl = [await person('Tia'), await person('Uma'), await person('Vic')];
  for (const p of ppl) await book(p, F);
  await joinChat(F, ...ppl);
  await call('PUT', `/api/seating/ops/flights/${F.fid}/zone`, { firstRow: 50, lastRow: 50, reason: 'test' }, O);
  for (const s of ['50D', '50E', '50G', '50H', '50J', '50K']) await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: s, action: 'block' }, O);
  const [t, u, v] = ppl;
  await exclude(F, t, u, v); await exclude(F, u, v);
  noViolations(F);
  const inReview = ppl.filter((p) => rec(F).pax[p.id].alloc === 'review');
  assert.equal(inReview.length, 1);
  const rv = await map(inReview[0], F);
  assert.match(rv.me.notice, /arrange your Student Zone seat by hand/);
  assert.ok(!/exclu|restrict|Tia|Uma|Vic/i.test(rv.me.notice));
  const ov = (await call('GET', `/api/seating/ops/flights/${F.fid}`, undefined, O)).flight;
  const review = ov.reviews.find((r) => r.kind === 'constraint' && r.status === 'open');
  assert.ok(review && review.restrictions.length >= 2);
  // Operations can't place them next to someone restricted, but can use a valid seat outside the zone.
  const other = ppl.find((p) => p !== inReview[0]);
  assert.equal((await call('POST', `/api/seating/ops/flights/${F.fid}/assign`, { uid: other.id, seat: '61A', reason: 'make room' }, O)).status, 200);
  const bad = await call('POST', `/api/seating/ops/flights/${F.fid}/assign`, { uid: inReview[0].id, seat: '61B', reason: 'try' }, O);
  assert.equal(bad.status, 409); assert.match(bad.error, /must not sit beside/);
  assert.equal((await call('POST', `/api/seating/ops/flights/${F.fid}/assign`, { uid: inReview[0].id, seat: '61K', reason: 'manual resolution' }, O)).status, 200);
  assert.equal(seatOf(F, inReview[0]), '61K'); noViolations(F);
  assert.ok(rec(F).reviews.filter((r) => r.kind === 'constraint').every((r) => r.status === 'resolved'));
});

test('simultaneous seat selection from two devices: one wins, the other is told the seat was taken', async () => {
  const F = flight();
  const a = await person('Wes', { student: false }), b = await person('Xia', { student: false });
  await book(a, F, { studentSeating: false }); await book(b, F, { studentSeating: false });
  const [r1, r2] = await Promise.all([
    call('POST', `/api/seating/flights/${F.fid}/checkin`, { seat: '41A' }, a.token),
    call('POST', `/api/seating/flights/${F.fid}/checkin`, { seat: '41A' }, b.token),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(Object.values(rec(F).pax).filter((p) => p.seat === '41A').length, 1);
  // Holds: a seat being chosen on another device can't be taken.
  const c = await person('Yan', { student: false }), d = await person('Zoe', { student: false });
  await book(c, F, { studentSeating: false }); await book(d, F, { studentSeating: false });
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/hold`, { seat: '42C' }, c.token)).status, 200);
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/hold`, { seat: '42C' }, d.token)).status, 409);
  // A stale device (old revision of its own booking) can't overwrite the newer state.
  const rev = (await map(c, F)).me.rev;
  const stale = await call('POST', `/api/seating/flights/${F.fid}/checkin`, { seat: '42C', rev: rev - 1 }, c.token);
  assert.equal(stale.status, 409); assert.equal(stale.stale, true);
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/checkin`, { seat: '42C', rev }, c.token)).status, 200);
});

test('Economy Light: no advance seat selection (even in the Student Zone) but a free assigned seat', async () => {
  const F = flight();
  const l = await person('Lia', { student: false }), s = await person('Sam');
  await book(l, F, { fare: 'Light', studentSeating: false });
  assert.equal((await map(l, F)).me.selection, 'none');
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/hold`, { seat: '41B' }, l.token)).status, 403);
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/checkin`, { seat: '41B' }, l.token)).status, 403);
  // Student Zone assignment is free on Light, but choosing another zone seat is still seat selection.
  await book(s, F, { fare: 'Light' });
  const sv = await map(s, F);
  assert.equal(sv.me.alloc, 'assigned');
  const otherZone = Object.entries(sv.seats).find(([, st2]) => st2 === 'free')[0];
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/hold`, { seat: otherZone }, s.token)).status, 403);
  // After buying seat selection, the Light passenger can choose.
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/seat-unlock`, { with: 'miles' }, l.token)).status, 200);
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/hold`, { seat: '41B' }, l.token)).status, 200);
  // Without selection, check-in assigns a seat outside the reserved zone.
  const l2 = await person('Lex', { student: false });
  await book(l2, F, { fare: 'Light', studentSeating: false });
  const ci = await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, l2.token);
  assert.equal(ci.status, 200); assert.ok(!(ci.view.me.seat >= '48' && ci.view.me.seat < '53'));
});

test('no access to another flight\'s seating, preferences or live stream', async () => {
  const F1 = flight(), F2 = flight();
  const a = await person('Ada'), b = await person('Bea');
  await book(a, F1); await book(b, F2);
  for (const p of ['seatmap', 'participants', 'ticket']) assert.equal((await call('GET', `/api/seating/flights/${F2.fid}/${p}`, undefined, a.token)).status, 403, p);
  assert.equal((await call('PUT', `/api/seating/flights/${F2.fid}/exclusions`, { handles: [] }, a.token)).status, 403);
  assert.equal((await call('POST', `/api/seating/flights/${F2.fid}/hold`, { seat: '41A' }, a.token)).status, 403);
  assert.equal((await call('GET', `/api/seating/flights/${F1.fid}/seatmap`)).status, 401);
  assert.equal((await call('GET', `/api/seating/ops/flights/${F1.fid}`, undefined, a.token)).status, 403);
  // A stream ticket only opens the flight it was issued for.
  const tk = (await call('GET', `/api/seating/flights/${F1.fid}/ticket`, undefined, a.token)).ticket;
  assert.equal((await fetch(`${base}/api/seating/flights/${F2.fid}/stream?ticket=${tk}`)).status, 403);
  // The old public per-flight endpoints are gone.
  assert.equal((await call('GET', `/api/live/flights/${F1.fid}`)).status, 404);
});

test('real-time: each device receives its own updated view when seats change', async () => {
  const F = flight();
  const a = await person('Cy'), b = await person('Di');
  await book(a, F);
  const tk = (await call('GET', `/api/seating/flights/${F.fid}/ticket`, undefined, a.token)).ticket;
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/seating/flights/${F.fid}/stream?ticket=${tk}`, { signal: ctl.signal });
  const reader = res.body.getReader(), dec = new TextDecoder();
  const next = async () => { let buf = ''; while (!buf.includes('data:')) buf += dec.decode((await reader.read()).value); return JSON.parse(buf.slice(buf.indexOf('data:') + 5).split('\n')[0]); };
  const first = await next();
  assert.equal(first.zone.students, 1);
  await book(b, F);
  let upd = await next();
  while (upd.zone.students < 2) upd = await next();
  assert.ok(upd.v > first.v); assert.equal(upd.me.seat, seatOf(F, a));
  assert.ok(!JSON.stringify(upd).includes(b.id));
  ctl.abort();
});

test('exclusions close before departure and are deleted after the flight', async () => {
  const F = flight(30);
  const a = await person('Eli'), b = await person('Flo');
  await book(a, F); await book(b, F); await joinChat(F, a, b);
  await exclude(F, a, b);
  try {
    S._setClock(() => Date.now() + 29 * 3600e3); // 1 h before departure
    assert.equal((await exclude(F, a)).status, 409);
    S._setClock(() => Date.now() + (30 + 13 + 49) * 3600e3); // 49 h after arrival
    S.purge();
    assert.equal(db.seatPrefs[F.fid], undefined);
    assert.ok(db.seatAudit.some((x) => x.fid === F.fid && x.action === 'preferences_deleted_retention'));
  } finally { S._setClock(null); }
});

test('students whose verification has lapsed by the flight date lose their zone seat', async () => {
  const F = flight();
  const a = await person('Gil');
  await book(a, F);
  assert.equal((await map(a, F)).me.alloc, 'assigned');
  SV._R[a.id].validUntil = new Date().toISOString().slice(0, 10); // ends before the flight
  await S._reallocate(F.fid);
  const v = await map(a, F);
  assert.equal(v.me.student, false); assert.equal(v.me.seat, null);
});

test('advance seat selection: before check-in for fares that include it, kept until check-in, never for Economy Light', async () => {
  const F = flight(24 * 6); // six days out: check-in not open yet
  const e = await person('Eva', { student: false }), l = await person('Leo', { student: false });
  await book(e, F, { studentSeating: false }); await book(l, F, { fare: 'Light', studentSeating: false });
  const r = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '44C' }, e.token);
  assert.equal(r.status, 200, r.error); assert.equal(r.view.me.seat, '44C'); assert.equal(r.view.me.chosen, true); assert.equal(r.view.me.checkin, 'not_open');
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '44C' }, l.token)).status, 403);  // Light: no advance selection
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, e.token)).status, 409);              // check-in not open
  assert.equal((await map(l, F)).seats['44C'], 'x');                                                                 // taken for everyone else
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '50A' }, e.token)).status, 409);  // reserved zone seat
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: null }, e.token)).view.me.seat, null);
});

test('students with seat selection choose within the zone, never next to a restriction, and can go back to automatic', async () => {
  const F = flight();
  const a = await person('Ari'), b = await person('Bo');
  await book(a, F, { fare: 'Flex' }); await book(b, F); await joinChat(F, a, b);
  await exclude(F, b, a);
  const nextToB = engine.adjacent(WIDE, seatOf(F, b)).find((s) => !Object.values(rec(F).pax).some((p) => p.seat === s));
  const bad = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: nextToB }, a.token);
  assert.equal(bad.status, 409); assert.equal(bad.error, "That seat isn't available."); // neutral: no reason given
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '41A' }, a.token)).status, 409); // outside the zone
  const ok = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '52K' }, a.token);
  assert.equal(ok.status, 200); assert.equal(seatOf(F, a), '52K');
  await book(await person('Cy'), F); // another booking triggers reallocation: the chosen seat stays
  assert.equal(seatOf(F, a), '52K'); noViolations(F);
  const back = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: null }, a.token);
  assert.equal(back.view.me.chosen, false); assert.equal(back.view.me.alloc, 'assigned'); assert.ok(back.view.me.seat);
});
