const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { generateKeyPair, SignJWT } = require('jose');

process.env.JWT_SECRET = 'test-secret';
process.env.APPLE_BUNDLE_ID = 'com.example.test';
process.env.GOOGLE_IOS_CLIENT_ID = 'google-ios-client';
delete process.env.GOOGLE_WEB_CLIENT_ID;
delete process.env.APPLE_TEAM_ID;
delete process.env.APPLE_KEY_ID;
delete process.env.APPLE_SIGN_IN_PRIVATE_KEY;

// --- In-memory stand-in for Prisma (no database, no network) ---------------
const db = { users: [], identities: [], deletedImagesFor: [] };
let idCounter = 0;
const nid = () => `id-${++idCounter}`;

const fakePrisma = {
  user: {
    async findUnique({ where }) {
      return db.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) || null;
    },
    async create({ data }) {
      const { identities, ...rest } = data;
      const user = { id: nid(), phone: null, avatarUrl: null, theme: 'gold', weatherEnabled: true, aiConsentAt: null, createdAt: new Date(), ...rest };
      db.users.push(user);
      if (identities?.create) db.identities.push({ id: nid(), userId: user.id, ...identities.create });
      return user;
    },
    async update({ where, data }) {
      const user = db.users.find((u) => u.id === where.id);
      Object.assign(user, data);
      return user;
    },
    async delete({ where }) {
      db.users = db.users.filter((u) => u.id !== where.id);
      db.identities = db.identities.filter((i) => i.userId !== where.id); // cascade
    },
  },
  authIdentity: {
    async findUnique({ where, include }) {
      const { provider, providerUserId } = where.provider_providerUserId;
      const row = db.identities.find((i) => i.provider === provider && i.providerUserId === providerUserId);
      if (!row) return null;
      return include?.user ? { ...row, user: db.users.find((u) => u.id === row.userId) } : row;
    },
    async create({ data }) {
      const row = { id: nid(), ...data };
      db.identities.push(row);
      return row;
    },
  },
  async $transaction(ops) { return Promise.all(ops); },
};

function stub(relPath, exportsObj) {
  const resolved = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
stub('src/config/db.js', fakePrisma);
const realCloudinary = require('../src/config/cloudinary');
stub('src/config/cloudinary.js', { ...realCloudinary, deleteUserImages: async (id) => { db.deletedImagesFor.push(id); } });

const social = require('../src/services/socialAuth.service');
const { apple, google } = require('../src/controllers/social.controller');
const { me } = require('../src/controllers/auth.controller');
const { register, login } = require('../src/controllers/auth.controller');
const { changePassword, deleteMe, updateMe } = require('../src/controllers/users.controller');
const { errorHandler } = require('../src/middleware/errorHandler');
const { hashPassword, verifyToken } = require('../src/utils/authUtils');

// Runs a controller like Express would, including the error handler.
async function call(handler, { body = {}, userId } = {}) {
  const out = {};
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    send() { return this; },
  };
  const realError = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    let nextErr;
    await handler({ body, userId }, res, (e) => { nextErr = e; });
    if (nextErr) errorHandler(nextErr, {}, res, () => {});
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
  return out;
}

function reset() {
  db.users = [];
  db.identities = [];
  db.deletedImagesFor = [];
  social.__setAppleKeys(null);
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// --- Apple token verification (locally signed tokens, fake JWKS) ------------
async function appleSetup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  social.__setAppleKeys(publicKey);
  const sign = (claims = {}, { key = privateKey, iss = 'https://appleid.apple.com', aud = 'com.example.test', exp = '10m', iat } = {}) => {
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setIssuer(iss).setAudience(aud).setExpirationTime(exp);
    jwt.setIssuedAt(iat);
    return jwt.sign(key);
  };
  return { sign, wrongKey: other.privateKey };
}

test('apple: a valid token with the right nonce is accepted', async () => {
  reset();
  const { sign } = await appleSetup();
  const token = await sign({ sub: 'apple-1', email: 'A@Example.com', email_verified: 'true', nonce: sha256('raw-nonce') });
  const v = await social.verifyAppleIdentityToken(token, { nonce: 'raw-nonce' });
  assert.deepEqual(v, { provider: 'apple', sub: 'apple-1', email: 'a@example.com', emailVerified: true, name: null });
});

test('apple: wrong signature, audience, issuer, expiry or nonce are all rejected with 401', async () => {
  reset();
  const { sign, wrongKey } = await appleSetup();
  const good = { sub: 'apple-1', email: 'a@example.com', nonce: sha256('n') };
  const cases = {
    'wrong signature': await sign(good, { key: wrongKey }),
    'wrong audience': await sign(good, { aud: 'com.someone.else' }),
    'wrong issuer': await sign(good, { iss: 'https://evil.example.com' }),
    expired: await sign(good, { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }),
    'wrong nonce': await sign({ ...good, nonce: sha256('other') }),
    'missing nonce claim': await sign({ sub: 'apple-1' }),
  };
  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(
      () => social.verifyAppleIdentityToken(token, { nonce: 'n' }),
      (err) => err.status === 401 && err.message === social.VERIFY_FAILED,
      name,
    );
  }
  await assert.rejects(() => social.verifyAppleIdentityToken('not-a-jwt', { nonce: 'n' }), (e) => e.status === 401);
});

test('apple: a nonce claim equal to the RAW nonce is rejected (only the sha256 is accepted)', async () => {
  reset();
  const { sign } = await appleSetup();
  const token = await sign({ sub: 'apple-1', nonce: 'raw-nonce' });
  await assert.rejects(() => social.verifyAppleIdentityToken(token, { nonce: 'raw-nonce' }), (e) => e.status === 401);
});

test('apple: reauthentication rejects an old token (maxAgeSeconds)', async () => {
  reset();
  const { sign } = await appleSetup();
  const old = await sign({ sub: 'a', nonce: sha256('n') }, { iat: Math.floor(Date.now() / 1000) - 3000, exp: '1h' });
  await assert.rejects(() => social.verifyAppleIdentityToken(old, { nonce: 'n', maxAgeSeconds: 600 }), (e) => e.status === 401);
  const fresh = await sign({ sub: 'a', nonce: sha256('n') });
  assert.equal((await social.verifyAppleIdentityToken(fresh, { nonce: 'n', maxAgeSeconds: 600 })).sub, 'a');
});

// --- Google token verification (mocked client, no network) ------------------
function mockGoogle(payload, { fail = false } = {}) {
  const calls = [];
  social.__setGoogleClientFactory(() => ({
    async verifyIdToken(args) {
      calls.push(args);
      if (fail) throw new Error('Wrong recipient');
      return { getPayload: () => payload };
    },
  }));
  return calls;
}
const googlePayload = (extra = {}) => ({ iss: 'https://accounts.google.com', sub: 'g-1', email: 'G@Example.com', email_verified: true, name: 'Gina Google', iat: Math.floor(Date.now() / 1000), ...extra });

test('google: verifies against the configured client ids and normalizes the payload', async () => {
  const calls = mockGoogle(googlePayload());
  const v = await social.verifyGoogleIdToken('tok');
  assert.deepEqual(calls[0].audience, ['google-ios-client']);
  assert.deepEqual(v, { provider: 'google', sub: 'g-1', email: 'g@example.com', emailVerified: true, name: 'Gina Google' });
});

test('google: rejected token, wrong issuer and wrong nonce give 401; unconfigured gives 503', async () => {
  mockGoogle(null, { fail: true });
  await assert.rejects(() => social.verifyGoogleIdToken('tok'), (e) => e.status === 401);
  mockGoogle(googlePayload({ iss: 'https://evil.example.com' }));
  await assert.rejects(() => social.verifyGoogleIdToken('tok'), (e) => e.status === 401);
  mockGoogle(googlePayload({ nonce: 'abc' }));
  await assert.rejects(() => social.verifyGoogleIdToken('tok', { nonce: 'zzz' }), (e) => e.status === 401);
  assert.equal((await social.verifyGoogleIdToken('tok', { nonce: 'abc' })).sub, 'g-1');

  const saved = process.env.GOOGLE_IOS_CLIENT_ID;
  delete process.env.GOOGLE_IOS_CLIENT_ID;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(() => social.verifyGoogleIdToken('tok'), (e) => e.status === 503);
  } finally {
    console.warn = realWarn;
    process.env.GOOGLE_IOS_CLIENT_ID = saved;
  }
});

// --- Endpoints ---------------------------------------------------------------
test('POST /auth/google: new account needs acceptedPolicies, then returns 201 {user, token, isNewUser}', async () => {
  reset();
  mockGoogle(googlePayload());
  const refused = await call(google, { body: { idToken: 'tok' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'policies_required');
  assert.equal(db.users.length, 0);

  const ok = await call(google, { body: { idToken: 'tok', acceptedPolicies: true } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.isNewUser, true);
  assert.equal(ok.body.linked, false);
  assert.equal(ok.body.user.email, 'g@example.com');
  assert.equal(ok.body.user.name, 'Gina Google');
  assert.equal(ok.body.user.hasPassword, false);
  assert.equal(verifyToken(ok.body.token).sub, ok.body.user.id);
  assert.ok(!('passwordHash' in ok.body.user) && !('passwordDisabledAt' in ok.body.user));
  assert.equal(db.identities.length, 1);
  assert.ok(db.users[0].acceptedPoliciesAt && db.users[0].passwordDisabledAt);
});

test('POST /auth/google: a known identity logs in (200) without acceptedPolicies', async () => {
  reset();
  mockGoogle(googlePayload());
  const first = await call(google, { body: { idToken: 'tok', acceptedPolicies: true } });
  const again = await call(google, { body: { idToken: 'tok' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.isNewUser, false);
  assert.equal(again.body.linked, false);
  assert.equal(again.body.user.id, first.body.user.id);
  assert.equal(db.users.length, 1);
});

test('linking by verified email: same account, old password invalidated, linked: true', async () => {
  reset();
  const passwordHash = await hashPassword('old-password-1');
  db.users.push({ id: 'u-existing', name: 'Eve', email: 'g@example.com', passwordHash, passwordDisabledAt: null, phone: null, avatarUrl: null, theme: 'gold', weatherEnabled: true, aiConsentAt: null, createdAt: new Date() });
  mockGoogle(googlePayload());

  const linked = await call(google, { body: { idToken: 'tok' } });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.linked, true);
  assert.equal(linked.body.isNewUser, false);
  assert.equal(linked.body.user.id, 'u-existing');
  assert.equal(linked.body.user.hasPassword, false);
  assert.equal(db.users.length, 1);
  assert.equal(db.identities.length, 1);

  // The previous password no longer works.
  const attempt = await call(login, { body: { email: 'g@example.com', password: 'old-password-1' } });
  assert.equal(attempt.status, 401);
});

test('an unverified email never links to an existing account (409, nothing changes)', async () => {
  reset();
  const passwordHash = await hashPassword('old-password-1');
  db.users.push({ id: 'u-existing', name: 'Eve', email: 'g@example.com', passwordHash, passwordDisabledAt: null });
  mockGoogle(googlePayload({ email_verified: false }));
  const res = await call(google, { body: { idToken: 'tok', acceptedPolicies: true } });
  assert.equal(res.status, 409);
  assert.equal(db.identities.length, 0);
  assert.equal(db.users[0].passwordDisabledAt, null);
  assert.equal(db.users[0].passwordHash, passwordHash);
});

test('POST /auth/apple: new account uses fullName from the client; missing nonce or token is 400', async () => {
  reset();
  const { sign } = await appleSetup();
  const identityToken = await sign({ sub: 'apple-9', email: 'x@privaterelay.appleid.com', email_verified: 'true', nonce: sha256('nn') });

  assert.equal((await call(apple, { body: { identityToken } })).status, 400);
  assert.equal((await call(apple, { body: { nonce: 'nn' } })).status, 400);

  const res = await call(apple, { body: { identityToken, nonce: 'nn', fullName: { givenName: 'Ana', familyName: 'Pop' }, acceptedPolicies: true } });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.name, 'Ana Pop');
  assert.equal(res.body.isNewUser, true);

  const bad = await call(apple, { body: { identityToken, nonce: 'wrong', acceptedPolicies: true } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, social.VERIFY_FAILED);
});

test('apple: a later sign-in without email still finds the account through the identity', async () => {
  reset();
  const { sign } = await appleSetup();
  const first = await sign({ sub: 'apple-9', email: 'x@example.com', email_verified: true, nonce: sha256('n1') });
  await call(apple, { body: { identityToken: first, nonce: 'n1', acceptedPolicies: true } });
  const second = await sign({ sub: 'apple-9', nonce: sha256('n2') });
  const res = await call(apple, { body: { identityToken: second, nonce: 'n2' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'x@example.com');
});

// --- Password endpoints and account deletion ---------------------------------
async function socialUser() {
  mockGoogle(googlePayload());
  const res = await call(google, { body: { idToken: 'tok', acceptedPolicies: true } });
  return res.body.user.id;
}

test('changing the password on a social account is a clear 400', async () => {
  reset();
  const userId = await socialUser();
  const res = await call(changePassword, { userId, body: { currentPassword: 'whatever1', newPassword: 'new-password-1' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Apple or Google/);
});

test('GET /auth/me reports hasPassword (false for social, true for password accounts)', async () => {
  reset();
  db.users.push({ id: 'u-pw', name: 'P', email: 'p@example.com', passwordHash: 'x', passwordDisabledAt: null });
  // me() uses prisma select; the fake returns the whole row, which is enough to check the mapping.
  const pw = await call(me, { userId: 'u-pw' });
  assert.equal(pw.body.user.hasPassword, true);
  assert.ok(!('passwordDisabledAt' in pw.body.user));
  const socialId = await socialUser();
  const sc = await call(me, { userId: socialId });
  assert.equal(sc.body.user.hasPassword, false);
});

test('deleting a social account: requires a provider token that belongs to it, then removes data and photos', async () => {
  reset();
  const userId = await socialUser();

  const none = await call(deleteMe, { userId, body: {} });
  assert.equal(none.status, 400);
  assert.equal(db.users.length, 1);

  // A valid Google token for a different Google user must not delete this account.
  mockGoogle(googlePayload({ sub: 'someone-else', email: 'else@example.com' }));
  const foreign = await call(deleteMe, { userId, body: { googleIdToken: 'tok' } });
  assert.equal(foreign.status, 401);
  assert.equal(db.users.length, 1);

  // A password cannot be used on an account that has none.
  const pw = await call(deleteMe, { userId, body: { password: 'anything-1' } });
  assert.equal(pw.status, 400);

  mockGoogle(googlePayload());
  const ok = await call(deleteMe, { userId, body: { googleIdToken: 'tok' } });
  assert.equal(ok.status, 204);
  assert.equal(db.users.length, 0);
  assert.equal(db.identities.length, 0);
  assert.deepEqual(db.deletedImagesFor, [userId]);
});

test('deleting an Apple account works without Apple revocation configured (skipped, not fatal)', async () => {
  reset();
  const { sign } = await appleSetup();
  const idTok = await sign({ sub: 'apple-7', email: 'a7@example.com', email_verified: true, nonce: sha256('n1') });
  const created = await call(apple, { body: { identityToken: idTok, nonce: 'n1', acceptedPolicies: true } });
  const userId = created.body.user.id;

  const reauth = await sign({ sub: 'apple-7', nonce: sha256('n2') });
  const res = await call(deleteMe, { userId, body: { appleIdentityToken: reauth, nonce: 'n2', appleAuthorizationCode: 'code' } });
  assert.equal(res.status, 204);
  assert.equal(db.users.length, 0);
  assert.deepEqual(db.deletedImagesFor, [userId]);
});

test('password accounts still delete with their password, unchanged', async () => {
  reset();
  db.users.push({ id: 'u-pw', name: 'P', email: 'p@example.com', passwordHash: await hashPassword('correct-pass-1'), passwordDisabledAt: null });
  assert.equal((await call(deleteMe, { userId: 'u-pw', body: { password: 'nope-nope-1' } })).status, 401);
  assert.equal(db.users.length, 1);
  await call(deleteMe, { userId: 'u-pw', body: { password: 'correct-pass-1' } });
  assert.equal(db.users.length, 0);
});

test('regression: register and login keep the { user, token } shape', async () => {
  reset();
  const reg = await call(register, { body: { name: 'Pat', email: 'pat@example.com', password: 'long-enough-1', acceptedPolicies: true } });
  assert.equal(reg.status, 201);
  assert.deepEqual(Object.keys(reg.body).sort(), ['token', 'user']);
  const log = await call(login, { body: { email: 'pat@example.com', password: 'long-enough-1' } });
  assert.deepEqual(Object.keys(log.body).sort(), ['token', 'user']);
  assert.deepEqual(Object.keys(log.body.user).sort(), ['aiConsentAt', 'avatarUrl', 'createdAt', 'email', 'id', 'name', 'phone', 'theme', 'weatherEnabled']);
});

test('the revocation helper skips cleanly when Apple credentials are not configured', async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await social.revokeAppleAuthorization('code'), { revoked: false });
  } finally {
    console.warn = realWarn;
  }
});

// --- Security fixes H1 and H2 -------------------------------------------------
test('H1: a social account cannot change its email (400); a password account still can', async () => {
  reset();
  const userId = await socialUser();
  const blocked = await call(updateMe, { userId, body: { email: 'victim@example.com' } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Apple or Google/);
  assert.equal(db.users[0].email, 'g@example.com');
  // Other fields still work on a social account.
  assert.equal((await call(updateMe, { userId, body: { name: 'New Name' } })).body.user.name, 'New Name');

  db.users.push({ id: 'u-pw', name: 'P', email: 'p@example.com', passwordHash: 'x', passwordDisabledAt: null });
  const ok = await call(updateMe, { userId: 'u-pw', body: { email: 'P2@example.com' } });
  assert.equal(ok.body.user.email, 'p2@example.com');
  assert.equal(db.users.find((u) => u.id === 'u-pw').email, 'p2@example.com');
});

test('H1: an email that belongs to a social account is never linked to a second provider (409 use_original_provider)', async () => {
  reset();
  const attackerId = await socialUser(); // google sign-up for g@example.com
  db.users.find((u) => u.id === attackerId).email = 'victim@example.com'; // simulates the old email-change hole
  const before = db.identities.length;
  mockGoogle(googlePayload({ sub: 'victim-google', email: 'victim@example.com' }));
  const res = await call(google, { body: { idToken: 'tok', acceptedPolicies: true } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'use_original_provider');
  assert.equal(db.identities.length, before);
});

test('H2: linking a password account resets aiConsentAt so the owner is asked again', async () => {
  reset();
  db.users.push({ id: 'u-existing', name: 'Eve', email: 'g@example.com', passwordHash: await hashPassword('old-password-1'), passwordDisabledAt: null, aiConsentAt: new Date(), phone: null, avatarUrl: null, theme: 'gold', weatherEnabled: true, createdAt: new Date() });
  mockGoogle(googlePayload());
  const res = await call(google, { body: { idToken: 'tok' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.linked, true);
  assert.equal(res.body.user.aiConsentAt, null);
  assert.equal(db.users[0].aiConsentAt, null);
});
