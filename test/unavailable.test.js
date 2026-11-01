const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

delete process.env.OPENWEATHER_API_KEY;
delete process.env.RESEND_API_KEY;

const stubPath = require.resolve('../src/config/db.js');
require.cache[stubPath] = {
  id: stubPath, filename: stubPath, loaded: true,
  exports: { user: { findUnique: async () => ({ name: 'N', email: 'n@example.com' }) } },
};

const { UNAVAILABLE_MESSAGE, sendUnavailable } = require('../src/utils/unavailable');
const { getCurrentWeather } = require('../src/controllers/weather.controller');
const { submitContact } = require('../src/controllers/contact.controller');

async function call(handler, req) {
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  const realErr = console.error;
  console.error = () => {};
  try { await handler(req, res, (e) => { throw e; }); } finally { console.error = realErr; }
  return out;
}

test('sendUnavailable keeps 503 and { error } but hides the internal reason', async () => {
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  const logged = [];
  const realErr = console.error;
  console.error = (m) => logged.push(m);
  try { sendUnavailable(res, new Error('ANTHROPIC_API_KEY is not set')); } finally { console.error = realErr; }
  assert.equal(out.status, 503);
  assert.deepEqual(out.body, { error: UNAVAILABLE_MESSAGE });
  assert.match(logged.join(' '), /ANTHROPIC_API_KEY/); // the detail still reaches the log
});

test('weather without OPENWEATHER_API_KEY: 503 with the generic message', async () => {
  const out = await call(getCurrentWeather, { query: { lat: '44.4', lon: '26.1' } });
  assert.equal(out.status, 503);
  assert.equal(out.body.error, UNAVAILABLE_MESSAGE);
});

test('contact without RESEND_API_KEY: 503 with the generic message', async () => {
  const out = await call(submitContact, { userId: 'u1', body: { message: 'hello' } });
  assert.equal(out.status, 503);
  assert.equal(out.body.error, UNAVAILABLE_MESSAGE);
});

test('no controller sends a config error message to the client on 503', () => {
  const dir = path.join(__dirname, '..', 'src', 'controllers');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/status\(503\)\.json\(\{ error: err\.message/.test(src), `${f} leaks err.message on 503`);
  }
});
