/* Seeded demo staff accounts come from environment variables and get their roles automatically. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
process.env.LIVE_DB = path.join(TMP, 'db.json');
process.env.DOC_VAULT = path.join(TMP, 'vault');
process.env.DOC_ENCRYPTION_KEY = 'c'.repeat(64);
for (const k of ['VERIFIERS', 'SEAT_OPS', 'SMTP_HOST', 'OAG_KEY']) delete process.env[k];
process.env.SEED_VERIFIER_EMAIL = 'Verifier@Cathay.demo';
process.env.SEED_VERIFIER_PASSWORD = 'verify-demo-2026';
process.env.SEED_OPS_EMAIL = 'ops@cathay.demo';
process.env.SEED_OPS_PASSWORD = 'short'; // too short: ignored, not created

const { app } = require('../server');
let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
const login = async (email, password) => (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();

test('seeded verifier can sign in and is a reviewer; a weak seed password is refused', async () => {
  const r = await login('verifier@cathay.demo', 'verify-demo-2026');
  assert.equal(r.ok, true); assert.equal(r.user.reviewer, true); assert.equal(r.user.seatOps, false);
  const q = await (await fetch(base + '/api/review/queue', { headers: { Authorization: 'Bearer ' + r.token } })).json();
  assert.equal(q.ok, true);
  assert.equal((await login('verifier@cathay.demo', 'wrong-password')).ok, false);
  assert.equal((await login('ops@cathay.demo', 'short')).ok, false);
});
