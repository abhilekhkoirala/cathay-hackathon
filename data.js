/* Aurelia Air — DEMO data. Fictional airline, fictional user. */
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toDate = (d) => toISO(d).slice(0, 10);
  const addDays = (n, h = 0, m = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    d.setDate(d.getDate() + n);
    return d;
  };

  function hash(str) {
    let h = 2166136261;
    for (const c of String(str)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const AIRPORTS = [
    { code: 'HKG', city: 'Hong Kong', country: 'Hong Kong SAR', lat: 22.31, lon: 113.91 },
    { code: 'SIN', city: 'Singapore', country: 'Singapore', lat: 1.36, lon: 103.99 },
    { code: 'NRT', city: 'Tokyo', country: 'Japan', lat: 35.77, lon: 140.39 },
    { code: 'ICN', city: 'Seoul', country: 'South Korea', lat: 37.46, lon: 126.44 },
    { code: 'TPE', city: 'Taipei', country: 'Taiwan', lat: 25.08, lon: 121.23 },
    { code: 'BKK', city: 'Bangkok', country: 'Thailand', lat: 13.69, lon: 100.75 },
    { code: 'DEL', city: 'Delhi', country: 'India', lat: 28.56, lon: 77.1 },
    { code: 'KTM', city: 'Kathmandu', country: 'Nepal', lat: 27.7, lon: 85.36 },
    { code: 'ALA', city: 'Almaty', country: 'Kazakhstan', lat: 43.35, lon: 77.04 },
    { code: 'SVO', city: 'Moscow', country: 'Russia', lat: 55.97, lon: 37.41 },
    { code: 'DXB', city: 'Dubai', country: 'UAE', lat: 25.25, lon: 55.36 },
    { code: 'LHR', city: 'London', country: 'United Kingdom', lat: 51.47, lon: -0.45 },
    { code: 'SYD', city: 'Sydney', country: 'Australia', lat: -33.94, lon: 151.18 },
    { code: 'SEA', city: 'Seattle', country: 'United States', lat: 47.45, lon: -122.31 },
    { code: 'JFK', city: 'New York', country: 'United States', lat: 40.64, lon: -73.78 },
  ];
  const CABINS = ['Economy', 'Premium Economy', 'Business', 'First'];
  const CABIN_MULT = { Economy: 1, 'Premium Economy': 1.7, Business: 3.2, First: 5 };
  const AIRCRAFT = ['A350-900', 'A330-300', 'B777-300ER', 'A321neo', 'B787-9'];

  const airport = (c) => AIRPORTS.find((a) => a.code === c);

  function distanceKm(a, b) {
    const A = airport(a),
      B = airport(b);
    if (!A || !B) return 1000;
    const R = 6371,
      rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(B.lat - A.lat),
      dLon = rad(B.lon - A.lon);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  function basePrice(from, to) {
    return Math.round(70 + distanceKm(from, to) * 0.075);
  }

  /* Deterministic: same route + date + cabin always yields the same flights. */
  function generateFlights(from, to, date, cabin) {
    const km = distanceKm(from, to);
    const base = Math.round((km / 800) * 60 + 35);
    const r = mulberry32(hash(from + to + date));
    const mult = CABIN_MULT[cabin] || 1;
    const out = [];
    for (let i = 0; i < 6; i++) {
      const hour = 6 + Math.floor(i * 3 + r() * 2);
      const min = [0, 15, 30, 45][Math.floor(r() * 4)];
      const dep = new Date(`${date}T${pad(hour % 24)}:${pad(min)}`);
      const stops = km > 9000 && r() > 0.55 ? 1 : 0;
      const durMin = base + Math.round(r() * 20) + (stops ? 95 : 0);
      const arr = new Date(dep.getTime() + durMin * 60000);
      out.push({
        number: 'AU ' + (100 + Math.floor(r() * 880)),
        from,
        to,
        dep: toISO(dep),
        arr: toISO(arr),
        durMin,
        stops,
        aircraft: AIRCRAFT[Math.floor(r() * AIRCRAFT.length)],
        price: Math.round(basePrice(from, to) * mult * (0.85 + r() * 0.5)),
        seatsLeft: 2 + Math.floor(r() * 8),
      });
    }
    return out.sort((a, b) => a.dep.localeCompare(b.dep));
  }

  const SEED_USER = {
    id: 'u_1001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    password: 'demo1234',
    memberId: 'AU 8800 1234',
    tier: 'Gold',
    points: 48250,
    tierPoints: 612,
    nextTier: 'Platinum',
    nextTierAt: 1000,
    phone: '+852 5555 0123',
    dob: '1994-03-12',
    nationality: 'Hong Kong SAR',
    memberSince: '2021',
    prefs: { seat: 'Window', meal: 'Standard', notifications: true },
  };

  function mkSeg(number, from, to, depDate, aircraft, seat) {
    const km = distanceKm(from, to);
    const durMin = Math.round((km / 800) * 60 + 35) + 8;
    const arr = new Date(depDate.getTime() + durMin * 60000);
    return { number, from, to, dep: toISO(depDate), arr: toISO(arr), durMin, stops: 0, aircraft, seat };
  }

  function seedTrips() {
    return [
      {
        ref: 'K7M2QX',
        status: 'Confirmed',
        cabin: 'Business',
        pax: [{ first: 'John', last: 'Doe' }],
        total: 1286,
        checkedIn: false,
        bought: toISO(addDays(-20, 10)),
        segments: [
          mkSeg('AU 507', 'HKG', 'NRT', addDays(1, 9, 40), 'A350-900', '4A'),
          mkSeg('AU 508', 'NRT', 'HKG', addDays(8, 17, 25), 'A350-900', '5A'),
        ],
      },
      {
        ref: 'R3T9WD',
        status: 'Confirmed',
        cabin: 'Economy',
        pax: [{ first: 'John', last: 'Doe' }],
        total: 742,
        checkedIn: false,
        bought: toISO(addDays(-6, 14)),
        segments: [mkSeg('AU 021', 'HKG', 'LHR', addDays(46, 23, 55), 'B777-300ER', '38K')],
      },
      {
        ref: 'M7S2HK',
        status: 'Confirmed',
        cabin: 'Economy',
        pax: [{ first: 'John', last: 'Doe' }],
        total: 698,
        checkedIn: false,
        bought: toISO(addDays(-12, 11)),
        segments: [mkSeg('AU 044', 'SVO', 'HKG', addDays(1, 20, 15), 'A350-900', '')],
      },
      {
        ref: 'P8C4HN',
        status: 'Completed',
        cabin: 'Economy',
        pax: [{ first: 'John', last: 'Doe' }],
        total: 318,
        checkedIn: true,
        bought: toISO(addDays(-60, 9)),
        segments: [
          mkSeg('AU 711', 'HKG', 'SIN', addDays(-34, 8, 10), 'A330-300', '22A'),
          mkSeg('AU 712', 'SIN', 'HKG', addDays(-30, 19, 45), 'A330-300', '22C'),
        ],
      },
    ];
  }

  window.AURELIA = {
    AIRPORTS, CABINS, CABIN_MULT, SEED_USER, seedTrips, generateFlights, distanceKm, basePrice,
    airport, hash, mulberry32, toISO, toDate, addDays, pad,
  };
})();
