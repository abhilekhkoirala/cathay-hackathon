/* Cathay Student: shared definitions used by the app AND the server (seating/shared.js loads this file).
 * - Aircraft cabin layouts (seat blocks per row; an aisle separates blocks). The simulated seat-inventory adapter
 *   uses them; a real adapter gets the seat map from the airline's inventory instead.
 * - University names from email domains, age checks, and student-perk helpers.
 * Seat allocation is NOT done here any more: the Student Zone is allocated on the server (seating/engine.js). */
(function () {
  const { hash } = window.AURELIA;

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

  const flightKey = (seg) => seg.number + seg.dep.slice(0, 10);

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
    universityFromEmail, isAdult, flightKey, cabin, allSeats,
    plugFor, countryPlug, studyCountry, referralCode, tierUp,
  };
})();
