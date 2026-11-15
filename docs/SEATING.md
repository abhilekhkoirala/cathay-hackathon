# Student Zone seating: architecture, allocation rules and production integration

This describes the seating backend added in `seating/`. It replaces the earlier planner, which ran in each browser: devices worked out the seat plan themselves, flight seat data was readable without signing in, student seats were only "planned" and could be sold, and exclusions were applied after the fact and could fail silently.

## Dynamic student seating (default: `SEATING_MODE=dynamic`)

There is **no reserved Student Zone** by default. Verified students who said yes are seated **anywhere in Economy**, in groups of 2–3 side by side, same university first. **No seat is held back from sale.**

- **A paying passenger can take any free seat**, including one only *planned* for a student. They can buy it in the app or through another sales channel.
- **When that happens, the plan re-runs.** Students still sitting next to another student keep their seats. Anyone left alone is regrouped, borrowing one student from a group of 3 if needed, so **nobody sits alone** when the cabin allows it. Example: 6 students in 9A–9C and 14A–14C; someone buys 14A; the student from 14A is re-seated next to at least one student.
- **Soft reserve:** when a paying passenger is seated automatically (check-in without choosing), free seats beside a student are used **last**, so a student who is alone for now keeps a free neighbour for longer. Anyone who **pays to choose** that seat can still buy it, so Cathay loses no revenue. Automatic seating also never takes a seat planned for a student.
- **Detect and offer, never force:** if an Essential or Flex student's **own chosen seat** ends up with no student beside it (e.g. paying passengers bought both neighbours), the app offers a **free one-tap move** next to students ("A student is now seated in row 40, move to 40C?"). If they say no, they keep their seat. A chosen seat is never moved without consent.
- **Never taken from a student:** a checked-in student's seat, a seat placed by operations, or a seat an Essential or Flex student chose themselves.
- **Unchanged:** private exclusions, Economy Light rules, the review queue and the live updates work as before.

The protected-rows design is still available with `SEATING_MODE=zone` (`test/seating.test.js` covers it; `test/seating-dynamic.test.js` covers the default).

## 1. What it does

- **Student Zone:** a block of whole Economy rows (default rows 48–52 on wide-bodies, 30–33 on the A321neo). Operations can change it per flight. Its seats are protected in the seat inventory, so other sales channels can't sell them. Only verified students (18+, verification valid on the flight date) who chose student seating are allocated there.
- **No fictional seats:** capacity counts real seats of the aircraft seat map, minus blocked ones. At **`releaseHours` before departure (default 24 h)** unused zone seats go back on general sale, so no seat stays empty because of the zone.
- **Confidential exclusions:** a student can choose other students on the same flight they don't want to sit next to. The submission is one-way, but the effect is mutual: if A excludes B, A and B are never adjacent, whatever B does. Students can't ask to sit next to someone.
- **Server is the source of truth:** the server allocates seats, holds a seat while a passenger chooses, confirms and locks seats at check-in, handles cancellations, and enforces fare rules. Every connected device gets its own updated view live.

## 2. Components

| File | Role |
|---|---|
| `seating/engine.js` | **Allocation engine.** Pure function (no I/O, clock or randomness): same input, same output. Unit-tested on its own. |
| `seating/inventory.js` | **Inventory adapter.** `InventoryAdapter` defines the contract; `SimulatedInventoryAdapter` is the prototype version. It is the only code that talks to seat inventory. |
| `seating/repository.js` | **Persistence.** `JsonSeatingRepository` (prototype) with per-flight serialisation and version-checked commits. Defines the interface a production database implementation must provide. |
| `seating/service.js` | **Domain logic:** bookings, eligibility, holds, check-in, fare rules, exclusions, reallocation, operational reviews, per-viewer views, audit, retention, live updates. |
| `seating/routes.js` | **HTTP API** under `/api/seating`: passenger routes need sign-in plus a booking on the flight; ops routes need `SEAT_OPS`. |
| `seating/shared.js` | Loads `data.js` (fares, airports) and `student-zone.js` (cabin layouts) once on the server, so the app and server share definitions. |

The app (`app.js`) never allocates seats. It registers bookings, shows the seat map the server sends for **that** passenger, and asks the server to hold, select or assign seats.

## 3. Data model

```
flights[fid]   (fid = "CX251-2026-11-15")
  seg            flight number, airports, times, aircraft
  v              version: incremented on every committed change (optimistic concurrency)
  zone           { firstRow, lastRow, releaseHours, updatedBy, updatedAt }
  pax[uid]       { n (booking order), ref, cabin, fare, wantsStudent, share, student (computed), uni (computed),
                   seat, seatKind: zone|selected|assigned|manual, alloc: assigned|waitlisted|review,
                   status: booked|checked_in, unlock (seat selection bought), rev (per-passenger version) }
  holds[seat]    { uid, exp }   temporary hold while a passenger confirms (5 min)
  reviews[]      { id, kind: capacity|constraint|locked_conflict|seat_unavailable, uids, status, note, … }
  log[]          operational change log (no names, no reasons involving exclusions)
seatPrefs[fid][uid]   { excludes: [uid], updatedAt }   CONFIDENTIAL, stored apart from the flight record
seatAudit[]           { at, fid, actor, action, pax (pseudonym), seat, reason, count }   append-only
inventory[fid]        (simulated adapter only) { sold, blocked, zone, assigned }
```

`student`, `uni` and eligibility are **always computed on the server** from the account and its verification record (`student-verify.js`). The request only says "I'd like student seating" and "show my university". Passenger identity always comes from the session token.

## 4. Allocation rules (`engine.allocate`)

**Adjacency** comes from the aircraft layout. Two seats are adjacent if they are in the same row and the same seat block, with consecutive letters. An aisle separates blocks, so seats across an aisle are not adjacent. Different rows are never adjacent. Example (3-3-3): `50B` is adjacent to `50A` and `50C`; `50C` is not adjacent to `50D`.

**Hard constraints.** The engine never breaks these; if it ever produced a violation, the service would refuse to commit it:

1. A student is only placed on a usable Student Zone seat: not sold, blocked, held or taken by a non-student.
2. One seat, one passenger.
3. Two passengers in an exclusion pair are never adjacent (the pair is mutual).
4. Locked passengers are never moved. Locked means checked in, or placed manually by operations.

**Soft goals, in order:**

1. Keep each student's previous seat if it is still valid, so only people who are genuinely affected move.
2. Seat students in groups of 2–3 side by side, same university first.
3. Use the tightest gap, so larger gaps stay usable.
4. Seat any single student beside another student when that is valid.

**Algorithm:**
1. Place locked passengers, and report any of them who already break a restriction (`conflicts`).
2. If there are more students than usable zone seats, the latest bookings without a previous seat are waitlisted (`capacity`).
3. Keep valid previous seats.
4. Place groups, trying each orientation inside each run of free seats.
5. Place singles.
6. If anyone is still unplaced and free seats remain, run an exact depth-first search with forward checking over all unlocked students, trying previous and greedy seats first. It has a step budget.
7. Whoever still can't be placed is left without a seat, with reason `constraint`. **Nothing is forced.**

Who moves when an exclusion is added doesn't depend on who asked: the engine reasons over the mutual pair, so the person who asked can't be inferred from who moved.

**Reallocation** runs after every change: booking, cancellation, preference change, check-in, inventory event, zone change, manual placement. Eligibility is rechecked each time, so a student whose verification lapses before the flight date loses their unlocked zone seat.

## 5. Impossible allocations and manual resolution

When the engine can't place a student, the service:

- sets `alloc` to `waitlisted` (zone full) or `review` (restrictions can't be met);
- opens an **operational review** (`capacity`, `constraint`, `locked_conflict` for checked-in passengers who break a restriction, `seat_unavailable` for a locked passenger whose seat was blocked);
- shows the student a **neutral** message, e.g. *"We need to arrange your Student Zone seat by hand. Our team will confirm it before check-in; you don't need to do anything."* It never mentions an exclusion or another person.

Operations (`#/seating-ops`, accounts in `SEAT_OPS`) can:
- enlarge or move the zone;
- record inventory events;
- **place a passenger manually** on any seat in the cabin. The server still refuses a seat that would put two restricted passengers side by side.
- mark a review resolved with a note.

Moving a **checked-in** passenger is only possible through this manual process, needs a reason, and is audited (`ops_moved_checked_in`). Reviews close automatically when a reallocation no longer needs them.

At check-in, a student who is waitlisted or under review gets a valid seat outside the zone (still respecting restrictions). If there is none, they are told to see the counter.

## 6. Fare eligibility (seat assignment vs seat selection)

- **Seat assignment** (the airline gives the seat) is free on every fare. This covers Student Zone allocations and seats given at check-in.
- **Seat selection** (the passenger picks a specific seat) is included in Economy Essential, Economy Flex and premium cabins. On **Economy Light** it is a paid extra (`seat-unlock`). It is available in advance (`select`, from booking until check-in closes) and at check-in. A selected seat is kept until check-in, unless it later becomes invalid (blocked, or a new restriction), in which case the passenger is reallocated.
- **The Student Zone doesn't override fare rules.** A Light student gets a zone seat assigned but can't choose a different one. An Essential or Flex student can choose another available zone seat.
- **Enforced on the server:** `hold` and `checkin {seat}` return 403 without a selection right. The fare is stored on the booking record and can't be changed by re-sending the booking (change = cancel and rebook).

## 7. Concurrency, consistency and real time

- **One writer per flight:** every change runs in `repository.withFlight(fid, fn)`. Changes to the same flight are serialised, work on a private copy, and are committed only if the stored version still matches (`ConflictError` otherwise). The inventory adapter's `assign` also rejects a seat assigned to someone else. Two passengers can't receive the same seat: tested with two simultaneous check-ins for one seat (one 200, one 409).
- **Holds:** picking a seat holds it for 5 minutes; other devices see it as unavailable.
- **Stale clients:** check-in can carry the passenger's `rev`. A device holding an older revision gets 409 `stale` and reloads. Devices ignore pushed views whose version is lower than the one they already have.
- **Live updates:** `GET /flights/:fid/ticket` gives a one-time ticket (EventSource can't send headers). `/stream` then pushes each passenger **their own** view after every committed change. Tickets only open the flight they were issued for.

## 8. Privacy and security (designed with Hong Kong PDPO principles in mind, subject to legal review)

- **Authentication and flight-level authorisation:** every passenger route needs a session and a booking on that flight. Another flight's seat map, participants, exclusions or stream → 403. The old public `/api/live/flights/:id` endpoints were removed.
- **Data minimisation in views:** a passenger sees seat **states** only (`free`, `x` = not available, `zone`, `out`, `mine`, `held`), the zone's capacity and their own booking. `x` deliberately merges occupied, blocked, held and restricted seats, so nobody can tell why a seat is unavailable. Zone students only see the zone rows (the rest is `out`). Other passengers' ids, names, pseudonyms, bookings and preferences are never in any response.
- **Who can be excluded:** students can only choose students on the same flight who are visible in its student chat, where they already show a first name. Participant handles are HMACs that differ per viewer, so two students can't compare lists to identify each other.
- **Exclusions never leave the server:**
  - The student who made them sees only their own list.
  - The other person is never told, and their participant list shows nothing.
  - The audit log records `exclusions_updated` with a **count**, never the target.
  - Operations staff see an **undirected** "X and Y must not sit side by side", and only inside an open review that needs it. Opening the ops view is audited.
- **Retention:**
  - Exclusions: deleted 48 h after arrival, when either passenger cancels (their own list, and their entry in others' lists), and with chat-conduct cancellations.
  - Flight seating record: deleted 30 days after arrival.
  - Audit trail: 365 days.

  These periods need confirming by legal (PDPO data protection principles 2 and 3).
- The PDPO items that need people, not code, are listed in §11.

## 9. API

Passenger routes (signed in, booking on the flight):

| Method & path | What it does |
|---|---|
| `PUT /api/seating/flights/:fid/booking` | `{ seg, cabin, fare, ref, studentSeating, showUni }`: register or update (idempotent). The response includes `studentDenied` with the reason when student seating is refused. |
| `DELETE /api/seating/flights/:fid/booking` | Cancel. |
| `GET /api/seating/flights/:fid/seatmap` | This passenger's view. |
| `POST /api/seating/flights/:fid/select` | `{ seat \| null }`: advance seat selection, kept until check-in (fares that include it, or Light after buying it). Students choose within the zone; `null` goes back to automatic seating. |
| `POST /api/seating/flights/:fid/hold` | `{ seat }`: short hold for API clients that confirm in two steps; `DELETE …/hold` releases it. |
| `POST /api/seating/flights/:fid/checkin` | `{ seat?, rev? }`: confirm and lock. Without `seat`, a seat is assigned. |
| `POST /api/seating/flights/:fid/seat-unlock` | `{ with: 'sp' \| 'miles' }`: buy seat selection (Economy Light). |
| `GET /api/seating/flights/:fid/participants` | Students on this flight who can be excluded. |
| `PUT /api/seating/flights/:fid/exclusions` | `{ handles }`: replace this student's own list. |
| `GET /api/seating/flights/:fid/ticket` | One-time ticket for the live stream. |
| `GET /api/seating/flights/:fid/stream?ticket=` | Live updates (Server-Sent Events). |

Operations routes (account in `SEAT_OPS`):

| Method & path | What it does |
|---|---|
| `GET /api/seating/ops/flights` | Flights, with counts of open reviews. |
| `GET /api/seating/ops/flights/:fid` | Full manifest, reviews, log and audit (audited). |
| `PUT /api/seating/ops/flights/:fid/zone` | `{ firstRow, lastRow, releaseHours, reason }` |
| `POST /api/seating/ops/flights/:fid/inventory` | `{ seat, action: sell \| block \| release, reason }` (simulated adapter only) |
| `POST /api/seating/ops/flights/:fid/assign` | `{ uid, seat, reason }`: manual placement or move. |
| `POST /api/seating/ops/flights/:fid/reviews/:id/resolve` | `{ note }` |

The student chat's *"Don't seat me next to them"* writes to the same exclusion store (`service.addExclusion`).

## 10. Production integration

### 10.1 Seat inventory: replace `SimulatedInventoryAdapter`

Implement `InventoryAdapter` against the airline's reservation and departure-control systems:

| Method | Production behaviour |
|---|---|
| `seatMap(seg)` | Seat map for the operating aircraft (equipment swaps!), with blocked, exit-row and infant-bassinet characteristics. |
| `externalState(fid)` | Seats sold or blocked outside this system. Cache it, and invalidate the cache from the event feed. |
| `protectZone(fid, seats)` | Inventory control: block or reserve the zone seats against other channels, and release them at `releaseHours`. |
| `assign` / `unassign` | Seat assign and unassign in the PNR or DCS, idempotent per passenger, with the airline's own conflict errors mapped to 409. |
| `onChange(cb)` | Subscribe to the inventory and DCS event feed (seat sold, seat blocked, equipment change, passenger offloaded). Each event triggers a reallocation of that flight. |

Also needed from the airline:
- Booking and fare data from the **PNR / ticket**, not from the app. Today the app registers its own bookings; in production `book()` should be fed by the reservation system, and `fare` should come from the ticketed fare basis.
- **Seat-selection payments** through the airline's ancillary or EMD flow (the prototype records the unlock and the app's points ledger deducts the points).
- **Check-in status from the DCS** (who is checked in, boarded or offloaded), which defines "locked".

The adapter is `async` everywhere, and every call happens inside the per-flight transaction, so a network-backed adapter needs no other changes.

### 10.2 Persistence: replace `JsonSeatingRepository`

The JSON file is **not production-ready**: single process, whole-file rewrites, no encryption at rest, no backups.

**DynamoDB design (recommended):**

| Table | Keys | Notes |
|---|---|---|
| `SeatingFlights` | pk `FLIGHT#<fid>` | attributes `seg`, `zone`, `reviews`, `log`, `v`. Every update uses `ConditionExpression: v = :expected` (same semantics as `putFlight`). |
| `SeatingPassengers` | pk `FLIGHT#<fid>`, sk `PAX#<uid>` | the passenger record, with `rev`. |
| `SeatingAssignments` | pk `FLIGHT#<fid>`, sk `SEAT#<seat>` | `uid`, `kind`, `locked`. Created with `attribute_not_exists(sk)`, so the **database itself** guarantees one passenger per seat. Changes for a flight are written in one `TransactWriteItems` (old seat delete + new seat put + flight version check). |
| `SeatingHolds` | pk `FLIGHT#<fid>`, sk `SEAT#<seat>` | TTL attribute = hold expiry. |
| `SeatingPreferences` | pk `FLIGHT#<fid>`, sk `UID#<uid>` | **Separate table**, KMS-encrypted with its own key. IAM: only the seating service role can read it. TTL = arrival + 48 h. |
| `SeatingAudit` | pk `FLIGHT#<fid>`, sk `<iso>#<id>` | Append-only; TTL 365 days; streamed to the security log store. |

The service runs in several instances behind a load balancer. Per-flight serialisation then comes from the conditional writes (retry on `ConditionalCheckFailed`), not from the in-process queue. Use SNS/SQS or DynamoDB Streams to fan out "flight changed" events to the instances holding open streams (currently in memory).

**Relational alternative:**
- One transaction per change.
- `SELECT … FOR UPDATE` on the flight row.
- `UNIQUE (flight_id, seat)` on assignments.
- A `version` column.
- Exclusions in their own schema, with row-level security.

**Migration from the prototype:**
1. Export `flights`, `seatPrefs`, `seatAudit` and `inventory` from `data/live-db.json`.
2. Load them into the tables above, splitting each flight into flight, passenger and assignment items.
3. Map `uid` to the production customer id.
4. Re-run reallocation for every future flight.
5. Delete the JSON file.

`migrateLegacy()` already converts records from the old planner format.

## 11. Prototype vs. production

| Works in this prototype | Needs the airline's systems or people |
|---|---|
| Allocation engine with hard exclusions, grouping, capacity, locked seats, exact search | Tuning grouping weights and solver budget on real load factors; families and minors' rules; special service requests (wheelchairs, bassinets, exit-row eligibility) |
| Student Zone configuration, protection and timed release | Inventory control in the reservation system; revenue management deciding zone size per flight |
| Holds, versioned transactions, one-seat-one-passenger | Database-level guarantees (DynamoDB conditional writes or `UNIQUE` constraints) across several server instances |
| Simulated sales, blocks and releases from "other channels" (ops console) | The real inventory and DCS event feed; equipment changes |
| Fare rules for seat selection, stored per booking | Fare and ticket data from the PNR; payment for seat selection (EMD) |
| Check-in locks seats; manual moves are audited | DCS check-in status, boarding, offload; gate-agent tooling |
| Operational reviews and manual resolution | Staffed operations team with response times; scheduled re-checks before check-in closes |
| Retention jobs, pseudonymous audit | Legal confirmation of retention periods; PDPO personal information collection statement; data access and correction requests |
| Live updates over SSE (one process) | Pub/sub between instances; mobile push notifications |

### Known limitations

- **Single process:** per-flight serialisation is in memory. Production needs the database guarantees in §10.2.
- **Bookings come from the app:** the app registers its own bookings (`PUT …/booking`), so the fare is chosen by the client at booking time (as in any booking flow), then fixed. Production should read them from the PNR.
- **Seat-selection payments:** points and miles for seat selection are deducted by the app's ledger (synced through `/api/me/data`); the server records the unlock. A real implementation charges through the airline's ancillary system.
- **Students without the chat:** only students visible in the flight's student chat can be chosen as exclusions, because names aren't shown anywhere else. A real product may want another privacy-preserving way to identify someone, such as a booking reference given by the student or a staff-assisted request.
- **Restricted seats can be inferred:** a passenger can't tell why a seat is "not available", but someone determined could still compare notes with others. This is inherent to any seat map, and the reason exclusions are kept to the minimum needed.
- **Re-reviewing a placement before departure:** operations decide when to re-review a manual placement; there is no scheduled reminder yet.
