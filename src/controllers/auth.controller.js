const prisma = require('../config/db');
const { hashPassword, verifyPassword, signToken } = require('../utils/authUtils');
const { validateRegisterInput, validateLoginInput } = require('../utils/validators');

// Shared shape for every endpoint that returns a user — keeps
// register/login/me consistent so the client never has to guess which
// fields a given response includes.
const PUBLIC_USER_FIELDS = { id: true, name: true, email: true, phone: true, avatarUrl: true, theme: true, weatherEnabled: true, aiConsentAt: true, createdAt: true };

async function register(req, res, next) {
  try {
    const errors = validateRegisterInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { name, email, password } = req.body;
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        acceptedPoliciesAt: new Date(),
      },
      select: PUBLIC_USER_FIELDS,
    });

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const errors = validateLoginInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    // Same error for "no such user" and "wrong password" — don't leak which one.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, phone: user.phone,
        avatarUrl: user.avatarUrl, theme: user.theme, weatherEnabled: user.weatherEnabled, aiConsentAt: user.aiConsentAt, createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { ...PUBLIC_USER_FIELDS, stylePreferences: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, PUBLIC_USER_FIELDS };
