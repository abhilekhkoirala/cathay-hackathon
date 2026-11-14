/* Student Zone allocation engine (pure: no I/O, no clock, no randomness — same input, same output).
 *
 * Hard constraints (never broken by the engine):
 *   H1  a student is only placed on a seat of the Student Zone that is usable (not sold, blocked, held or
 *       taken by another passenger);
 *   H2  one seat, one passenger;
 *   H3  two students in an exclusion pair are never ADJACENT (adjacency = same row, same seat block, next
 *       letter; an aisle breaks adjacency — see adjacent());
 *   H4  locked students (checked in, or placed by operations) keep their seat; the engine never moves them.
 * Soft goals, in order: keep each student's previous seat (move only who is genuinely affected), seat students
 * in groups of 2–3 side by side (same university first), use the tightest gap so larger gaps stay usable.
 *
 * When a valid allocation is impossible the engine does NOT fall back to an invalid one: the student is left
 * unplaced with a reason ('capacity' = no zone seat left, 'constraint' = seats exist but none is valid), and
 * the service raises an operational review. Locked students who already break a constraint are reported in
 * `conflicts` (the engine can't move them; a human must). */
'use strict';

/* ---------- seat geometry ---------- */
const parse = (id) => { const row = parseInt(id, 10); return { row, L: String(id).slice(String(row).length) }; };
/* Seats directly beside `id`: same row, same block (no aisle in between), next letter on either side. */
function adjacent(layout, id) {
  const { row, L } = parse(id);
  const b = layout.blocks.find((x) => x.includes(L));
  if (!b || row < layout.first || row > layout.last) return [];
  const i = b.indexOf(L);
  return [b[i - 1], b[i + 1]].filter(Boolean).map((x) => row + x);
}
function seatsOf(layout, rows) {
  const out = [], lo = rows ? rows[0] : layout.first, hi = rows ? rows[1] : layout.last;
  for (let r = Math.max(lo, layout.first); r <= Math.min(hi, layout.last); r++) layout.blocks.forEach((b) => b.forEach((L) => out.push(r + L)));
  return out;
}
/* Maximal runs of side-by-side seats that satisfy ok(). */
function runs(layout, seats, ok) {
  const set = new Set(seats), out = [];
  const rows = [...new Set(seats.map((s) => parse(s).row))].sort((a, b) => a - b);
  for (const r of rows) for (const b of layout.blocks) {
    let cur = [];
    for (const L of b) { const id = r + L; if (set.has(id) && ok(id)) cur.push(id); else { if (cur.length) out.push(cur); cur = []; } }
    if (cur.length) out.push(cur);
  }
  return out;
}

const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
function pairSet(pairs) { const s = new Set(); for (const [a, b] of pairs || []) if (a && b && a !== b) s.add(pairKey(a, b)); return s; }

/* Every H3 violation in an assignment: [[idA, idB], ...]. Used by the engine, the service and the tests. */
function violations(layout, seatOf, pairs) {
  const ps = pairs instanceof Set ? pairs : pairSet(pairs), at = {}, out = [];
  for (const [id, seat] of Object.entries(seatOf)) if (seat) at[seat] = id;
  for (const [id, seat] of Object.entries(seatOf)) {
    if (!seat) continue;
    for (const nb of adjacent(layout, seat)) { const o = at[nb]; if (o && id < o && ps.has(pairKey(id, o))) out.push([id, o]); }
  }
  return out;
}

/* Split n into groups of 3 and 2, never leaving one alone if avoidable: 4 → 2+2, 5 → 3+2, 7 → 3+2+2. */
function sizes(n) { const out = []; let left = n; while (left > 4 || left === 3) { out.push(3); left -= 3; } while (left >= 2) { out.push(2); left -= 2; } return out; }
function permutations(a) { if (a.length <= 1) return [a]; return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])); }

/**
 * @param {object} input
 *   layout     { blocks: [['A','B','C'],...], first, last }   Economy layout from the inventory adapter
 *   zoneSeats  [seatId]   seats of the Student Zone that are usable for students right now
 *   students   [{ id, uni, order, locked: seat|null, prev: seat|null }]   order = booking order (lower = earlier)
 *   pairs      [[idA, idB]]  confidential exclusions, already made mutual (direction is irrelevant here)
 *   maxSteps   search budget for the exact solver (default 20000)
 * @returns { seatOf, unplaced: [{id, reason}], conflicts: [[a,b]], moved: [id], solver: 'greedy'|'search' }
 */
function allocate({ layout, zoneSeats, students, pairs, maxSteps = 20000 }) {
  const ps = pairSet(pairs), excl = (a, b) => ps.has(pairKey(a, b));
  const zone = [...new Set(zoneSeats)];
  const zoneSet = new Set(zone);
  const seatOf = {}, at = {};
  const put = (id, seat) => { seatOf[id] = seat; at[seat] = id; };
  const free = (seat) => zoneSet.has(seat) && !at[seat];
  const fits = (id, seat) => adjacent(layout, seat).every((nb) => !at[nb] || !excl(id, at[nb]));
  const byOrder = [...students].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  // H4: locked students first, wherever they are (a manual placement may be outside the zone).
  const locked = byOrder.filter((s) => s.locked);
  locked.forEach((s) => put(s.id, s.locked));
  const conflicts = violations(layout, seatOf, ps);

  let todo = byOrder.filter((s) => !s.locked);
  const unplaced = [];
  // Capacity: more students than usable zone seats → the latest bookings without a previous seat wait.
  const room = zone.filter((s) => !at[s]).length;
  if (todo.length > room) {
    const keepFirst = [...todo].sort((a, b) => (b.prev && zoneSet.has(b.prev) ? 1 : 0) - (a.prev && zoneSet.has(a.prev) ? 1 : 0) || a.order - b.order);
    const wait = new Set(keepFirst.slice(room).map((s) => s.id));
    todo.filter((s) => wait.has(s.id)).forEach((s) => unplaced.push({ id: s.id, reason: 'capacity' }));
    todo = todo.filter((s) => !wait.has(s.id));
  }

  // Keep previous seats that are still usable and valid (move only who is genuinely affected).
  const rest = [];
  for (const s of todo) { if (s.prev && free(s.prev) && fits(s.id, s.prev)) put(s.id, s.prev); else rest.push(s); }

  // Group the others: same university first, then mixed; place each group in the tightest free run.
  const byUni = new Map();
  rest.forEach((s) => { const k = String(s.uni || '').toLowerCase() || '~'; byUni.set(k, [...(byUni.get(k) || []), s]); });
  const groups = [], loose = [];
  for (const list of byUni.values()) { let i = 0; sizes(list.length).forEach((k) => { groups.push(list.slice(i, i + k)); i += k; }); loose.push(...list.slice(i)); }
  { let i = 0; sizes(loose.length).forEach((k) => { groups.push(loose.slice(i, i + k)); i += k; }); loose.slice(i).forEach((s) => groups.push([s])); }
  groups.sort((a, b) => b.length - a.length || a[0].order - b[0].order);

  const tryGroup = (g) => {
    if (g.length < 2) return false;
    const rs = runs(layout, zone, free).filter((r) => r.length >= g.length).sort((a, b) => a.length - b.length);
    for (const r of rs) for (let off = 0; off + g.length <= r.length; off++) for (const perm of permutations(g)) {
      const seats = r.slice(off, off + g.length), placed = [];
      let ok = true;
      for (let k = 0; k < perm.length; k++) { if (!fits(perm[k].id, seats[k])) { ok = false; break; } put(perm[k].id, seats[k]); placed.push(perm[k]); }
      if (ok) return true;
      placed.forEach((p) => { delete at[seatOf[p.id]]; delete seatOf[p.id]; });
    }
    return false;
  };
  const singles = [];
  for (const g of groups) {
    if (tryGroup(g)) continue;
    if (g.length === 3 && tryGroup(g.slice(0, 2))) { singles.push(g[2]); continue; }
    singles.push(...g);
  }
  // Singles: beside a seated student when valid (grouping), otherwise any valid zone seat.
  const failed = [];
  for (const s of singles) {
    const nearStudent = zone.filter((z) => free(z) && adjacent(layout, z).some((nb) => at[nb]));
    const seat = [...nearStudent, ...zone.filter((z) => free(z) && !nearStudent.includes(z))].find((z) => fits(s.id, z));
    if (seat) put(s.id, seat); else failed.push(s);
  }

  let solver = 'greedy';
  if (failed.length) {
    // Exact search over every unlocked student, previous/greedy seats tried first, so as few people move as
    // possible. Only used when the greedy pass can't satisfy the hard constraints.
    const vars = todo.slice().sort((a, b) => {
      const deg = (x) => todo.filter((y) => excl(x.id, y.id)).length;
      return deg(b) - deg(a) || a.order - b.order;
    });
    const greedy = { ...seatOf };
    const base = {}; locked.forEach((s) => { base[s.locked] = s.id; });
    const sol = search(layout, zone, vars, base, excl, (s) => [s.prev, greedy[s.id]].filter(Boolean), maxSteps);
    if (sol) {
      solver = 'search';
      vars.forEach((s) => { delete at[seatOf[s.id]]; delete seatOf[s.id]; });
      vars.forEach((s) => put(s.id, sol[s.id]));
      failed.length = 0;
    }
  }
  const left = zone.filter((z) => !at[z]).length;
  failed.forEach((s) => unplaced.push({ id: s.id, reason: left ? 'constraint' : 'capacity' }));

  const moved = students.filter((s) => !s.locked && s.prev && seatOf[s.id] && s.prev !== seatOf[s.id]).map((s) => s.id);
  return { seatOf, unplaced, conflicts, moved, solver };
}

/* Depth-first search with forward checking. Returns { id: seat } or null when impossible / out of budget. */
function search(layout, zone, vars, base, excl, preferred, maxSteps) {
  const at = { ...base }, seatOf = {};
  let steps = 0;
  const fits = (id, seat) => !at[seat] && adjacent(layout, seat).every((nb) => !at[nb] || !excl(id, at[nb]));
  const order = (s) => { const p = preferred(s); return [...p, ...zone.filter((z) => !p.includes(z))]; };
  function go(i) {
    if (i === vars.length) return true;
    if (++steps > maxSteps) return false;
    const s = vars[i];
    for (const seat of order(s)) {
      if (!fits(s.id, seat)) continue;
      at[seat] = s.id; seatOf[s.id] = seat;
      // forward check: every later student must still have at least one valid seat
      const dead = vars.slice(i + 1).some((v) => !zone.some((z) => fits(v.id, z)));
      if (!dead && go(i + 1)) return true;
      delete at[seat]; delete seatOf[s.id];
    }
    return false;
  }
  return go(0) ? seatOf : null;
}

module.exports = { allocate, adjacent, seatsOf, runs, violations, pairKey, parse };
