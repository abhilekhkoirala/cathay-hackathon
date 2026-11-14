/* Seating persistence. The service only uses this interface, so the storage can change without touching the
 * allocation logic.
 *
 * Prototype: JsonSeatingRepository on db.js (one JSON file). It still gives the service real transactional
 * semantics: every change to a flight runs inside withFlight(), which (1) serialises all writers of that flight
 * and (2) loads a private copy, then commits it only if the stored version is unchanged (optimistic concurrency).
 * NOT production-ready: single process, whole-file writes, no encryption at rest. See docs/SEATING.md for the
 * DynamoDB / relational design (conditional writes on version, one item per seat with attribute_not_exists).
 *
 * Collections:
 *   flights[fid]    flight seating record (inventory view, passengers, assignments, zone config, reviews, log)
 *   seatPrefs[fid]  CONFIDENTIAL exclusions { uid: { excludes: [uid], updatedAt } } — kept apart from the flight
 *                   record so it can never be serialised into a passenger view by mistake
 *   seatAudit       append-only audit of authorised changes (pseudonymous; never who excluded whom) */
'use strict';

class ConflictError extends Error { constructor(msg = 'Changed by someone else. Try again.') { super(msg); this.code = 'CONFLICT'; } }

class JsonSeatingRepository {
  constructor(db, save) {
    this.db = db; this.save = save;
    db.flights = db.flights || {}; db.seatPrefs = db.seatPrefs || {}; db.seatAudit = db.seatAudit || [];
    this.queues = new Map();
  }
  clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  getFlight(fid) { return this.clone(this.db.flights[fid]) || null; }
  listFlightIds() { return Object.keys(this.db.flights); }
  /** Commit a flight record if nobody else committed since it was read (version check). */
  putFlight(f, expected) {
    const cur = this.db.flights[f.id];
    if ((cur ? cur.v : 0) !== expected) throw new ConflictError();
    f.v = expected + 1;
    this.db.flights[f.id] = this.clone(f);
    this.save();
    return f;
  }
  deleteFlight(fid) { delete this.db.flights[fid]; delete this.db.seatPrefs[fid]; this.save(); }
  getPrefs(fid) { return this.clone(this.db.seatPrefs[fid]) || {}; }
  putPrefs(fid, prefs) { if (Object.keys(prefs).length) this.db.seatPrefs[fid] = this.clone(prefs); else delete this.db.seatPrefs[fid]; this.save(); }
  audit(entry) {
    this.db.seatAudit.push({ at: new Date().toISOString(), ...entry });
    if (this.db.seatAudit.length > 50000) this.db.seatAudit.splice(0, this.db.seatAudit.length - 50000);
    this.save();
  }
  auditFor(fid, n = 100) { return this.db.seatAudit.filter((e) => e.fid === fid).slice(-n).reverse(); }
  pruneAudit(beforeIso) { const n = this.db.seatAudit.length; this.db.seatAudit = this.db.seatAudit.filter((e) => e.at >= beforeIso); if (n !== this.db.seatAudit.length) this.save(); }

  /** Run fn(flight, prefs) exclusively for one flight. fn returns { flight?, prefs?, result }. Writes are committed
   *  only if fn succeeds; a version conflict aborts the whole change. */
  withFlight(fid, fn) {
    const prev = this.queues.get(fid) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const flight = this.getFlight(fid), expected = flight ? flight.v : 0, prefs = this.getPrefs(fid);
      const out = (await fn(flight, prefs)) || {};
      if (out.flight) this.putFlight(out.flight, expected);
      if (out.prefs) this.putPrefs(fid, out.prefs);
      return out.result;
    });
    this.queues.set(fid, run);
    run.finally(() => { if (this.queues.get(fid) === run) this.queues.delete(fid); }).catch(() => {});
    return run;
  }
}

module.exports = { JsonSeatingRepository, ConflictError };
