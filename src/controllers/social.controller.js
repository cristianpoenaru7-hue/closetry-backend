const crypto = require('node:crypto');
const prisma = require('../config/db');
const { hashPassword, signToken } = require('../utils/authUtils');
const { PUBLIC_USER_FIELDS } = require('./auth.controller');
// Called through the module object (not destructured) so tests can swap the verifiers.
const socialAuth = require('../services/socialAuth.service');

const POLICIES_REQUIRED = 'You need to accept the Privacy Policy and Terms of Use to create an account.';

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.clientCode = code;
  return err;
}

// Same fields as every other user response, plus the optional hasPassword.
function toPublicUser(user) {
  const out = {};
  for (const key of Object.keys(PUBLIC_USER_FIELDS)) out[key] = user[key];
  out.hasPassword = user.passwordDisabledAt == null;
  return out;
}

// Apple sends the name only on the first authorization, as a string or as
// { givenName, familyName }. Google puts it in the token. Fall back to the
// local part of the email, then a fixed label (name is required).
function pickName(fullName, tokenName, email) {
  let candidate = null;
  if (typeof fullName === 'string') candidate = fullName;
  else if (fullName && typeof fullName === 'object') {
    candidate = [fullName.givenName, fullName.familyName].filter((p) => typeof p === 'string' && p.trim()).join(' ');
  }
  if (!candidate || !candidate.trim()) candidate = tokenName;
  if (!candidate || !candidate.trim()) candidate = email ? email.split('@')[0] : '';
  candidate = (candidate || '').trim().slice(0, 100);
  return candidate || 'Closetry user';
}

async function randomPasswordHash() {
  // 32 random bytes, hashed and immediately forgotten: nobody can log in with it.
  return hashPassword(crypto.randomBytes(32).toString('hex'));
}

// Shared by POST /auth/apple and /auth/google once the token is verified.
// 1) known identity -> log in. 2) verified email matches an account -> link
// (the old password is invalidated, decision (a)). 3) otherwise a new account.
async function completeSocialLogin(res, verified, body) {
  const { provider, sub, email, emailVerified } = verified;

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: sub } },
    include: { user: true },
  });
  if (identity) {
    const token = signToken(identity.user);
    return res.status(200).json({ user: toPublicUser(identity.user), token, isNewUser: false, linked: false });
  }

  const existing = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (existing) {
    if (existing.passwordDisabledAt != null) {
      // The account already belongs to a social sign-in. Never attach a second
      // provider by email: the email on such an account is not proof of ownership.
      const err = new Error('This email is already used by an account that signs in with Apple or Google. Sign in the way you did before.');
      err.status = 409;
      err.clientCode = 'use_original_provider';
      throw err;
    }
    if (!emailVerified) {
      // Unverified email: never attach to someone else's account, and the email is taken.
      const err = new Error('An account with this email already exists. Please sign in with your password.');
      err.status = 409;
      throw err;
    }
    const ops = [prisma.authIdentity.create({ data: { userId: existing.id, provider, providerUserId: sub, email } })];
    // Anyone could have registered this email without proving they own it, so
    // the old password stops working the moment the real owner links a provider.
    // AI consent given by whoever pre-created the account is not the owner's
    // consent (NN-5): reset it so the app asks again.
    ops.push(prisma.user.update({
      where: { id: existing.id },
      data: { passwordDisabledAt: new Date(), passwordHash: await randomPasswordHash(), aiConsentAt: null },
    }));
    await prisma.$transaction(ops);
    const user = await prisma.user.findUnique({ where: { id: existing.id } });
    const token = signToken(user);
    return res.status(200).json({ user: toPublicUser(user), token, isNewUser: false, linked: true });
  }

  if (body.acceptedPolicies !== true) throw badRequest(POLICIES_REQUIRED, 'policies_required');
  if (!email) throw badRequest('Your account did not share an email address, so we cannot create a Closetry account from it.', 'email_unavailable');

  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: pickName(body.fullName, verified.name, email),
      email,
      passwordHash: await randomPasswordHash(),
      passwordDisabledAt: now,
      acceptedPoliciesAt: now,
      identities: { create: { provider, providerUserId: sub, email } },
    },
  });
  const token = signToken(user);
  return res.status(201).json({ user: toPublicUser(user), token, isNewUser: true, linked: false });
}

// POST /api/auth/apple — Body: { identityToken, nonce, fullName?, acceptedPolicies? }
async function apple(req, res, next) {
  try {
    const { identityToken, nonce } = req.body || {};
    if (typeof identityToken !== 'string' || !identityToken) throw badRequest('identityToken is required');
    if (typeof nonce !== 'string' || !nonce) throw badRequest('nonce is required');
    const verified = await socialAuth.verifyAppleIdentityToken(identityToken, { nonce });
    await completeSocialLogin(res, verified, req.body);
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/google — Body: { idToken, nonce?, acceptedPolicies? }
async function google(req, res, next) {
  try {
    const { idToken, nonce } = req.body || {};
    if (typeof idToken !== 'string' || !idToken) throw badRequest('idToken is required');
    const verified = await socialAuth.verifyGoogleIdToken(idToken, { nonce: typeof nonce === 'string' ? nonce : undefined });
    await completeSocialLogin(res, verified, req.body);
  } catch (err) {
    next(err);
  }
}

module.exports = { apple, google, toPublicUser };
