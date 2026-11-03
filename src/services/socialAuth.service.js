// Verifies Sign in with Apple / Google tokens and (optionally) revokes the
// Apple authorization when an account is deleted.
//
// Nothing here logs a token, an email or a name: failures are logged by
// provider and error class only (logs hold no personal content).
const crypto = require('node:crypto');
const { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } = require('jose');
const { OAuth2Client } = require('google-auth-library');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const DEFAULT_APPLE_BUNDLE_ID = 'com.cristianpoenaru.closetry'; // not a secret
const VERIFY_FAILED = 'Could not verify your sign-in. Please try again.';

function verifyFailed(provider, cause) {
  console.warn(`[social-auth] ${provider} token rejected (${cause?.code || cause?.name || 'invalid'})`);
  const err = new Error(VERIFY_FAILED);
  err.status = 401;
  return err;
}

function notConfigured(provider) {
  console.warn(`[social-auth] ${provider} sign-in is not configured on this server`);
  const err = new Error(`${provider} sign-in is not configured`);
  err.status = 503; // becomes the generic message via errorHandler
  return err;
}

// --- Apple ----------------------------------------------------------------

let appleKeys = null; // injectable for tests (any jose key or key-resolver function)
function getAppleKeys() {
  if (!appleKeys) appleKeys = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return appleKeys;
}

function appleBundleId() {
  return (process.env.APPLE_BUNDLE_ID || DEFAULT_APPLE_BUNDLE_ID).trim();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkAge(payload, maxAgeSeconds) {
  if (!maxAgeSeconds) return true;
  return typeof payload.iat === 'number' && Date.now() / 1000 - payload.iat <= maxAgeSeconds;
}

// The client sends Apple the SHA-256 (hex) of a random raw nonce and sends us
// the raw nonce; Apple puts what it was given into the token's `nonce` claim.
// Only the hash of the raw nonce is accepted (never the raw value itself).
async function verifyAppleIdentityToken(identityToken, { nonce, maxAgeSeconds } = {}) {
  if (typeof identityToken !== 'string' || !identityToken || typeof nonce !== 'string' || !nonce) {
    throw verifyFailed('apple', { name: 'missing_input' });
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, getAppleKeys(), {
      issuer: APPLE_ISSUER,
      audience: appleBundleId(),
      algorithms: ['RS256', 'ES256'],
    }));
  } catch (err) {
    // Failing to fetch Apple's keys is an outage on our/Apple's side, not a bad token: surface it as a 5xx.
    if (err?.code === 'ERR_JWKS_TIMEOUT' || err?.name === 'TypeError') throw err;
    throw verifyFailed('apple', err);
  }
  if (!payload.nonce || !safeEqual(payload.nonce, sha256Hex(nonce))) {
    throw verifyFailed('apple', { name: 'nonce_mismatch' });
  }
  if (!checkAge(payload, maxAgeSeconds)) throw verifyFailed('apple', { name: 'token_too_old' });
  if (!payload.sub) throw verifyFailed('apple', { name: 'no_sub' });
  return {
    provider: 'apple',
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: null, // Apple never puts the name in the token; the client sends it once as fullName
  };
}

// Best effort: Apple requires the Sign in with Apple token to be revoked when
// the account is deleted. Needs APPLE_TEAM_ID, APPLE_KEY_ID and
// APPLE_SIGN_IN_PRIVATE_KEY; if any is missing, or no authorizationCode was
// sent, it is skipped (logged) and the account deletion carries on.
async function revokeAppleAuthorization(authorizationCode) {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const rawKey = process.env.APPLE_SIGN_IN_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey || typeof authorizationCode !== 'string' || !authorizationCode) {
    console.warn('[social-auth] Apple revocation skipped (not configured or no authorization code)');
    return { revoked: false };
  }
  try {
    const key = await importPKCS8(rawKey.replace(/\\n/g, '\n'), 'ES256');
    const clientId = appleBundleId();
    const clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setSubject(clientId)
      .setAudience(APPLE_ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

    const post = async (path, params) => {
      const res = await fetch(`${APPLE_ISSUER}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw Object.assign(new Error(`apple ${path} ${res.status}`), { name: `HttpStatus${res.status}` });
      return res;
    };

    const tokenRes = await post('/auth/token', { code: authorizationCode, grant_type: 'authorization_code' });
    const { refresh_token: refreshToken } = await tokenRes.json();
    if (!refreshToken) throw Object.assign(new Error('no refresh token'), { name: 'NoRefreshToken' });
    await post('/auth/revoke', { token: refreshToken, token_type_hint: 'refresh_token' });
    return { revoked: true };
  } catch (err) {
    console.warn(`[social-auth] Apple revocation failed (${err?.name || 'Error'})`);
    return { revoked: false };
  }
}

// --- Google ---------------------------------------------------------------

let googleClient = null; // one reused client (it caches Google's signing certs)
let googleClientFactory = () => (googleClient ||= new OAuth2Client()); // injectable for tests

function googleAudiences() {
  return [process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_WEB_CLIENT_ID]
    .map((v) => (v || '').trim())
    .filter(Boolean);
}

async function verifyGoogleIdToken(idToken, { nonce, maxAgeSeconds } = {}) {
  const audience = googleAudiences();
  if (!audience.length) throw notConfigured('Google');
  if (typeof idToken !== 'string' || !idToken) throw verifyFailed('google', { name: 'missing_input' });

  let payload;
  try {
    const ticket = await googleClientFactory().verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    throw verifyFailed('google', err);
  }
  if (!payload || !payload.sub || !GOOGLE_ISSUERS.includes(payload.iss)) throw verifyFailed('google', { name: 'bad_payload' });
  if (nonce && (!payload.nonce || !safeEqual(payload.nonce, nonce))) throw verifyFailed('google', { name: 'nonce_mismatch' });
  if (!checkAge(payload, maxAgeSeconds)) throw verifyFailed('google', { name: 'token_too_old' });
  return {
    provider: 'google',
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

module.exports = {
  VERIFY_FAILED,
  verifyAppleIdentityToken,
  verifyGoogleIdToken,
  revokeAppleAuthorization,
  // test hooks
  __setAppleKeys(keys) { appleKeys = keys; },
  __setGoogleClientFactory(fn) { googleClientFactory = fn; },
};
