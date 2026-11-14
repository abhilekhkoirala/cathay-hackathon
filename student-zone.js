/* Cathay Student — Student seating. DEMO data: simulated student passengers and the seat planner.
 * There is no student section: verified students are seated automatically in small groups of 2–3
 * side by side (e.g. 9A 9B 9C, then 13A 13B), from the same university when possible.
 * Every other seat stays on sale. When a paying passenger buys a seat planned for a student,
 * the planner re-runs and only the students whose group was broken are moved. */
(function () {
  const { hash, mulberry32 } = window.AURELIA;

  const FIELDS = ['Business', 'Engineering', 'Computer science', 'Medicine', 'Law', 'Arts & humanities', 'Sciences', 'Design'];
  const YEARS = ['1st year', '2nd year', '3rd year', "Master's", 'PhD'];
  const NAMES = ['Mei', 'Jason', 'Priya', 'Kenji', 'Chloe', 'Arjun', 'Sofia', 'Wing', 'Lucas', 'Hana', 'Omar', 'Yuki', 'Ethan', 'Aisha', 'Daniel', 'Ming', 'Zara', 'Kai', 'Nadia', 'Tom'];

  const UNIS = {
    HKG: ['HKU', 'CUHK', 'HKUST', 'PolyU', 'CityU'],
    LHR: ['UCL', 'Imperial College', "King's College London", 'LSE', 'Univ. of Manchester'],
    SYD: ['Univ. of Sydney', 'UNSW', 'Univ. of Melbourne'],
    JFK: ['NYU', 'Columbia', 'Cornell'],
    SEA: ['Univ. of Washington', 'UBC', 'Stanford'],
    NRT: ['Univ. of Tokyo', 'Waseda', 'Keio'],
    ICN: ['Seoul National Univ.', 'KAIST', 'Yonsei'],
    SIN: ['NUS', 'NTU', 'SMU'],
    TPE: ['National Taiwan Univ.', 'NTHU'],
    BKK: ['Chulalongkorn', 'Mahidol'],
    DEL: ['IIT Delhi', 'Univ. of Delhi'],
    DXB: ['NYU Abu Dhabi', 'Khalifa Univ.'],
    KTM: ['Tribhuvan Univ.', 'Kathmandu Univ.'],
    ALA: ['Nazarbayev Univ.', 'KBTU'],
    SVO: ['Moscow State Univ.', 'HSE Moscow', 'MGIMO'],
    CDG: ['Sorbonne Univ.', 'Sciences Po', 'HEC Paris'],
  };
  /* How many students fly a route (min, max). Big study destinations are busiest. */
  const BUSY = { LHR: [7, 11], SYD: [6, 10], JFK: [6, 10], SEA: [5, 9], SVO: [8, 12], NRT: [3, 8], ICN: [3, 8], SIN: [3, 8], TPE: [2, 7] };

  /* Known .edu domains; anything else is guessed from the label before "edu". */
  const DOMAINS = {
    'cuhk.edu.hk': 'CUHK', 'link.cuhk.edu.hk': 'CUHK', 'polyu.edu.hk': 'PolyU', 'cityu.edu.hk': 'CityU', 'hkbu.edu.hk': 'HKBU',
    'mit.edu': 'MIT', 'nyu.edu': 'NYU', 'columbia.edu': 'Columbia', 'uw.edu': 'Univ. of Washington', 'stanford.edu': 'Stanford',
    'unsw.edu.au': 'UNSW', 'student.unsw.edu.au': 'UNSW', 'sydney.edu.au': 'Univ. of Sydney', 'unimelb.edu.au': 'Univ. of Melbourne',
    'nus.edu.sg': 'NUS', 'ntu.edu.sg': 'NTU',
  };
  function universityFromEmail(email) {
    const d = String(email || '').split('@')[1];
    if (!d) return '';
    if (DOMAINS[d]) return DOMAINS[d];
    const labels = d.split('.');
    const name = labels[Math.max(0, labels.indexOf('edu') - 1)] || labels[0];
    return name.length <= 5 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1);
  }

  function ageOn(dob, iso) {
    const b = new Date(dob + 'T00:00'), d = new Date(iso);
    let a = d.getFullYear() - b.getFullYear();
    if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
    return a;
  }
  const isAdult = (dob, iso) => ageOn(dob, iso) >= 18;

  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const flightKey = (seg) => seg.number + seg.dep.slice(0, 10);

  /* Deterministic: the same flight always has the same students. Most are heading to study
   * at the destination (Moscow → HKG: students going to HK universities), some are going home. */
  function studentsOn(seg) {
    const r = mulberry32(hash('sz' + flightKey(seg)));
    const away = seg.to === 'HKG' ? seg.from : seg.to;
    const [lo, hi] = BUSY[away] || [1, 5];
    const n = lo + Math.floor(r() * (hi - lo + 1));
    return Array.from({ length: n }, (_, i) => {
      const goingHome = r() < 0.2;
      return {
        id: 's' + i,
        name: NAMES[(hash(flightKey(seg)) + i * 7) % NAMES.length],
        uni: pick(r, goingHome ? UNIS[seg.from] || UNIS.HKG : UNIS[seg.to] || UNIS.HKG),
        year: pick(r, YEARS),
        field: pick(r, FIELDS),
        share: r() < 0.6, // ~60% chose to show their university to students seated near them
      };
    });
  }

  /* Cabin layouts. Row ranges never overlap, so a seat id (e.g. 41C) is unique on the whole aircraft.
   * Wide-bodies: First 1-1-1, Business 1-2-1, Premium Economy 2-4-2, Economy 3-3-3. A321neo: Business 2-2, Economy 3-3. */
  const LAYOUTS = {
    wide: {
      First: { blocks: [['A'], ['D'], ['K']], first: 1, last: 2 },
      Business: { blocks: [['A'], ['D', 'G'], ['K']], first: 11, last: 24 },
      'Premium Economy': { blocks: [['A', 'C'], ['D', 'E', 'F', 'G'], ['H', 'K']], first: 31, last: 34 },
      Economy: { blocks: [['A', 'B', 'C'], ['D', 'E', 'G'], ['H', 'J', 'K']], first: 40, last: 62 },
    },
    narrow: {
      Business: { blocks: [['A', 'C'], ['H', 'K']], first: 1, last: 3 },
      Economy: { blocks: [['A', 'B', 'C'], ['H', 'J', 'K']], first: 20, last: 37 },
    },
  };
  function cabin(seg, name = 'Economy') {
    const set = /A32/.test(seg.aircraft) ? LAYOUTS.narrow : LAYOUTS.wide;
    return { ...(set[name] || (name === 'Economy' ? set.Economy : set.Business)), name };
  }
  const allSeats = (c) => {
    const out = [];
    for (let row = c.first; row <= c.last; row++) c.blocks.forEach((b) => b.forEach((L) => out.push(row + L)));
    return out;
  };
  const parse = (id) => { const row = parseInt(id, 10); return { row, L: id.slice(String(row).length) }; };

  /* Seats directly left and right of `id` (same row, no aisle in between). */
  function neighbours(c, id) {
    const { row, L } = parse(id);
    const b = c.blocks.find((x) => x.includes(L)), i = b.indexOf(L);
    return [b[i - 1], b[i + 1]].filter(Boolean).map((x) => row + x);
  }
  /* Maximal runs of seats side by side that satisfy `ok`. */
  function runs(c, ok) {
    const out = [];
    for (let row = c.first; row <= c.last; row++) {
      for (const b of c.blocks) {
        let cur = [];
        for (const L of b) {
          if (ok(row + L)) cur.push(row + L);
          else { if (cur.length) out.push(cur); cur = []; }
        }
        if (cur.length) out.push(cur);
      }
    }
    return out;
  }

  /* Seats already sold to (simulated) passengers: deterministic, about half of Economy, 40% elsewhere. */
  function paidSeats(seg, name = 'Economy') {
    const r = mulberry32(hash('paid' + flightKey(seg) + (name === 'Economy' ? '' : name)));
    const share = name === 'Economy' ? 0.5 : 0.4;
    return new Set(allSeats(cabin(seg, name)).filter(() => r() < share));
  }

  /* Split n students into groups of 3 and 2, never leaving one alone: 4 → 2+2, 5 → 3+2, 7 → 3+2+2. */
  function sizes(n) {
    const out = [];
    let left = n;
    while (left > 4 || left === 3) { out.push(3); left -= 3; }
    while (left >= 2) { out.push(2); left -= 2; }
    return out;
  }

  /* Same-university groups first; the rest are mixed. Biggest groups first. */
  function makeGroups(students) {
    const byUni = new Map();
    students.forEach((s) => { const k = s.uni.toLowerCase(); byUni.set(k, [...(byUni.get(k) || []), s]); });
    const groups = [], loose = [];
    for (const list of byUni.values()) {
      let i = 0;
      sizes(list.length).forEach((k) => { groups.push(list.slice(i, i + k)); i += k; });
      loose.push(...list.slice(i));
    }
    let i = 0;
    sizes(loose.length).forEach((k) => { groups.push(loose.slice(i, i + k)); i += k; });
    if (i < loose.length) { // exactly one student left: join a pair, or fly alone
      const pair = groups.find((g) => g.length === 2);
      if (pair) pair.push(loose[i]); else groups.push([loose[i]]);
    }
    return groups.sort((a, b) => b.length - a.length);
  }

  /* Seat every student on the flight.
   * opts.sold: seats bought by paying passengers since the flight opened.
   * opts.me:   the signed-in student ({ id, name, uni, locked? }); a locked (checked-in) seat never moves.
   * opts.prev: { studentId: seat } from the last run, so groups that are still intact stay where they are.
   * opts.real: real students booked from other devices (live demo), in booking order.
   * opts.fixed: { studentId: seat } decided by the shared seat server; kept as they are when still free. */
  function plan(seg, opts = {}) {
    const c = cabin(seg);
    const paid = paidSeats(seg);
    (opts.sold || []).forEach((id) => paid.add(id));
    const students = studentsOn(seg).concat(opts.real || [], opts.me ? [opts.me] : []);
    const prev = opts.prev || {};
    const seatOf = {}, used = new Set();
    const isFree = (id) => !paid.has(id) && !used.has(id);
    const put = (s, id) => { seatOf[s.id] = id; used.add(id); };

    const locked = new Set(students.filter((s) => s.locked).map((s) => s.locked));
    students.filter((s) => s.locked).forEach((s) => put(s, s.locked));
    if (opts.fixed) students.forEach((s) => { const id = opts.fixed[s.id]; if (!seatOf[s.id] && id && isFree(id)) put(s, id); });

    // Students who still sit next to another student in the last run stay where they are;
    // only those whose group was broken by a sale are grouped again.
    const prevAt = {};
    students.forEach((s) => { if (!seatOf[s.id] && prev[s.id] && isFree(prev[s.id])) prevAt[prev[s.id]] = s; });
    runs(c, (id) => Boolean(prevAt[id]) || locked.has(id)).forEach((r) => {
      if (r.length >= 2) r.forEach((id) => { if (prevAt[id]) put(prevAt[id], id); });
    });
    const todo = makeGroups(students.filter((s) => !seatOf[s.id]));

    // Tightest run that fits, so bigger gaps stay free for paying passengers.
    const place = (g) => {
      const fit = runs(c, isFree).filter((r) => r.length >= g.length).sort((a, b) => a.length - b.length)[0];
      if (fit) g.forEach((s, i) => put(s, fit[i]));
      return Boolean(fit);
    };
    const rest = [];
    todo.forEach((g) => {
      if (place(g)) return;
      if (g.length === 3 && place(g.slice(0, 2))) rest.push(g[2]);
      else rest.push(...g);
    });
    // Whoever didn't fit with their group is paired with another leftover student,
    // then sat beside any seated student, then paired with one member borrowed from a group of 3
    // (which stays a pair), and only alone as a last resort.
    const singles = [];
    for (let i = 0; i < rest.length; i += 2) {
      const g = rest.slice(i, i + 2);
      if (g.length < 2 || !place(g)) singles.push(...g);
    }
    singles.forEach((s) => {
      const next = Object.values(seatOf).map((id) => neighbours(c, id).find(isFree)).find(Boolean);
      if (next) return put(s, next);
      const pairRun = runs(c, isFree).find((r) => r.length >= 2);
      const seated = new Set(Object.values(seatOf));
      const trio = pairRun && runs(c, (id) => seated.has(id)).find((r) => r.length === 3);
      const mate = trio && students.find((x) => seatOf[x.id] === trio[2] && !x.locked);
      if (mate) { used.delete(trio[2]); put(mate, pairRun[0]); return put(s, pairRun[1]); }
      const seat = allSeats(c).find(isFree);
      if (seat) put(s, seat);
    });

    const at = {};
    students.forEach((s) => { if (seatOf[s.id]) at[seatOf[s.id]] = s; });
    const neighboursOf = (s) => (seatOf[s.id] ? neighbours(c, seatOf[s.id]).map((id) => at[id]).filter(Boolean) : []);
    const groups = runs(c, (id) => Boolean(at[id])).map((seats) => {
      const members = seats.map((id) => at[id]);
      return { seats, members, sameUni: members.length > 1 && members.every((m) => m.uni === members[0].uni) };
    });
    return {
      cabin: c, paid, students, seatOf, at, groups, neighboursOf,
      moved: students.filter((s) => prev[s.id] && seatOf[s.id] && prev[s.id] !== seatOf[s.id]),
    };
  }

  /* ---------- student perks ---------- */

  /* Plug type(s) used in each country. */
  const PLUGS = {
    'Hong Kong SAR': 'G', 'United Kingdom': 'G', Singapore: 'G', UAE: 'G', Japan: 'A', Taiwan: 'A', 'United States': 'A',
    'South Korea': 'C / F', Russia: 'C / F', Kazakhstan: 'C / F', Thailand: 'A / C', India: 'C / D', Nepal: 'C / D',
    Australia: 'I', France: 'E',
  };
  const countryPlug = (country) => PLUGS[country] || '';
  const plugFor = (code) => countryPlug((window.AURELIA.airport(code) || {}).country);

  /* Country of the university, from the verified email: cuhk.edu.hk → Hong Kong, ucl.ac.uk → UK, mit.edu → US. */
  const STUDY_COUNTRIES = {
    hk: 'Hong Kong SAR', uk: 'United Kingdom', au: 'Australia', sg: 'Singapore', jp: 'Japan', kr: 'South Korea', tw: 'Taiwan',
    th: 'Thailand', in: 'India', np: 'Nepal', kz: 'Kazakhstan', ae: 'UAE', ru: 'Russia', fr: 'France', edu: 'United States',
  };
  const studyCountry = (email) => STUDY_COUNTRIES[String(email || '').toLowerCase().split('.').pop()] || '';

  /* Personal invite code, e.g. JOHN-K7M2: same student, same code. */
  function referralCode(firstName, email) {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let h = hash(String(email).toLowerCase()), code = '';
    for (let i = 0; i < 4; i++) { code += a[h % a.length]; h = Math.floor(h / a.length); }
    return String(firstName).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) + '-' + code;
  }

    const TIERS = ['Green', 'Silver', 'Gold', 'Diamond'];
  /* One tier up; a student member (no Cathay tier yet) goes to Silver. */
  const tierUp = (tier) => (TIERS.includes(tier) ? TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)] : 'Silver');

  window.AURELIA_SZ = {
    universityFromEmail, isAdult, flightKey, studentsOn, cabin, allSeats, paidSeats, neighbours, plan,
    plugFor, countryPlug, studyCountry, referralCode, tierUp,
  };
})();
