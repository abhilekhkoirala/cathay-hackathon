/* OAG Flight Info API client (server-side only — the key never reaches the browser).
 * Returns real Cathay Pacific (CX) schedules for one route and day, in the same shape as
 * generateFlights() in data.js. Every answer is cached by the caller, because the quota is small
 * (1,000 requests / 30 days, 10 results per request).
 * The first raw response is saved to data/oag-sample.json so field names can be checked. */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.OAG_BASE || 'https://api.oag.com/flight-instances/';
const TIMEOUT_MS = 4000;
const SAMPLE = path.join(__dirname, 'data', 'oag-sample.json');

/* OAG equipment codes (IATA) → the aircraft names the app knows (they pick the seat layout). */
const AIRCRAFT = {
  '359': 'A350-900', '351': 'A350-1000', '35K': 'A350-1000', '333': 'A330-300', '330': 'A330-300', '33X': 'A330-300',
  '77W': 'B777-300ER', '773': 'B777-300', '779': 'B777-9', '789': 'B787-9', '788': 'B787-8',
  '32Q': 'A321neo', '32N': 'A320neo', '321': 'A321', '320': 'A320', '74N': 'B747-8F', '74Y': 'B747-400F',
};

const pick = (o, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    if (v != null && v !== '') return v;
  }
  return undefined;
};
const hhmm = (t) => (String(t || '').match(/^(\d{1,2}):?(\d{2})/) || []).slice(1).map((x) => x.padStart(2, '0')).join(':');

/* One OAG record → our flight shape. Field names are read defensively (v1/v2 differ). */
function mapRecord(r) {
  const carrier = pick(r, 'carrier.iata', 'carrierCode.iata', 'carrierCode', 'carrier') || 'CX';
  const num = pick(r, 'flightNumber', 'flightNo');
  const depDate = pick(r, 'departure.date.local', 'departure.localDate', 'departureDate');
  const depTime = hhmm(pick(r, 'departure.time.local', 'departure.localTime', 'departureTime'));
  const arrDate = pick(r, 'arrival.date.local', 'arrival.localDate', 'arrivalDate') || depDate;
  const arrTime = hhmm(pick(r, 'arrival.time.local', 'arrival.localTime', 'arrivalTime'));
  const from = pick(r, 'departure.airport.iata', 'departure.airport', 'departureAirport');
  const to = pick(r, 'arrival.airport.iata', 'arrival.airport', 'arrivalAirport');
  if (!num || !depDate || !depTime || !arrTime || !from || !to) return null;
  const eq = String(pick(r, 'aircraftType.iata', 'equipment.aircraftType.iata', 'aircraftType', 'equipment') || '');
  const elapsed = Number(pick(r, 'elapsedTime', 'flightDuration', 'duration')) || 0;
  return {
    number: `${String(carrier).toUpperCase()} ${String(num).padStart(3, '0')}`,
    from: String(from).toUpperCase(),
    to: String(to).toUpperCase(),
    dep: `${String(depDate).slice(0, 10)}T${depTime}`,
    arr: `${String(arrDate).slice(0, 10)}T${arrTime}`,
    durMin: elapsed,
    stops: Number(pick(r, 'segmentInfo.numberOfStops', 'stops')) || 0,
    aircraft: AIRCRAFT[eq.toUpperCase()] || (eq ? `Aircraft ${eq}` : 'A350-900'),
    equipment: eq,
  };
}

/* Real CX flights from → to on date (YYYY-MM-DD). Throws on any failure; the caller falls back. */
async function searchFlights(from, to, date) {
  const key = process.env.OAG_KEY;
  if (!key) throw new Error('OAG_KEY not set');
  const q = new URLSearchParams({
    DepartureDateTime: date, DepartureAirport: from, ArrivalAirport: to, CarrierCode: 'CX',
    CodeType: 'IATA', Codeshare: 'Operating', FlightType: 'Scheduled', Limit: '10', version: 'v2',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res, body;
  try {
    res = await fetch(`${BASE}?${q}`, {
      headers: { 'Subscription-Key': key, 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    body = await res.json().catch(() => null);
  } finally { clearTimeout(timer); }
  if (!fs.existsSync(SAMPLE)) {
    try { fs.mkdirSync(path.dirname(SAMPLE), { recursive: true }); fs.writeFileSync(SAMPLE, JSON.stringify({ status: res.status, body }, null, 2)); } catch {}
  }
  if (!res.ok) throw new Error(`OAG HTTP ${res.status}`);
  const rows = Array.isArray(body) ? body : (body && (body.data || body.flights || body.items)) || [];
  const seen = new Set(), out = [];
  for (const r of rows) {
    const f = mapRecord(r);
    if (!f || f.from !== from || f.to !== to || seen.has(f.number)) continue;
    seen.add(f.number);
    out.push(f); // durMin 0 = OAG gave no elapsed time; the caller estimates it from the distance
  }
  return out.sort((a, b) => a.dep.localeCompare(b.dep));
}

module.exports = { searchFlights, mapRecord, AIRCRAFT };
