const prisma = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/authUtils');
const { isValidEmail, isNonEmptyString, THEME_NAMES } = require('../utils/validators');
const { PUBLIC_USER_FIELDS } = require('./auth.controller');
const { isConfigured: cloudinaryConfigured, uploadImage, optimizeDeliveryUrl } = require('../config/cloudinary');
const { saveLocalFallback } = require('../config/upload');

// PATCH /api/users/me — Body: any subset of { name, email, phone, theme, weatherEnabled }
// avatarUrl is deliberately NOT settable here — it only ever comes from
// POST /api/users/me/avatar, which controls what gets uploaded/stored,
// rather than letting a client set an arbitrary URL string.
async function updateMe(req, res, next) {
  try {
    const data = {};
    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name)) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = req.body.name.trim();
    }
    if (req.body.email !== undefined) {
      if (!isValidEmail(req.body.email)) return res.status(400).json({ error: 'a valid email is required' });
      data.email = req.body.email.toLowerCase().trim();
    }
    if (req.body.phone !== undefined) {
      data.phone = req.body.phone === null ? null : String(req.body.phone).trim() || null;
    }
    if (req.body.theme !== undefined) {
      if (!THEME_NAMES.includes(req.body.theme)) return res.status(400).json({ error: `theme must be one of: ${THEME_NAMES.join(', ')}` });
      data.theme = req.body.theme;
    }
    if (req.body.weatherEnabled !== undefined) {
      if (typeof req.body.weatherEnabled !== 'boolean') return res.status(400).json({ error: 'weatherEnabled must be a boolean' });
      data.weatherEnabled = req.body.weatherEnabled;
    }

    const user = await prisma.user.update({ where: { id: req.userId }, data, select: PUBLIC_USER_FIELDS });
    res.json({ user });
  } catch (err) {
    next(err); // P2002 (duplicate email) is already handled generically in errorHandler
  }
}

// POST /api/users/me/avatar (multipart/form-data, field "photo")
//
// Deliberately simpler than item photo upload: no background removal
// (that's a wardrobe-item-specific step, not appropriate for a face
// photo), just upload-and-store, same Cloudinary/local-fallback pattern.
async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo is required' });

    let avatarUrl;
    if (cloudinaryConfigured) {
      const result = await uploadImage(req.file.buffer, { userId: req.userId });
      avatarUrl = optimizeDeliveryUrl(result.secure_url, { width: 400 }); // avatars are always small — no need for the 1200px item-photo default
    } else {
      avatarUrl = await saveLocalFallback(req.file.buffer, req.file.originalname, req.userId);
    }

    const user = await prisma.user.update({ where: { id: req.userId }, data: { avatarUrl }, select: PUBLIC_USER_FIELDS });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

// POST /api/users/me/password — Body: { currentPassword, newPassword }
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
    }
    if (!isNonEmptyString(currentPassword)) {
      return res.status(400).json({ error: 'currentPassword is required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.userId }, data: { passwordHash } });
    res.json({ changed: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/users/me — Body: { password } required as a confirmation
// step (not just the bearer token) before a destructive, irreversible
// action. Every other table cascades from User via onDelete: Cascade in
// the schema, so this one delete removes everything — items, outfits,
// sessions, events, feedback signals, recommendations — per the "real
// delete, not archive" rule in 09_GHID_PRIVACY_SI_POLITICI.md.
async function deleteMe(req, res, next) {
  try {
    const { password } = req.body;
    if (!isNonEmptyString(password)) return res.status(400).json({ error: 'password is required to confirm account deletion' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    await prisma.user.delete({ where: { id: req.userId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { updateMe, uploadAvatar, changePassword, deleteMe };
