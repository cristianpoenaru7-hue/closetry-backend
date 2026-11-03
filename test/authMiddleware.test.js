const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

let users = [];
const dbPath = require.resolve(path.join(__dirname, '..', 'src/config/db.js'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { user: { findUnique: async ({ where }) => users.find((u) => u.id === where.id) || null } },
};
const { requireAuth } = require('../src/middleware/auth');
const { signToken } = require('../src/utils/authUtils');

async function run(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  return { ...out, nextCalled, userId: req.userId };
}
const tokenAt = (sub, iatSeconds) => jwt.sign({ sub, iat: iatSeconds }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
const nowS = () => Math.floor(Date.now() / 1000);

test('password accounts (passwordDisabledAt null) keep working with their existing token', async () => {
  users = [{ id: 'u1', passwordDisabledAt: null }];
  const r = await run(tokenAt('u1', nowS() - 3 * 86400)); // an older build's token
  assert.ok(r.nextCalled);
  assert.equal(r.userId, 'u1');
});

test('a token for a deleted account is rejected', async () => {
  users = [];
  const r = await run(signToken({ id: 'gone', email: 'x@example.com' }));
  assert.equal(r.status, 401);
  assert.ok(!r.nextCalled);
});

test('a token issued before the password was disabled (account linked) is rejected', async () => {
  const disabledAt = new Date();
  users = [{ id: 'u1', passwordDisabledAt: disabledAt }];
  const old = await run(tokenAt('u1', nowS() - 60));
  assert.equal(old.status, 401);
  assert.ok(!old.nextCalled);
});

test('tokens issued at or after that moment are accepted, including within the same second', async () => {
  const disabledAt = new Date();
  users = [{ id: 'u1', passwordDisabledAt: disabledAt }];
  assert.ok((await run(tokenAt('u1', Math.floor(disabledAt.getTime() / 1000)))).nextCalled);
  assert.ok((await run(signToken({ id: 'u1', email: 'x@example.com' }))).nextCalled);
});

test('only HS256 tokens are accepted', async () => {
  users = [{ id: 'u1', passwordDisabledAt: null }];
  const hs512 = jwt.sign({ sub: 'u1' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  assert.equal((await run(hs512)).status, 401);
  const unsigned = jwt.sign({ sub: 'u1' }, '', { algorithm: 'none' });
  assert.equal((await run(unsigned)).status, 401);
});

test('a validly signed token without sub is a 401, not a 500', async () => {
  users = [];
  const noSub = jwt.sign({ foo: 1 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const r = await run(noSub);
  assert.equal(r.status, 401);
  assert.ok(!r.nextCalled);
});
