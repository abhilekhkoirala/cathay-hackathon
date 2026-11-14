/* Seat-inventory adapter: the ONLY place that talks to the airline's seat inventory.
 *
 * Production: implement InventoryAdapter against the airline's reservation / departure-control system
 * (e.g. a seat-map availability API, seat assign/unassign in the DCS, and an inventory event feed for seats sold
 * through other channels). Every method is async so a network-backed adapter fits without changing callers.
 *
 * Prototype: SimulatedInventoryAdapter keeps a per-flight inventory in the local database and uses the cabin
 * layouts in student-zone.js. It behaves like a real inventory (sales from "other channels", blocked seats,
 * protected Student Zone seats, conflicting assignments rejected) but it is NOT connected to any airline system. */
'use strict';
const { SZ } = require('./shared');

/* Contract every adapter implements. */
class InventoryAdapter {
  /** Aircraft seat map: { aircraft, cabins: { Economy: { blocks, first, last }, ... } } */
  async seatMap(_seg) { throw new Error('not implemented'); }
  /** Seats taken or unusable outside this system: { sold: Set<seat>, blocked: Map<seat, reason> } */
  async externalState(_fid) { throw new Error('not implemented'); }
  /** Protect the Student Zone seats from sale through other channels (inventory control / blocking). */
  async protectZone(_fid, _seats) { throw new Error('not implemented'); }
  /** Assign `seat` to a passenger in the inventory. Resolves { ok } or { ok:false, error } if it is taken. */
  async assign(_fid, _seat, _paxRef) { throw new Error('not implemented'); }
  /** Release a passenger's seat in the inventory. */
  async unassign(_fid, _seat, _paxRef) { throw new Error('not implemented'); }
  /** Subscribe to inventory changes made elsewhere: cb(fid). */
  onChange(_cb) {}
  /** 'simulated' | 'production' — shown in health checks and the ops console. */
  get kind() { return 'abstract'; }
}

class SimulatedInventoryAdapter extends InventoryAdapter {
  constructor(db, save) { super(); this.db = db; this.save = save; this.db.inventory = this.db.inventory || {}; this.listeners = []; }
  get kind() { return 'simulated'; }
  inv(fid) { return (this.db.inventory[fid] = this.db.inventory[fid] || { sold: {}, blocked: {}, zone: [], assigned: {} }); }
  async seatMap(seg) {
    const narrow = /A32/.test(seg.aircraft || '');
    const names = narrow ? ['Business', 'Economy'] : ['First', 'Business', 'Premium Economy', 'Economy'];
    const cabins = {};
    for (const n of names) { const c = SZ.cabin(seg, n); cabins[n] = { blocks: c.blocks, first: c.first, last: c.last }; }
    return { aircraft: seg.aircraft || 'A350-900', cabins };
  }
  async externalState(fid) {
    const i = this.inv(fid);
    return { sold: new Set(Object.keys(i.sold)), blocked: new Map(Object.entries(i.blocked)) };
  }
  async protectZone(fid, seats) { this.inv(fid).zone = [...seats]; this.save(); }
  async assign(fid, seat, paxRef) {
    const i = this.inv(fid);
    if (i.sold[seat] || i.blocked[seat]) return { ok: false, error: 'That seat is not available.' };
    if (i.assigned[seat] && i.assigned[seat] !== paxRef) return { ok: false, error: 'That seat was just taken.' };
    for (const [s, p] of Object.entries(i.assigned)) if (p === paxRef && s !== seat) delete i.assigned[s];
    i.assigned[seat] = paxRef; this.save();
    return { ok: true };
  }
  async unassign(fid, seat, paxRef) { const i = this.inv(fid); if (i.assigned[seat] === paxRef) { delete i.assigned[seat]; this.save(); } }
  onChange(cb) { this.listeners.push(cb); }

  /* ---- simulation of OTHER channels (call centre, partner airline, DCS). Used by the ops console and tests. ---- */
  /** A seat sold elsewhere. Refused for protected Student Zone seats and seats assigned to someone. */
  sell(fid, seat) {
    const i = this.inv(fid);
    if (i.zone.includes(seat)) return { ok: false, error: 'Seat is protected for the Student Zone.' };
    if (i.assigned[seat]) return { ok: false, error: 'Seat is already assigned to a passenger.' };
    if (i.sold[seat] || i.blocked[seat]) return { ok: false, error: 'Seat is not available.' };
    i.sold[seat] = true; this.save(); this.emit(fid);
    return { ok: true };
  }
  /** A seat becomes unusable (broken, crew rest, weight and balance). Always possible: the service handles who sat there. */
  block(fid, seat, reason = 'unavailable') { const i = this.inv(fid); i.blocked[seat] = String(reason).slice(0, 60); this.save(); this.emit(fid); return { ok: true }; }
  /** Undo a sale or block. */
  release(fid, seat) { const i = this.inv(fid); delete i.sold[seat]; delete i.blocked[seat]; this.save(); this.emit(fid); return { ok: true }; }
  emit(fid) { for (const cb of this.listeners) { try { cb(fid); } catch (e) { console.error('[inventory] listener failed', e); } } }
}

module.exports = { InventoryAdapter, SimulatedInventoryAdapter };
