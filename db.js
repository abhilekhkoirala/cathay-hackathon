/* Tiny JSON-file database shared by live.js (flights, seats) and accounts.js (users, sessions, app data).
 * Written atomically (temp file + rename), debounced. Fine for a demo server; DynamoDB in production. */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.LIVE_DB || path.join(__dirname, 'data', 'live-db.json');
const EMPTY = () => ({ flights: {}, searches: {}, users: {}, sessions: {}, userData: {} });

let db = EMPTY();
try { db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('[db] save failed:', e.message); }
  }, 200);
}

module.exports = { db, save };
