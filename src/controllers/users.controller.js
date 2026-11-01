const prisma = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/authUtils');
const { isValidEmail, isNonEmptyString, THEME_NAMES } = require('../utils/validators');
const { PUBLIC_USER_FIELDS } = require('./auth.controller');
const {
  isConfigured: cloudinaryConfigured, uploadImage, optimizeDeliveryUrl, deleteImageByUrl, deleteUserImages,
} = require('../config/cloudinary');
const { saveLocalFallback } = require('../config/upload');

// PATCH /api/users/me — Body: any subset of { name, email, phone, theme, weatherEnabled, aiConsent }
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
    // aiConsent: true records *when* the user agreed to send item photos /
    // wardrobe text / chat messages to the third-party AI provider; false
    // withdraws it. Stored as a timestamp (not a bare boolean) so there's a
    // record of when consent was given — see App Store guideline 5.1.2(i).
    if (req.body.aiConsent !== undefined) {
      if (typeof req.body.aiConsent !== 'boolean') return res.status(400).json({ error: 'aiConsent must be a boolean' });
      data.aiConsentAt = req.body.aiConsent ? new Date() : null;
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

    const previous = await prisma.user.findUnique({ where: { id: req.userId }, select: { avatarUrl: true } });
    const user = await prisma.user.update({ where: { id: req.userId }, data: { avatarUrl }, select: PUBLIC_USER_FIELDS });
    // The replaced picture shouldn't linger in image storage once nothing
    // points at it anymore.
    if (previous?.avatarUrl && previous.avatarUrl !== avatarUrl) await deleteImageByUrl(previous.avatarUrl, req.userId);
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
// delete, not archive" rule in 09_GHID_PRIVACY_SI_POLITICI.md. The photos
// live outside the database (Cloudinary), so they're removed explicitly
// right after: App Store guideline 5.1.1(v) requires deleting the account
// *and* the personal data tied to it, and a user's clothing/profile photos
// are exactly that.
async function deleteMe(req, res, next) {
  try {
    const { password } = req.body;
    if (!isNonEmptyString(password)) return res.status(400).json({ error: 'password is required to confirm account deletion' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    await prisma.user.delete({ where: { id: req.userId } });
    await deleteUserImages(req.userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { updateMe, uploadAvatar, changePassword, deleteMe };
