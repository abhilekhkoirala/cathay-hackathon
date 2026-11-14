/* The browser's data.js (airports, fares, schedules) and student-zone.js (aircraft cabin layouts) loaded once on
 * the server, so the server and the app use the same definitions without copying them. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['data.js', 'student-zone.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
module.exports = { D: sandbox.window.AURELIA, SZ: sandbox.window.AURELIA_SZ };
