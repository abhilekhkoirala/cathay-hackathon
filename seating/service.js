/* Seating service: the single source of truth for seats, Student Zone allocations and confidential exclusions.
 *
 * Everything that changes a flight runs inside repo.withFlight() (serialised per flight, committed only if the
 * stored version is unchanged), so two passengers can never be given the same seat and a stale client can never
 * overwrite a newer allocation. Seat state comes from the inventory adapter (seating/inventory.js) plus the
 * assignments made here; the allocation engine (seating/engine.js) is pure and is re-run after every change.
 *
 * Words used below:
 *   seat assignment  a seat given by the airline (free on every fare): the Student Zone allocation, or a seat
 *                    chosen by the system at check-in;
 *   seat selection   the passenger picks a specific seat: included on Economy Essential / Flex and premium
 *                    cabins, a paid extra on Economy Light (seat-unlock), and never granted by the Student Zone. */
'use strict';
const crypto = require('crypto');
const { db, save } = require('../db');
const { D, SZ } = require('./shared');
const engine = require('./engine');
const { JsonSeatingRepository, ConflictError } = require('./repository');
const { SimulatedInventoryAdapter } = require('./inventory');
const studentVerify = require('../student-verify');
const { ageOn } = require('../accounts');

/* ---------- policy (operations can change the zone per flight; these are the defaults) ---------- */
const rowsFromEnv = (v, d) => { const m = /^(\d+)-(\d+)$/.exec(String(v || '')); return m ? [Number(m[1]), Number(m[2])] : d; };
const POLICY = {
  zoneRows: { wide: rowsFromEnv(process.env.ZONE_ROWS_WIDE, [48, 52]), narrow: rowsFromEnv(process.env.ZONE_ROWS_NARROW, [30, 33]) },
  zoneReleaseHours: Number(process.env.ZONE_RELEASE_HOURS || 24), // unassigned zone seats go back on general sale
  checkinOpenHours: 48,
  checkinCloseMinutes: 45,
  exclusionDeadlineHours: 2,       // students can update exclusions until 2 h before departure
  holdMs: 5 * 60 * 1000,           // a seat picked on the seat map is held while the passenger confirms
  maxExclusions: 20,
  prefsRetentionHours: 48,         // exclusions deleted 48 h after arrival
  flightRetentionDays: 30,         // seating record (assignments, reviews, log) deleted 30 days after arrival
  auditRetentionDays: 365,
};

const repo = new JsonSeatingRepository(db, save);
const inventory = new SimulatedInventoryAdapter(db, save);
let clock = () => Date.now();
const now = () => clock();
const iso = (t = now()) => new Date(t).toISOString();

class SeatError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const fail = (status, msg, extra) => { throw new SeatError(status, msg, extra); };

/* ---------- identity: pseudonyms and per-viewer handles ---------- */
/* Other devices never see an account id: a passenger is a per-flight pseudonym (same as before, used by chat). */
const pseudo = (uid, fid) => 'p' + D.hash(uid + '|' + fid).toString(36);
db.seatSecret = db.seatSecret || crypto.randomBytes(32).toString('hex');
/* A participant handle differs for every viewer, so two students can't compare lists to work out who is who. */
const handleFor = (viewer, target, fid) => 'h' + crypto.createHmac('sha256', db.seatSecret).update(`${viewer}|${target}|${fid}`).digest('hex').slice(0, 20);

/* ---------- flight records ---------- */
const flightId = (seg) => seg.number.replace(/\s+/g, '') + '-' + seg.dep.slice(0, 10);
const ID_RE = /^[A-Z0-9]{2,8}-\d{4}-\d{2}-\d{2}$/;
const SEAT_RE = /^\d{1,2}[A-K]$/;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function cleanSeg(s) {
  if (!s || typeof s !== 'object') return null;
  const seg = { number: str(s.number, 10).toUpperCase(), from: str(s.from, 3).toUpperCase(), to: str(s.to, 3).toUpperCase(),
    dep: str(s.dep, 16), arr: str(s.arr, 16), aircraft: str(s.aircraft, 30) || 'A350-900' };
  if (!/^[A-Z0-9]{2} ?\d{1,4}[A-Z]?$/.test(seg.number) || !/^[A-Z]{3}$/.test(seg.from) || !/^[A-Z]{3}$/.test(seg.to)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(seg.dep) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(seg.arr)) return null;
  return seg;
}
const depMs = (f) => new Date(f.seg.dep).getTime();
const arrMs = (f) => { const a = new Date(f.seg.arr).getTime(), d = depMs(f); return a > d ? a : d + 3600e3; };
const narrow = (f) => /A32/.test(f.seg.aircraft || '');
function newFlight(fid, seg) {
  const rows = narrow({ seg }) ? POLICY.zoneRows.narrow : POLICY.zoneRows.wide;
  return { id: fid, v: 0, seg, createdAt: iso(), order: 0, pax: {}, holds: {}, reviews: [], log: [],
    zone: { firstRow: rows[0], lastRow: rows[1], releaseHours: POLICY.zoneReleaseHours, updatedBy: 'default', updatedAt: iso() } };
}

/* Old live.js records (client-side planner era) → this model. Runs once per record. */
function migrateLegacy(f, prefs) {
  if (f.zone) return false;
  const fresh = newFlight(f.id, f.seg);
  for (const [uid, p] of Object.entries(f.pax || {})) {
    const seat = p.locked || p.seat || null;
    fresh.pax[uid] = { n: p.n || ++fresh.order, ref: '', cabin: p.cabin || 'Economy', fare: null,
      wantsStudent: Boolean(p.student), share: Boolean(p.share), student: false, uni: p.uni || '', seat, seatKind: seat ? (p.student ? 'zone' : 'selected') : null,
      alloc: null, status: seat ? 'checked_in' : 'booked', unlock: null, rev: 1, updatedAt: iso() };
  }
  fresh.order = Math.max(fresh.order, ...Object.values(fresh.pax).map((p) => p.n), 0);
  for (const [a, list] of Object.entries(f.avoid || {})) prefs[a] = { excludes: [...new Set(list)], updatedAt: iso() };
  for (const s of Object.keys(f.sales || {})) inventory.inv(f.id).sold[s] = true;
  Object.keys(f).forEach((k) => delete f[k]);
  Object.assign(f, fresh, { v: f.v });
  return true;
}

/* ---------- eligibility (never from the request) ---------- */
function isStudentOn(uid, f) {
  const u = db.users[uid];
  return Boolean(u && studentVerify.eligibleOn(u, f.seg.dep).ok && ageOn(u.dob, f.seg.dep) >= 18);
}
const selection = (p) => (p.cabin !== 'Economy' ? 'included' : !p.fare ? 'none' : (D.FARES[p.fare] || {}).seat === 'free' ? 'included' : p.unlock ? 'unlocked' : 'none');
const canSelect = (p) => selection(p) !== 'none';

/* ---------- seat geometry and state ---------- */
async function layoutOf(f, cabin = 'Economy') {
  const map = await inventory.seatMap(f.seg);
  const c = map.cabins[cabin] || map.cabins.Economy;
  return { name: cabin, blocks: c.blocks, first: c.first, last: c.last };
}
const zoneSeats = (f, layout) => engine.seatsOf(layout, [f.zone.firstRow, f.zone.lastRow]);
const zoneReserved = (f) => now() < depMs(f) - f.zone.releaseHours * 3600e3;
function cleanHolds(f) { for (const [s, h] of Object.entries(f.holds || {})) if (h.exp < now() || !f.pax[h.uid]) delete f.holds[s]; }
function occupant(f) { const at = {}; for (const [uid, p] of Object.entries(f.pax)) if (p.seat) at[p.seat] = uid; return at; }
/* Mutual restriction pairs from one-way submissions: A excludes B ⇒ {A,B} must not be adjacent. */
function pairsOf(prefs) { const out = []; for (const [a, r] of Object.entries(prefs)) for (const b of r.excludes || []) out.push([a, b]); return out; }
const restricted = (prefs, a, b) => Boolean(((prefs[a] || {}).excludes || []).includes(b) || ((prefs[b] || {}).excludes || []).includes(a));

/* Is a passenger seated beside `seat` someone `uid` must not sit next to (either direction)? */
function restrictedNeighbour(f, prefs, layout, uid, seat) {
  const at = occupant(f);
  return engine.adjacent(layout, seat).some((nb) => at[nb] && at[nb] !== uid && restricted(prefs, uid, at[nb]));
}
/* Why `uid` can't sit in `seat` right now ('' = it can). Messages never say that an exclusion is the reason.
 * opts.ignoreZone: skip the Student Zone rules (operations placing someone by hand; a student placed outside the zone). */
function seatProblem(f, prefs, ext, layout, uid, seat, opts = {}) {
  const p = f.pax[uid];
  if (!SEAT_RE.test(seat) || !engine.seatsOf(layout).includes(seat)) return 'No such seat in your cabin.';
  if (ext.sold.has(seat) || ext.blocked.has(seat)) return "That seat isn't available.";
  const at = occupant(f);
  if (at[seat] && at[seat] !== uid) return 'That seat was just taken.';
  const h = f.holds[seat];
  if (h && h.uid !== uid && h.exp >= now()) return 'Someone is choosing that seat right now. Try another one.';
  if (p.cabin === 'Economy' && !opts.ignoreZone) {
    const inZone = zoneSeats(f, layout).includes(seat);
    if (inZone && zoneReserved(f) && !p.student) return 'That seat is reserved for the Student Zone.';
    if (p.student && zoneReserved(f) && !inZone) return 'Student Zone passengers are seated in the Student Zone.';
  }
  if (restrictedNeighbour(f, prefs, layout, uid, seat)) return "That seat isn't available.";
  return '';
}

/* ---------- reallocation ---------- */
/* Recompute who is a student, run the engine, apply its result, keep reviews in sync. Mutates f. */
async function reallocate(f, prefs, reason, actor = 'system') {
  cleanHolds(f);
  const layout = await layoutOf(f), ext = await inventory.externalState(f.id), zone = zoneSeats(f, layout);
  const zoneSet = new Set(zone);
  // 1. Eligibility is re-checked every time (verification can expire before the flight).
  for (const [uid, p] of Object.entries(f.pax)) {
    const was = p.student;
    p.student = p.cabin === 'Economy' && p.wantsStudent && isStudentOn(uid, f);
    if (!p.student) p.alloc = null;
    if (was && !p.student && p.status !== 'checked_in' && p.seatKind === 'zone') { await release(f, uid); }
    if (!was && p.student && p.status !== 'checked_in' && p.seatKind !== 'manual' && p.seat && !zoneSet.has(p.seat)) await release(f, uid);
  }
  // 2. Usable zone seats: not sold, blocked, held or taken by a non-student.
  const at = occupant(f);
  const usable = zone.filter((s) => !ext.sold.has(s) && !ext.blocked.has(s) && !(f.holds[s] && !(f.pax[f.holds[s].uid] || {}).student)
    && !(at[s] && !(f.pax[at[s]] || {}).student));
  // 3. Engine input: unlocked zone students (previous seat), locked students and seated neighbours of the zone.
  const nearZone = new Set(zone.flatMap((s) => engine.adjacent(layout, s)));
  const people = [];
  for (const [uid, p] of Object.entries(f.pax)) {
    const locked = p.status === 'checked_in' || p.seatKind === 'manual';
    if (p.student && !locked) people.push({ id: uid, uni: p.uni, order: p.n, locked: null, prev: p.seatKind === 'zone' ? p.seat : null });
    else if (p.seat && (p.student || zoneSet.has(p.seat) || nearZone.has(p.seat))) people.push({ id: uid, uni: p.uni, order: p.n, locked: p.seat, prev: null });
  }
  const pairs = pairsOf(prefs).filter(([a, b]) => f.pax[a] && f.pax[b]);
  const out = engine.allocate({ layout, zoneSeats: usable, students: people, pairs });
  if (engine.violations(layout, Object.fromEntries(people.map((s) => [s.id, out.seatOf[s.id]])), pairs).some(([a, b]) => !people.find((x) => x.id === a).locked || !people.find((x) => x.id === b).locked)) {
    throw new Error('engine produced an invalid allocation'); // defensive: never commit a broken restriction
  }
  // 4. Apply.
  const unplaced = new Map(out.unplaced.map((u) => [u.id, u.reason]));
  for (const s of people.filter((x) => !x.locked)) {
    const p = f.pax[s.id], seat = out.seatOf[s.id] || null;
    if (seat !== p.seat) {
      if (p.seat) await inventory.unassign(f.id, p.seat, pseudo(s.id, f.id));
      if (seat) { const r = await inventory.assign(f.id, seat, pseudo(s.id, f.id)); if (!r.ok) fail(409, 'Seat inventory changed. Try again.'); }
      p.seat = seat; p.seatKind = seat ? 'zone' : null; p.rev++; p.updatedAt = iso();
    }
    p.alloc = seat ? 'assigned' : unplaced.get(s.id) === 'constraint' ? 'review' : 'waitlisted';
  }
  await inventory.protectZone(f.id, zoneReserved(f) ? zone : []);
  // 5. Operational reviews: open what needs a person, close what no longer does.
  const want = [];
  const constraintIds = out.unplaced.filter((u) => u.reason === 'constraint').map((u) => u.id);
  if (constraintIds.length) want.push({ kind: 'constraint', uids: constraintIds });
  const capacityIds = out.unplaced.filter((u) => u.reason === 'capacity').map((u) => u.id);
  if (capacityIds.length) want.push({ kind: 'capacity', uids: capacityIds });
  if (out.conflicts.length) want.push({ kind: 'locked_conflict', uids: [...new Set(out.conflicts.flat())] });
  const lost = Object.entries(f.pax).filter(([, p]) => p.seat && (p.status === 'checked_in' || p.seatKind === 'manual') && (ext.sold.has(p.seat) || ext.blocked.has(p.seat))).map(([u]) => u);
  if (lost.length) want.push({ kind: 'seat_unavailable', uids: lost });
  syncReviews(f, want);
  if (out.moved.length) log(f, `Reallocation (${reason}): ${out.moved.length} Student Zone passenger${out.moved.length > 1 ? 's' : ''} moved.`);
  if (out.moved.length || out.unplaced.length) repo.audit({ fid: f.id, actor, action: 'reallocated', reason, moved: out.moved.length, unplaced: out.unplaced.length, solver: out.solver });
  return out;
}
function syncReviews(f, want) {
  for (const r of f.reviews.filter((x) => x.status === 'open')) {
    const w = want.find((x) => x.kind === r.kind);
    if (!w) { r.status = 'resolved'; r.resolvedAt = iso(); r.resolvedBy = 'system'; r.note = 'No longer needed after reallocation.'; }
    else { r.uids = w.uids; r.updatedAt = iso(); want.splice(want.indexOf(w), 1); }
  }
  for (const w of want) {
    f.reviews.push({ id: 'rv_' + crypto.randomBytes(6).toString('hex'), kind: w.kind, uids: w.uids, status: 'open', at: iso() });
    repo.audit({ fid: f.id, actor: 'system', action: 'review_opened', kind: w.kind, count: w.uids.length });
  }
  if (f.reviews.length > 100) f.reviews = f.reviews.filter((r) => r.status === 'open').concat(f.reviews.filter((r) => r.status !== 'open').slice(-50));
}
async function release(f, uid) {
  const p = f.pax[uid];
  if (p.seat) await inventory.unassign(f.id, p.seat, pseudo(uid, f.id));
  p.seat = null; p.seatKind = null; p.rev++; p.updatedAt = iso();
}
const log = (f, text) => { f.log.unshift({ at: iso(), text }); f.log = f.log.slice(0, 50); };

/* ---------- transaction helper ---------- */
async function tx(fid, fn, { create } = {}) {
  const result = await repo.withFlight(fid, async (flight, prefs) => {
    let f = flight;
    if (!f && create) f = newFlight(fid, create);
    if (!f) fail(404, 'Unknown flight.');
    let prefsChanged = migrateLegacy(f, prefs);
    const r = await fn(f, prefs, () => { prefsChanged = true; });
    return { flight: f, prefs: prefsChanged ? prefs : undefined, result: r };
  });
  broadcast(fid);
  return result;
}
const mine = (f, uid) => f.pax[uid] || fail(403, 'You have no booking on this flight.');

/* ---------- passenger operations ---------- */
/** Register or update the signed-in passenger's booking on one flight (idempotent). */
function book(user, fid, body) {
  const seg = cleanSeg(body && body.seg);
  if (!ID_RE.test(fid) || !seg || flightId(seg) !== fid) return Promise.reject(new SeatError(400, 'Bad flight.'));
  return tx(fid, async (f, prefs) => {
    const uid = user.id, b = body || {};
    const cabin = D.CABINS.includes(b.cabin) ? b.cabin : 'Economy';
    const fare = cabin === 'Economy' ? (D.FARES[b.fare] ? b.fare : 'Essential') : null;
    let p = f.pax[uid];
    if (p && (p.cabin !== cabin || (p.fare && p.fare !== fare))) fail(409, 'To change cabin or fare, cancel this booking and book again.');
    if (!p) {
      p = f.pax[uid] = { n: ++f.order, ref: str(b.ref, 8), cabin, fare, wantsStudent: false, share: false, student: false, uni: '', seat: null, seatKind: null,
        alloc: null, status: 'booked', unlock: null, rev: 1, updatedAt: iso() };
      repo.audit({ fid, actor: uid, action: 'booked', pax: pseudo(uid, fid), cabin, fare });
    }
    if (!p.fare && fare) p.fare = fare;
    const v = studentVerify.clientVerified(user);
    p.share = b.showUni === true;
    p.uni = v ? SZ.universityFromEmail(v.email) : '';
    if (p.status !== 'checked_in') p.wantsStudent = b.studentSeating === true && cabin === 'Economy';
    p.updatedAt = iso();
    await reallocate(f, prefs, 'booking');
    const denied = p.wantsStudent && !p.student ? studentVerify.eligibleOn(user, f.seg.dep).reason || 'The Student Zone is for verified students aged 18+.' : undefined;
    return { view: await passengerView(f, prefs, uid), studentDenied: denied };
  }, { create: seg });
}

/** Cancel the passenger's booking: seat released, their exclusions deleted, others' exclusions of them removed. */
function cancel(uid, fid, reason = 'passenger') {
  return tx(fid, async (f, prefs, prefsDirty) => {
    if (!f.pax[uid]) return { ok: true };
    await release(f, uid);
    delete f.pax[uid];
    for (const [s, h] of Object.entries(f.holds)) if (h.uid === uid) delete f.holds[s];
    if (prefs[uid]) { delete prefs[uid]; prefsDirty(); }
    for (const r of Object.values(prefs)) { const n = r.excludes.length; r.excludes = r.excludes.filter((x) => x !== uid); if (n !== r.excludes.length) prefsDirty(); }
    for (const [k, r] of Object.entries(prefs)) if (!r.excludes.length) delete prefs[k];
    repo.audit({ fid, actor: reason === 'passenger' ? uid : 'system', action: 'cancelled', pax: pseudo(uid, fid), reason });
    await reallocate(f, prefs, 'cancellation');
    return { ok: true };
  });
}

/** Hold a seat for a few minutes while the passenger confirms (seat selection only). */
function hold(uid, fid, seat) {
  return tx(fid, async (f, prefs) => {
    const p = mine(f, uid);
    if (p.status === 'checked_in') fail(409, "You're checked in. Ask at the airport to change your seat.");
    if (!canSelect(p)) fail(403, p.fare === 'Light' ? 'Seat selection is not included in Economy Light. Unlock it, or get a free seat at check-in.' : 'Seat selection is not available on this booking.');
    cleanHolds(f);
    const layout = await layoutOf(f, p.cabin), ext = await inventory.externalState(fid);
    const why = seatProblem(f, prefs, ext, layout, uid, seat);
    if (why) fail(409, why);
    for (const [s, h] of Object.entries(f.holds)) if (h.uid === uid) delete f.holds[s];
    f.holds[seat] = { uid, exp: now() + POLICY.holdMs };
    return { view: await passengerView(f, prefs, uid), holdUntil: iso(f.holds[seat].exp) };
  });
}

/** Advance seat selection (fares that include it, or Light after buying it): the chosen seat is kept until check-in.
 *  Students choose within the Student Zone; seat = null goes back to automatic seating (students) or to a free
 *  assigned seat at check-in (others). Same rules as everywhere: free seat, fare, zone, never next to a restriction. */
function select(uid, fid, seat) {
  return tx(fid, async (f, prefs) => {
    const p = mine(f, uid);
    if (p.status === 'checked_in') fail(409, "You're checked in. Ask at the airport to change your seat.");
    if (!canSelect(p)) fail(403, p.fare === 'Light' ? 'Seat selection is not included in Economy Light. Buy it for this flight, or get a free seat at check-in.' : 'Seat selection is not available on this booking.');
    if (now() > depMs(f) - POLICY.checkinCloseMinutes * 60e3) fail(409, 'Seat selection has closed for this flight.');
    const layout = await layoutOf(f, p.cabin), ext = await inventory.externalState(fid);
    for (const [s, h] of Object.entries(f.holds)) if (h.uid === uid) delete f.holds[s];
    if (!seat) {
      if (p.seat && p.seatKind !== 'manual') await release(f, uid);
      p.chosen = false;
    } else {
      seat = String(seat);
      const why = seatProblem(f, prefs, ext, layout, uid, seat);
      if (why) fail(409, why);
      const r = await inventory.assign(fid, seat, pseudo(uid, fid));
      if (!r.ok) fail(409, r.error);
      p.seat = seat; p.seatKind = p.student ? 'zone' : 'selected'; p.chosen = true; p.rev++; p.updatedAt = iso();
    }
    repo.audit({ fid, actor: uid, action: seat ? 'seat_selected' : 'seat_selection_cleared', pax: pseudo(uid, fid), seat: seat || undefined });
    await reallocate(f, prefs, 'seat selection');
    return { view: await passengerView(f, prefs, uid) };
  });
}

/** Let go of a held seat (the passenger keeps their assignment, or gets one at check-in). */
function dropHold(uid, fid) {
  return tx(fid, async (f, prefs) => {
    mine(f, uid);
    for (const [s, h] of Object.entries(f.holds)) if (h.uid === uid) delete f.holds[s];
    return { view: await passengerView(f, prefs, uid) };
  });
}

/** Check in: confirms and locks a seat. `seat` = a selected seat (needs seat selection); none = assigned for free. */
function checkin(uid, fid, body = {}) {
  return tx(fid, async (f, prefs) => {
    const p = mine(f, uid);
    if (p.status === 'checked_in') fail(409, "You're already checked in.");
    if (body.rev !== undefined && Number(body.rev) !== p.rev) fail(409, 'Your seat changed on another device. Here is the latest.', { stale: true });
    const t = now(), dep = depMs(f);
    if (t < dep - POLICY.checkinOpenHours * 3600e3) fail(409, `Online check-in opens ${POLICY.checkinOpenHours} hours before departure.`);
    if (t > dep - POLICY.checkinCloseMinutes * 60e3) fail(409, 'Online check-in has closed for this flight.');
    const layout = await layoutOf(f, p.cabin), ext = await inventory.externalState(fid);
    let seat = body.seat ? String(body.seat) : null;
    if (seat && seat !== p.seat) {
      if (!canSelect(p)) fail(403, p.fare === 'Light' ? 'Seat selection is not included in Economy Light. Check in without choosing and we assign a seat for free.' : 'Seat selection is not available on this booking.');
      const why = seatProblem(f, prefs, ext, layout, uid, seat);
      if (why) fail(409, why);
    } else if (!seat && p.seat) seat = p.seat;
    if (!seat) seat = autoSeat(f, prefs, ext, layout, uid);
    if (!seat) fail(409, "We couldn't assign a seat online. Please see the check-in counter.");
    const r = await inventory.assign(fid, seat, pseudo(uid, fid));
    if (!r.ok) fail(409, r.error);
    for (const [s, h] of Object.entries(f.holds)) if (h.uid === uid) delete f.holds[s];
    const kind = p.student && zoneSeats(f, layout).includes(seat) ? 'zone' : seat === p.seat && p.seatKind ? p.seatKind : body.seat ? 'selected' : 'assigned';
    p.seat = seat; p.seatKind = kind; p.status = 'checked_in'; p.alloc = p.student ? 'assigned' : null; p.rev++; p.updatedAt = iso();
    repo.audit({ fid, actor: uid, action: 'checked_in', pax: pseudo(uid, fid), seat, kind });
    await reallocate(f, prefs, 'check-in');
    return { view: await passengerView(f, prefs, uid) };
  });
}
/* A free seat for someone who doesn't select one: Student Zone first for students, then the cabin, never next
 * to a restricted passenger, never on a reserved zone seat for non-students. */
function autoSeat(f, prefs, ext, layout, uid) {
  const p = f.pax[uid], all = engine.seatsOf(layout), zone = new Set(p.cabin === 'Economy' ? zoneSeats(f, layout) : []);
  const order = p.student ? [...all.filter((s) => zone.has(s)), ...all.filter((s) => !zone.has(s))] : all;
  // A student who couldn't be placed in the zone (full, or under review) gets a valid seat elsewhere.
  return order.find((s) => !seatProblem(f, prefs, ext, layout, uid, s, { ignoreZone: p.student })) || null;
}

/** Economy Light: buy seat selection for this flight. Payment itself is recorded by the app's points ledger. */
function unlock(user, fid, method) {
  return tx(fid, async (f, prefs) => {
    const p = mine(f, user.id);
    if (p.cabin !== 'Economy' || p.fare !== 'Light') fail(400, 'Seat selection is already included in your fare.');
    if (p.status === 'checked_in') fail(409, "You're already checked in.");
    if (!['sp', 'miles'].includes(method)) fail(400, 'Choose student points or Asia Miles.');
    if (method === 'sp' && !studentVerify.eligibleOn(user, f.seg.dep).ok) fail(403, 'Student points are for verified students.');
    if (p.unlock) return { view: await passengerView(f, prefs, user.id) };
    p.unlock = { with: method, at: iso() }; p.rev++;
    repo.audit({ fid, actor: user.id, action: 'seat_selection_purchased', pax: pseudo(user.id, fid), with: method });
    return { view: await passengerView(f, prefs, user.id) };
  });
}

/* ---------- confidential exclusions ---------- */
/* Students who may be chosen: other verified students on this flight who are visible in its student chat
 * (they already show a first name there). Others aren't listed, so nobody learns more names than the chat shows. */
function chatMembers(fid) { const r = ((db.chat || {}).rooms || {})[fid]; return r ? Object.entries(r.members).filter(([, m]) => !m.left).map(([u]) => u) : []; }
function exclusionGate(f, uid) {
  const p = mine(f, uid);
  if (!p.student) fail(403, 'Seating preferences are for verified students in the Student Zone on this flight.');
  if (now() > depMs(f) - POLICY.exclusionDeadlineHours * 3600e3) fail(409, `Seating preferences close ${POLICY.exclusionDeadlineHours} hours before departure.`);
  return p;
}
async function participants(uid, fid) {
  const f = await load(fid);
  if (!f) throw new SeatError(403, 'You have no booking on this flight.');
  const prefs = repo.getPrefs(fid);
  {
    exclusionGate(f, uid);
    const mineList = (prefs[uid] || {}).excludes || [];
    const list = chatMembers(fid).filter((o) => o !== uid && f.pax[o] && isStudentOn(o, f)).map((o) => ({
      handle: handleFor(uid, o, fid), name: (db.users[o] || {}).firstName || 'Student', uni: f.pax[o].share ? f.pax[o].uni : '', excluded: mineList.includes(o),
    }));
    // Someone already excluded who is no longer listed (left the chat) stays manageable, without a name.
    for (const o of mineList) if (!list.some((x) => x.handle === handleFor(uid, o, fid))) list.push({ handle: handleFor(uid, o, fid), name: 'A student you excluded', uni: '', excluded: true });
    return { participants: list, deadline: iso(depMs(f) - POLICY.exclusionDeadlineHours * 3600e3) };
  }
}
/** Replace the student's own exclusion list (one-way submission, mutual effect). Response never says whether anyone moved. */
function setExclusions(uid, fid, handles) {
  return tx(fid, async (f, prefs, prefsDirty) => {
    exclusionGate(f, uid);
    if (!Array.isArray(handles) || handles.length > POLICY.maxExclusions) fail(400, `Choose up to ${POLICY.maxExclusions} students.`);
    const known = new Map([...chatMembers(fid), ...((prefs[uid] || {}).excludes || [])].filter((o) => o !== uid && f.pax[o]).map((o) => [handleFor(uid, o, fid), o]));
    const targets = [...new Set(handles.map(String))].map((h) => known.get(h));
    if (targets.some((t) => !t)) fail(400, 'One of those students is no longer on this flight. Reload and try again.');
    if (targets.length) prefs[uid] = { excludes: targets, updatedAt: iso() }; else delete prefs[uid];
    prefsDirty();
    repo.audit({ fid, actor: uid, action: 'exclusions_updated', count: targets.length }); // never who
    await reallocate(f, prefs, 'preferences');
    return { ok: true, count: targets.length, message: "Saved. Your preferences are private: nobody is told, and you won't be seated next to them." };
  });
}
/** Chat shortcut ("Don't seat me next to them" on a message). Adds one exclusion. */
function addExclusion(uid, fid, target) {
  return tx(fid, async (f, prefs, prefsDirty) => {
    exclusionGate(f, uid);
    if (!f.pax[target] || target === uid) fail(400, 'Not possible for this message.');
    const list = (prefs[uid] || {}).excludes || [];
    if (!list.includes(target)) { if (list.length >= POLICY.maxExclusions) fail(400, 'You have reached the maximum number of seating preferences.'); prefs[uid] = { excludes: [...list, target], updatedAt: iso() }; prefsDirty(); }
    repo.audit({ fid, actor: uid, action: 'exclusions_updated', count: prefs[uid].excludes.length });
    await reallocate(f, prefs, 'preferences');
    return { ok: true };
  });
}

/* ---------- views ---------- */
const NOTICE = {
  assigned: (p) => `Your Student Zone seat is ${p.seat}.`,
  waitlisted: () => "The Student Zone is full on this flight right now. We'll seat you there as soon as a seat opens; otherwise you'll get a regular seat at check-in.",
  review: () => "We need to arrange your Student Zone seat by hand. Our team will confirm it before check-in; you don't need to do anything.",
};
/** What one passenger may see: the seat map of THEIR cabin (seat states only), the zone's capacity and their own
 *  booking. Never other passengers' ids, names, bookings or preferences, and never why a seat is unavailable. */
async function passengerView(f, prefs, uid) {
  cleanHolds(f);
  const p = f.pax[uid];
  const layout = await layoutOf(f, p.cabin), ext = await inventory.externalState(f.id);
  const at = occupant(f), zone = p.cabin === 'Economy' ? zoneSeats(f, layout) : [], zoneSet = new Set(zone), reserved = zoneReserved(f);
  const seats = {};
  for (const s of engine.seatsOf(layout)) {
    if (p.seat === s) seats[s] = 'mine';
    else if (f.holds[s] && f.holds[s].uid === uid) seats[s] = 'held';
    else if (zoneSet.has(s) && reserved && !p.student) seats[s] = at[s] || ext.sold.has(s) || ext.blocked.has(s) ? 'x' : 'zone';
    else if (p.student && reserved && !zoneSet.has(s)) seats[s] = 'out'; // outside the zone: not shown to zone students at all
    else seats[s] = seatProblem(f, prefs, ext, layout, uid, s) ? 'x' : 'free';
  }
  const studentsInZone = Object.values(f.pax).filter((x) => x.student && x.seat && zoneSet.has(x.seat)).length;
  const zoneFree = zone.filter((s) => !at[s] && !ext.sold.has(s) && !ext.blocked.has(s)).length;
  let nearby = null;
  if (p.student && p.seat) {
    const nb = engine.adjacent(layout, p.seat).map((s) => at[s]).filter((o) => o && f.pax[o].student);
    nearby = { students: nb.length, sameUni: nb.some((o) => f.pax[o].share && p.uni && f.pax[o].uni === p.uni), unis: nb.map((o) => (f.pax[o].share ? f.pax[o].uni : '')).filter(Boolean) };
  }
  const t = now(), dep = depMs(f);
  const holdSeat = Object.keys(f.holds).find((s) => f.holds[s].uid === uid) || null;
  return {
    fid: f.id, v: f.v + 1, seg: { number: f.seg.number, from: f.seg.from, to: f.seg.to, dep: f.seg.dep, aircraft: f.seg.aircraft },
    layout: { name: layout.name, blocks: layout.blocks, first: layout.first, last: layout.last }, seats,
    zone: p.cabin === 'Economy' ? { rows: [f.zone.firstRow, f.zone.lastRow], capacity: zone.filter((s) => !ext.blocked.has(s)).length, students: studentsInZone, available: zoneFree, reserved, releaseAt: iso(dep - f.zone.releaseHours * 3600e3) } : null,
    me: {
      cabin: p.cabin, fare: p.fare, selection: selection(p), status: p.status, seat: p.seat, seatKind: p.seatKind, chosen: Boolean(p.chosen), hold: holdSeat, rev: p.rev,
      wantsStudent: p.wantsStudent, student: p.student, alloc: p.alloc, notice: p.student && p.alloc && p.status !== 'checked_in' ? NOTICE[p.alloc](p) : '',
      nearby, share: p.share,
      checkin: t < dep - POLICY.checkinOpenHours * 3600e3 ? 'not_open' : t > dep - POLICY.checkinCloseMinutes * 60e3 ? 'closed' : 'open',
      preferencesOpen: p.student && t <= dep - POLICY.exclusionDeadlineHours * 3600e3,
    },
  };
}
/* Read a flight without changing it (legacy records are migrated once, in a transaction). */
async function load(fid) {
  let f = repo.getFlight(fid);
  if (f && !f.zone) { await tx(fid, async () => null); f = repo.getFlight(fid); }
  return f;
}
async function view(uid, fid) {
  const f = await load(fid);
  if (!f || !f.pax[uid]) throw new SeatError(403, 'You have no booking on this flight.');
  return passengerView(f, repo.getPrefs(fid), uid);
}

/* ---------- operations (accounts in SEAT_OPS) ---------- */
const isOps = (u) => Boolean(u) && String(process.env.SEAT_OPS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(u.email);
const opsName = (uid) => { const u = db.users[uid] || {}; return `${u.firstName || '?'} ${u.lastName || ''}`.trim(); };
async function opsView(actor, fid, req) {
  const f = await load(fid);
  if (!f) throw new SeatError(404, 'Unknown flight.');
  const prefs = repo.getPrefs(fid), layout = await layoutOf(f), ext = await inventory.externalState(fid);
  const pairs = pairsOf(prefs);
  repo.audit({ fid, actor: actor.id, action: 'ops_viewed', ip: req ? String(req.ip || '') : '' });
  return {
    fid, v: f.v, seg: f.seg, inventory: inventory.kind, zone: { ...f.zone, seats: zoneSeats(f, layout), reserved: zoneReserved(f) }, layout,
    sold: [...ext.sold], blocked: Object.fromEntries(ext.blocked), holds: Object.keys(f.holds),
    pax: Object.entries(f.pax).sort((a, b) => a[1].n - b[1].n).map(([uid, p]) => ({ uid, name: opsName(uid), ref: p.ref, cabin: p.cabin, fare: p.fare, student: p.student,
      wantsStudent: p.wantsStudent, seat: p.seat, seatKind: p.seatKind, status: p.status, alloc: p.alloc })),
    // Staff resolving a review see which passengers must not be adjacent — never who asked, never pairs unrelated to an open review.
    reviews: f.reviews.map((r) => ({ ...r, names: r.uids.map(opsName),
      restrictions: r.status === 'open' ? pairs.filter(([a, b]) => r.uids.includes(a) || r.uids.includes(b)).map(([a, b]) => [a, b].sort()).filter((x, i, arr) => arr.findIndex((y) => y[0] === x[0] && y[1] === x[1]) === i).map(([a, b]) => ({ a: opsName(a), b: opsName(b), aUid: a, bUid: b })) : [] })),
    log: f.log, audit: repo.auditFor(fid, 50).map(({ ip, ...e }) => e),
  };
}
function opsZone(actor, fid, b) {
  return tx(fid, async (f, prefs) => {
    const layout = await layoutOf(f), first = Number(b.firstRow), last = Number(b.lastRow), rel = b.releaseHours === undefined ? f.zone.releaseHours : Number(b.releaseHours);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first > last || first < layout.first || last > layout.last) fail(400, `Rows must be within Economy (${layout.first}–${layout.last}).`);
    if (!(rel >= 0 && rel <= 240)) fail(400, 'Release time must be 0–240 hours before departure.');
    // Seats already held by non-students can't be turned into zone seats while they are reserved.
    const at = occupant(f), clash = engine.seatsOf(layout, [first, last]).filter((s) => at[s] && !f.pax[at[s]].student);
    if (clash.length && now() < depMs(f) - rel * 3600e3) fail(409, `Seats ${clash.slice(0, 5).join(', ')} are assigned to passengers outside the Student Zone. Choose other rows or move them first.`);
    f.zone = { firstRow: first, lastRow: last, releaseHours: rel, updatedBy: actor.id, updatedAt: iso() };
    repo.audit({ fid, actor: actor.id, action: 'zone_configured', firstRow: first, lastRow: last, releaseHours: rel, reason: str(b.reason, 200) });
    log(f, `Student Zone set to rows ${first}–${last} by operations.`);
    await reallocate(f, prefs, 'zone change', actor.id);
    return { ok: true };
  });
}
/** Inventory event from another channel (simulated adapter only): a seat sold, blocked or released. */
function opsInventory(actor, fid, b) {
  return tx(fid, async (f, prefs) => {
    const seat = String(b.seat || ''), act = b.action;
    if (!SEAT_RE.test(seat)) fail(400, 'Bad seat.');
    if (inventory.kind !== 'simulated') fail(400, 'Inventory changes come from the airline system.');
    const r = act === 'sell' ? inventory.sell(fid, seat) : act === 'block' ? inventory.block(fid, seat, b.reason) : act === 'release' ? inventory.release(fid, seat) : { ok: false, error: 'Unknown action.' };
    if (!r.ok) fail(409, r.error);
    repo.audit({ fid, actor: actor.id, action: 'inventory_' + act, seat, reason: str(b.reason, 200) });
    await reallocate(f, prefs, 'inventory change', actor.id);
    return { ok: true };
  });
}
/** Manual resolution: place a passenger on a seat. Still refuses to break a restriction. Moving a checked-in
 *  passenger is only possible here, with a reason, and is audited. */
function opsAssign(actor, fid, b) {
  return tx(fid, async (f, prefs) => {
    const uid = String(b.uid || ''), seat = String(b.seat || ''), reason = str(b.reason, 200);
    const p = f.pax[uid] || fail(404, 'Passenger not on this flight.');
    if (!reason) fail(400, 'Give a reason for the manual change.');
    const layout = await layoutOf(f, p.cabin), ext = await inventory.externalState(fid);
    if (restrictedNeighbour(f, prefs, layout, uid, seat)) fail(409, 'That seat would place this passenger next to someone they must not sit beside.');
    const why = seatProblem(f, prefs, ext, layout, uid, seat, { ignoreZone: true }); // operations may use any seat of the cabin
    if (why) fail(409, why);
    const r = await inventory.assign(fid, seat, pseudo(uid, fid));
    if (!r.ok) fail(409, r.error);
    const from = p.seat;
    p.seat = seat; p.seatKind = 'manual'; p.alloc = p.student ? 'assigned' : p.alloc; p.rev++; p.updatedAt = iso();
    repo.audit({ fid, actor: actor.id, action: p.status === 'checked_in' ? 'ops_moved_checked_in' : 'ops_assigned', pax: pseudo(uid, fid), from, seat, reason });
    log(f, `Operations placed a passenger in ${seat}${from ? ` (was ${from})` : ''}.`);
    await reallocate(f, prefs, 'manual resolution', actor.id);
    return { ok: true };
  });
}
function opsResolve(actor, fid, id, note) {
  return tx(fid, async (f) => {
    const r = f.reviews.find((x) => x.id === id) || fail(404, 'Unknown review.');
    r.status = 'resolved'; r.resolvedAt = iso(); r.resolvedBy = actor.id; r.note = str(note, 300);
    repo.audit({ fid, actor: actor.id, action: 'review_resolved', review: id, kind: r.kind });
    return { ok: true };
  });
}
function opsQueue() {
  return repo.listFlightIds().map((fid) => repo.getFlight(fid)).filter((f) => f && f.zone).map((f) => ({ fid: f.id, seg: f.seg, open: f.reviews.filter((r) => r.status === 'open').length,
    students: Object.values(f.pax).filter((p) => p.student).length, pax: Object.keys(f.pax).length })).sort((a, b) => b.open - a.open || a.seg.dep.localeCompare(b.seg.dep));
}

/* ---------- facts other modules need (chat, search) ---------- */
const paxOf = (fid, uid) => { const f = repo.getFlight(fid); return f && f.pax[uid] ? { ...f.pax[uid] } : null; };
const flightOf = (fid) => { const f = repo.getFlight(fid); return f ? { id: f.id, seg: f.seg } : null; };
function seatsLeft(seg) {
  const f = repo.getFlight(flightId(seg));
  const c = SZ.cabin(seg), total = SZ.allSeats(c).length;
  if (!f) return Math.min(9, total);
  const ext = inventory.inv(f.id);
  return Math.max(0, Math.min(9, total - Object.keys(ext.sold).length - Object.keys(ext.blocked).length - Object.values(f.pax).filter((p) => p.seat && p.cabin === 'Economy').length));
}

/* ---------- real-time updates: one stream per passenger, each with their own view ---------- */
const streams = new Map(); // fid -> Set({ res, uid })
const tickets = new Map(); // ticket -> { uid, fid, exp }
function ticket(uid, fid) {
  const f = repo.getFlight(fid);
  if (!f || !f.pax[uid]) throw new SeatError(403, 'You have no booking on this flight.');
  const t = crypto.randomBytes(24).toString('hex');
  tickets.set(t, { uid, fid, exp: now() + 60000 });
  return t;
}
function openStream(fid, tk, res) {
  const t = tickets.get(tk); tickets.delete(tk);
  if (!t || t.fid !== fid || t.exp < now()) return false;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const s = { res, uid: t.uid };
  if (!streams.has(fid)) streams.set(fid, new Set());
  streams.get(fid).add(s);
  send(fid, s);
  res.on('close', () => streams.get(fid) && streams.get(fid).delete(s));
  return true;
}
async function send(fid, s) {
  try {
    const f = repo.getFlight(fid);
    if (!f || !f.pax[s.uid]) { s.res.write('event: gone\ndata: {}\n\n'); return s.res.end(); }
    s.res.write(`data: ${JSON.stringify(await passengerView(f, repo.getPrefs(fid), s.uid))}\n\n`);
  } catch (e) { console.error('[seating] stream', e.message); }
}
function broadcast(fid) { for (const s of streams.get(fid) || []) send(fid, s); }
setInterval(() => { for (const set of streams.values()) for (const s of set) s.res.write(': ping\n\n'); for (const [k, v] of tickets) if (v.exp < now()) tickets.delete(k); }, 20000).unref();

/* Inventory changes made elsewhere (other channels, DCS) trigger a reallocation of that flight. */
inventory.onChange((fid) => { if (repo.getFlight(fid)) tx(fid, (f, prefs) => reallocate(f, prefs, 'inventory change')).catch((e) => console.error('[seating] realloc', e.message)); });

/* ---------- retention ---------- */
function purge() {
  const t = now();
  for (const fid of repo.listFlightIds()) {
    const f = repo.getFlight(fid);
    if (!f || !f.seg) continue;
    if (t > arrMs(f) + POLICY.prefsRetentionHours * 3600e3 && db.seatPrefs[fid]) { repo.putPrefs(fid, {}); repo.audit({ fid, actor: 'system', action: 'preferences_deleted_retention' }); }
    if (t > arrMs(f) + POLICY.flightRetentionDays * 864e5) { repo.deleteFlight(fid); delete db.inventory[fid]; save(); }
  }
  repo.pruneAudit(new Date(t - POLICY.auditRetentionDays * 864e5).toISOString());
}
setInterval(purge, 3600e3).unref();

module.exports = {
  POLICY, SeatError, ConflictError, repo, inventory, engine,
  book, cancel, select, hold, dropHold, checkin, unlock, participants, setExclusions, addExclusion, view, ticket, openStream, broadcast,
  isOps, opsView, opsZone, opsInventory, opsAssign, opsResolve, opsQueue,
  paxOf, flightOf, seatsLeft, pseudo, flightId, cleanSeg, ID_RE, purge,
  _setClock: (fn) => { clock = fn || (() => Date.now()); },
  _reallocate: (fid) => tx(fid, (f, prefs) => reallocate(f, prefs, 'manual')),
};
