/* Dynamic student seating (the default SEATING_MODE): students are seated anywhere in Economy in groups of 2–3,
 * no seat is reserved, a paying passenger may take a seat that is only PLANNED for a student, and the students are
 * then re-seated so nobody is left alone. Run from the repo root:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-dyn-'));
process.env.LIVE_DB = path.join(TMP, 'db.json');
process.env.DOC_VAULT = path.join(TMP, 'vault');
process.env.DOC_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.SEAT_OPS = 'ops@cathay.example';
process.env.SEATING_MODE = 'dynamic';
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'OAG_KEY', 'VERIFIERS', 'MODERATORS']) delete process.env[k];

const engine = require('../seating/engine');
const { app } = require('../server');
const S = require('../seating/service');
const SV = require('../student-verify');
const { db } = require('../db');

const WIDE = { blocks: [['A', 'B', 'C'], ['D', 'E', 'G'], ['H', 'J', 'K']], first: 40, last: 62 };
let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); S._setClock(null); fs.rmSync(TMP, { recursive: true, force: true }); });

let ip = 0, n = 0;
async function call(method, p, body, token) {
  ip++;
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.2.${ip >> 8 & 255}.${ip & 255}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: res.status, raw: text, ...j };
}
async function person(first, { student = true } = {}) {
  const r = await call('POST', '/api/auth/signup', { firstName: first, lastName: 'T' + (++n), email: `d${n}@example.com`, password: 'password123', dob: '2001-01-01' });
  assert.equal(r.status, 200, r.error);
  if (student) SV._R[r.user.id] = { email: `${first.toLowerCase()}${n}@link.cuhk.edu.hk`, emailVerifiedAt: new Date().toISOString(), institution: SV.institutionFor('x@link.cuhk.edu.hk'),
    state: 'verified', validUntil: '2099-12-31', verifiedAt: new Date().toISOString(), policyVersion: SV.POLICY.version, history: [], rejectedHashes: [] };
  return { token: r.token, id: r.user.id, name: first };
}
const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 16);
let fno = 500;
function flight(hours = 30) {
  const dep = hoursFromNow(hours), number = 'CX ' + (++fno);
  return { seg: { number, from: 'HKG', to: 'LHR', dep, arr: hoursFromNow(hours + 13), aircraft: 'A350-900' }, fid: number.replace(' ', '') + '-' + dep.slice(0, 10) };
}
const book = (p, F, o = {}) => call('PUT', `/api/seating/flights/${F.fid}/booking`, { seg: F.seg, cabin: 'Economy', fare: 'Essential', studentSeating: true, ...o }, p.token);
const rec = (F) => db.flights[F.fid];
const seatOf = (F, p) => rec(F).pax[p.id].seat;
/* Every placed student sits directly beside at least one other student. */
function nobodyAlone(F) {
  const pax = Object.entries(rec(F).pax), at = {};
  pax.forEach(([u, p]) => { if (p.seat) at[p.seat] = u; });
  const alone = pax.filter(([, p]) => p.student && p.seat).filter(([u, p]) => !engine.adjacent(WIDE, p.seat).some((nb) => at[nb] && at[nb] !== u && rec(F).pax[at[nb]].student));
  assert.deepEqual(alone.map(([, p]) => p.seat), [], 'every student sits next to at least one student');
}
let opsToken;
const ops = async () => opsToken || (opsToken = (await call('POST', '/api/auth/signup', { firstName: 'Olga', lastName: 'Ops', email: 'ops@cathay.example', password: 'password123', dob: '1980-01-01' })).token);

test('6 students, a paying passenger buys a seat planned for a student: re-seated, nobody alone', async () => {
  const F = flight();
  const studs = [];
  for (const name of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']) { const p = await person(name); studs.push(p); assert.equal((await book(p, F)).status, 200); }
  if (process.env.DBG) console.log('after 6:', studs.map((p) => seatOf(F, p)).join(' '));
  nobodyAlone(F);
  const target = seatOf(F, studs[5]); // a seat that is only PLANNED for a student
  const payer = await person('Paul', { student: false });
  assert.equal((await book(payer, F, { studentSeating: false })).status, 200);
  const r = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: target }, payer.token);
  assert.equal(r.status, 200, r.error);                     // the paying passenger gets it: nothing is reserved
  assert.equal(seatOf(F, payer), target);
  assert.notEqual(seatOf(F, studs[5]), target);            // the student was moved...
  assert.ok(seatOf(F, studs[5]));                          // ...to another seat
  if (process.env.DBG) console.log('after sale of', target, ':', studs.map((p) => seatOf(F, p)).join(' '));
  nobodyAlone(F);                                          // ...and nobody is left alone
  assert.ok(rec(F).log.some((l) => /re-seated/.test(l.text)));
});

test('no reserved seats: non-students see and can choose any free Economy seat; no zone rows', async () => {
  const F = flight();
  const a = await person('Gus'), b = await person('Hal');
  await book(a, F); await book(b, F);
  const c = await person('Ivy', { student: false });
  await book(c, F, { studentSeating: false });
  const v = (await call('GET', `/api/seating/flights/${F.fid}/seatmap`, undefined, c.token)).view;
  assert.equal(v.zone.mode, 'dynamic');
  assert.equal(v.zone.rows, null);
  assert.ok(!Object.values(v.seats).includes('zone') && !Object.values(v.seats).includes('out'));
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '41A' }, c.token)).status, 200);
});

test('checked-in students and a Flex student\'s own choice can never be taken', async () => {
  const F = flight();
  const a = await person('Jo'), b = await person('Kit'), flex = await person('Lea');
  await book(a, F); await book(b, F); await book(flex, F, { fare: 'Flex' });
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, a.token)).status, 200);
  const chosen = '55K';
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: chosen }, flex.token)).status, 200);
  const payer = await person('Max', { student: false });
  await book(payer, F, { studentSeating: false });
  const r1 = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: seatOf(F, a) }, payer.token);
  assert.equal(r1.status, 409);
  const r2 = await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: chosen }, payer.token);
  assert.equal(r2.status, 409);
  assert.equal(seatOf(F, flex), chosen);
});

test('a sale through another channel is allowed on a planned student seat; students re-seated, nobody alone', async () => {
  const F = flight(), O = await ops();
  const studs = [];
  for (const name of ['Ned', 'Ola', 'Pia', 'Quy']) { const p = await person(name); studs.push(p); await book(p, F); }
  const before = seatOf(F, studs[0]);
  const sell = await call('POST', `/api/seating/ops/flights/${F.fid}/inventory`, { seat: before, action: 'sell' }, O);
  assert.equal(sell.status, 200, sell.error);
  assert.notEqual(seatOf(F, studs[0]), before);
  nobodyAlone(F);
});

test('engine (dynamic): a student left alone by a sale is regrouped; zone mode keeps old behaviour', () => {
  const layout = WIDE;
  const seats = engine.seatsOf(layout);
  // Trio 41A-41C and pair 45A-45B; 45A sold -> 45B alone.
  const students = [['s1', '41A'], ['s2', '41B'], ['s3', '41C'], ['s4', '45A'], ['s5', '45B']].map(([id, prev], i) => ({ id, uni: 'X', order: i, locked: null, prev, student: true }));
  const usable = seats.filter((s) => s !== '45A');
  const dyn = engine.allocate({ layout, zoneSeats: usable, students, pairs: [], regroupAlone: true });
  const at = {}; Object.entries(dyn.seatOf).forEach(([id, s]) => { at[s] = id; });
  for (const [id, s] of Object.entries(dyn.seatOf)) assert.ok(engine.adjacent(layout, s).some((nb) => at[nb] && at[nb] !== id), `${id} alone at ${s}`);
  const zone = engine.allocate({ layout, zoneSeats: usable, students, pairs: [] });
  assert.equal(zone.seatOf.s5, '45B'); // without regroupAlone the unaffected student keeps their seat
});

test('edge case: a Flex student\'s own seat gets surrounded by paying passengers -> free move offer, never forced', async () => {
  const F = flight();
  const flex = await person('Rio');
  await book(flex, F, { fare: 'Flex' });
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '50E' }, flex.token)).status, 200); // middle seat D-E-G
  // Two paying passengers pick both neighbours: the student's chosen seat is fixed and nobody else is a student yet.
  const a = await person('Uma', { student: false }), b = await person('Vic', { student: false });
  await book(a, F, { studentSeating: false }); await book(b, F, { studentSeating: false });
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '50D' }, a.token)).status, 200);
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: '50G' }, b.token)).status, 200);
  assert.equal(seatOf(F, flex), '50E');                                      // never moved without consent
  let v = (await call('GET', `/api/seating/flights/${F.fid}/seatmap`, undefined, flex.token)).view;
  assert.equal(v.me.moveOffer, null);                                        // no other student on board yet: nothing to offer
  // Two other students book and are seated together automatically -> the offer appears.
  for (const name of ['Wen', 'Xia']) { const s = await person(name); await book(s, F); }
  v = (await call('GET', `/api/seating/flights/${F.fid}/seatmap`, undefined, flex.token)).view;
  assert.ok(v.me.moveOffer && v.me.moveOffer.students >= 1, 'move offer next to students');
  assert.equal(seatOf(F, flex), '50E');                                      // still not moved
  // One tap: the student accepts and now sits next to a student.
  assert.equal((await call('POST', `/api/seating/flights/${F.fid}/select`, { seat: v.me.moveOffer.seat }, flex.token)).status, 200);
  v = (await call('GET', `/api/seating/flights/${F.fid}/seatmap`, undefined, flex.token)).view;
  assert.ok(v.me.nearby.students >= 1);
  assert.equal(v.me.moveOffer, null);
});

test('soft reserve: automatic seats for other passengers avoid the free seats beside students', async () => {
  const F = flight(40);
  const s = await person('Yan'); await book(s, F); // a lone student gets a planned seat
  // Non-students checking in without choosing get seats, never the free neighbours of the student while others exist.
  for (const name of ['Zed', 'Amy', 'Bob']) {
    const p = await person(name, { student: false });
    await book(p, F, { studentSeating: false, fare: 'Light' });
    const ci = await call('POST', `/api/seating/flights/${F.fid}/checkin`, {}, p.token); // 40 h flight: check-in is open
    assert.equal(ci.status, 200, ci.error);
    const studentSeat = seatOf(F, s);
    assert.notEqual(seatOf(F, p), studentSeat, `${name} got the student's planned seat`);
    assert.ok(!engine.adjacent(WIDE, studentSeat).includes(seatOf(F, p)), `${name} was assigned a seat beside the lone student`);
  }
});
