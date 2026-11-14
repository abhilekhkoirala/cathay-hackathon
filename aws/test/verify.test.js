/* Unit tests for the verify logic, with an in-memory store and a fake mailer (no AWS needed).
 * Run from the repo root:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, clientIp, isEduEmail } = require('../lambda/verify');

function memoryStore(now) {
  const m = new Map();
  return {
    async hit(key) { const v = (m.get(key) || 0) + 1; m.set(key, v); return v; },
    async getPending(email) { const v = m.get('code#' + email); return v ? { ...v } : null; },
    async putPending(email, entry) { m.set('code#' + email, { ...entry }); },
    async bumpAttempts(email) { const v = m.get('code#' + email); if (!v) return null; v.attempts++; return { ...v }; },
    async deletePending(email) { m.delete('code#' + email); },
  };
}

function setup({ mailMode = 'ses', failMail } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const sent = [];
  const mailer = { async send(m) { if (failMail) throw failMail; sent.push(m); } };
  const handler = createHandler({ store: memoryStore(), mailer, mailMode, now: () => clock.t });
  const call = async (method, path, body, headers = {}) => {
    const r = await handler({
      rawPath: path,
      requestContext: { http: { method, sourceIp: '9.9.9.9' } },
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.statusCode, ...JSON.parse(r.body) };
  };
  const codeFromMail = () => /code is: (\d{6})/.exec(sent[sent.length - 1].text)[1];
  return { clock, sent, call, codeFromMail };
}

const EMAIL = 'jane@student.cuhk.edu.hk';

test('health reports mail mode', async () => {
  const { call } = setup();
  assert.deepEqual(await call('GET', '/api/health'), { status: 200, ok: true, mail: 'ses' });
  assert.equal((await setup({ mailMode: 'demo' }).call('GET', '/api/health')).mail, 'demo');
});

test('unknown routes 404, junk bodies 400', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('POST', '/api/verify/start', { email: 'x@gmail.com' })).status, 400);
  assert.equal((await call('POST', '/api/verify/start', { email: 'x@edu.com' })).status, 400);
  assert.equal((await call('POST', '/api/verify/start', { email: 'x@notedu.com' })).status, 400);
});

test('start emails a 6-digit code and never returns it; confirm accepts it once', async () => {
  const { call, sent, codeFromMail } = setup();
  const r = await call('POST', '/api/verify/start', { email: EMAIL, firstName: 'Jane' });
  assert.equal(r.status, 200); assert.equal(r.sent, true); assert.equal(r.demoCode, undefined);
  assert.match(r.to, /^j•+e@student\.cuhk\.edu\.hk$/);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, EMAIL);
  assert.match(sent[0].subject, /^Your Aurelia verification code: \d{6}$/);
  const code = codeFromMail();
  const ok = await call('POST', '/api/verify/confirm', { email: EMAIL, code });
  assert.equal(ok.status, 200); assert.equal(ok.verified, true); assert.equal(ok.email, EMAIL);
  // single use
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code })).status, 400);
});

test('email is case/space-insensitive', async () => {
  const { call, codeFromMail } = setup();
  await call('POST', '/api/verify/start', { email: '  Jane@STUDENT.cuhk.edu.hk ' });
  const ok = await call('POST', '/api/verify/confirm', { email: EMAIL, code: codeFromMail() });
  assert.equal(ok.verified, true);
});

test('html email escapes the first name', async () => {
  const { call, sent } = setup();
  await call('POST', '/api/verify/start', { email: EMAIL, firstName: '<img src=x onerror=1>' });
  assert.ok(!sent[0].html.includes('<img'));
  assert.ok(sent[0].html.includes('&lt;img'));
});

test('demo mode returns the code instead of emailing', async () => {
  const { call, sent } = setup({ mailMode: 'demo' });
  const r = await call('POST', '/api/verify/start', { email: EMAIL });
  assert.equal(r.sent, false); assert.equal(r.demoMode, true); assert.match(r.demoCode, /^\d{6}$/);
  assert.equal(sent.length, 0);
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: r.demoCode })).verified, true);
});

test('30s resend cooldown, then 5 codes per hour', async () => {
  const { call, clock } = setup();
  assert.equal((await call('POST', '/api/verify/start', { email: EMAIL })).status, 200);
  const early = await call('POST', '/api/verify/start', { email: EMAIL });
  assert.equal(early.status, 429); assert.match(early.error, /wait 30s/);
  for (let i = 0; i < 4; i++) { clock.t += 31_000; assert.equal((await call('POST', '/api/verify/start', { email: EMAIL })).status, 200); }
  clock.t += 31_000;
  const capped = await call('POST', '/api/verify/start', { email: EMAIL });
  assert.equal(capped.status, 429); assert.match(capped.error, /Too many codes/);
  clock.t += 3600_000; // an hour later it works again
  assert.equal((await call('POST', '/api/verify/start', { email: EMAIL })).status, 200);
});

test('wrong codes: counts down, locks after 5, then even the right code fails', async () => {
  const { call, codeFromMail } = setup();
  await call('POST', '/api/verify/start', { email: EMAIL });
  const good = codeFromMail(), bad = good === '000000' ? '111111' : '000000';
  for (let left = 4; left >= 0; left--) {
    const r = await call('POST', '/api/verify/confirm', { email: EMAIL, code: bad });
    assert.equal(r.status, 400); assert.match(r.error, new RegExp(`${left} attempts left`));
  }
  const locked = await call('POST', '/api/verify/confirm', { email: EMAIL, code: good });
  assert.equal(locked.status, 429);
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: good })).status, 400); // wiped
});

test('code expires after 10 minutes', async () => {
  const { call, clock, codeFromMail } = setup();
  await call('POST', '/api/verify/start', { email: EMAIL });
  const code = codeFromMail();
  clock.t += 10 * 60 * 1000 + 1;
  const r = await call('POST', '/api/verify/confirm', { email: EMAIL, code });
  assert.equal(r.status, 400); assert.match(r.error, /expired/);
});

test('confirm with no pending code or bad format', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '123456' })).status, 400);
  assert.match((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '12' })).error, /6-digit/);
});

test('SES failures give 502 and do not consume a send', async () => {
  const sandbox = Object.assign(new Error('Email address is not verified. The following identities failed the check'), { name: 'MessageRejected' });
  const a = setup({ failMail: sandbox });
  const r = await a.call('POST', '/api/verify/start', { email: EMAIL });
  assert.equal(r.status, 502); assert.match(r.error, /sandbox/);
  const b = setup({ failMail: new Error('boom') });
  const r2 = await b.call('POST', '/api/verify/start', { email: EMAIL });
  assert.equal(r2.status, 502); assert.match(r2.error, /could not send/);
  // no cooldown was stored, so an immediate retry is allowed
  assert.equal((await b.call('POST', '/api/verify/start', { email: EMAIL })).status, 502);
});

test('per-IP limit: 40 requests per window, keyed on CloudFront viewer address', async () => {
  const { call } = setup();
  const h = { 'cloudfront-viewer-address': '203.0.113.7:51234' };
  for (let i = 0; i < 40; i++) assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '123456' }, h)).status, 400);
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '123456' }, h)).status, 429);
  // a different viewer is unaffected, and a spoofed X-Forwarded-For doesn't help the first one
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '123456' }, { 'cloudfront-viewer-address': '203.0.113.8:1' })).status, 400);
  assert.equal((await call('POST', '/api/verify/confirm', { email: EMAIL, code: '123456' }, { ...h, 'x-forwarded-for': '1.1.1.1' })).status, 429);
});

test('oversized body is rejected', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/verify/start', { email: EMAIL, firstName: 'x'.repeat(5000) })).status, 413);
});

test('clientIp parsing', () => {
  assert.equal(clientIp({ headers: { 'cloudfront-viewer-address': '1.2.3.4:555' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'cloudfront-viewer-address': '[2001:db8::1]:555' } }), '2001:db8::1');
  assert.equal(clientIp({ headers: {}, requestContext: { http: { sourceIp: '5.6.7.8' } } }), '5.6.7.8');
  assert.equal(clientIp({}), 'unknown');
});

test('isEduEmail matches the front end rules', () => {
  for (const ok of ['a@mit.edu', 'a@cuhk.edu.hk', 'a@student.unsw.edu.au']) assert.equal(isEduEmail(ok), true, ok);
  for (const no of ['a@gmail.com', 'a@notedu.com', 'a@edu.com', 'nope', '']) assert.equal(isEduEmail(no), false, no);
});
