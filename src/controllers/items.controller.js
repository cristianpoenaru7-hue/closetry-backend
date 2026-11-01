const prisma = require('../config/db');
const { validateItemInput } = require('../utils/validators');
const { isConfigured: cloudinaryConfigured, uploadImage, optimizeDeliveryUrl, deleteImageByUrl } = require('../config/cloudinary');
const { removeBackground } = require('../config/backgroundRemoval');
const { saveLocalFallback } = require('../config/upload');
const { classifyItemPhoto } = require('../services/classification.service');
const { sendUnavailable } = require('../utils/unavailable');
const { AnthropicConfigError } = require('../config/anthropic');

// POST /api/items/classify (multipart/form-data, field "photo")
//
// Vision classification (Phase 4 auto-tagging, see 03-ai-integration.md).
// Returns a *suggestion* only — nothing here writes to the database. The
// client shows it as editable, pre-filled fields; the actual save still
// goes through POST /api/items (or PATCH to edit), same as manual entry.
async function classifyItem(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo is required' });

    const { suggestion, note } = await classifyItemPhoto(req.file.buffer, req.file.mimetype);
    res.json({ suggestion, note });
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return sendUnavailable(res, err);
    }
    // Auto-tagging is only ever a convenience — the client falls back to
    // manual entry on any failure — so an upstream hiccup (rate limit,
    // overload, a photo the model rejects) becomes a plain, user-readable
    // note instead of a server error carrying the provider's raw response.
    console.error('Item classification failed:', err);
    res.status(502).json({ error: "Couldn't identify this item automatically — enter its details below." });
  }
}

// GET /api/items?category=top&color=black&material=wool&season=fall&archived=false
async function listItems(req, res, next) {
  try {
    const { category, color, material, season, archived, tag, favorite } = req.query;

    const where = {
      userId: req.userId,
      archived: archived === undefined ? false : archived === 'true',
      ...(category && { category }),
      ...(color && { color }),
      ...(material && { material }),
      ...(season && { season }),
      ...(tag && { tags: { has: tag } }),
      ...(favorite === 'true' && { isFavorite: true }),
    };

    const items = await prisma.clothingItem.findMany({
      where,
      orderBy: { dateAdded: 'desc' },
    });

    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
}

async function getItem(req, res, next) {
  try {
    const item = await prisma.clothingItem.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

// POST /api/items  (multipart/form-data if a photo file is attached)
async function createItem(req, res, next) {
  try {
    const errors = validateItemInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { category, subcategory, color, material, season, brand } = req.body;
    let tags = req.body.tags;
    if (typeof tags === 'string') {
      // multipart/form-data sends arrays as repeated fields or JSON strings
      try { tags = JSON.parse(tags); } catch { tags = tags.split(',').map((t) => t.trim()).filter(Boolean); }
    }

    const imageUrl = req.file
      ? await resolveUploadedImageUrl(req.file, req.userId)
      : (req.body.imageUrl || null);

    const item = await prisma.clothingItem.create({
      data: {
        userId: req.userId,
        imageUrl,
        category,
        subcategory,
        color,
        material,
        season,
        brand: brand || null,
        tags: Array.isArray(tags) ? tags : [],
      },
    });

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

// Background removal happens locally first (own infra, no external API).
// Storage is separate: Cloudinary if configured, otherwise local disk —
// same fallback pattern as before, just no longer coupled to the removal
// step itself.
async function resolveUploadedImageUrl(file, userId) {
  let buffer = file.buffer;
  let filename = file.originalname;

  try {
    buffer = await removeBackground(buffer, filename, file.mimetype);
    filename = (filename || 'photo').replace(/\.[^.]+$/, '') + '.png';
  } catch (err) {
    console.warn(
      `Background removal failed (${err.message}) — saving the original photo instead. ` +
      'Is bg-removal-service running? See its README.'
    );
  }

  if (cloudinaryConfigured) {
    const result = await uploadImage(buffer, { userId });
    return optimizeDeliveryUrl(result.secure_url);
  }
  return saveLocalFallback(buffer, filename, userId);
}

// PATCH /api/items/:id — partial update; user always edits/confirms AI
// tagging suggestions through this same endpoint (see 03-ai-integration.md:
// auto-tagging is never silently auto-applied).
async function updateItem(req, res, next) {
  try {
    const errors = validateItemInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const existing = await prisma.clothingItem.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const allowedFields = [
      'category', 'subcategory', 'color', 'material', 'season',
      'brand', 'tags', 'archived', 'lastWornAt', 'imageUrl', 'isFavorite',
    ];
    const data = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }

    const item = await prisma.clothingItem.update({
      where: { id: req.params.id },
      data,
    });

    // A replaced photo shouldn't linger in image storage once nothing of
    // this user's points at it (same pattern as the avatar). deleteImageByUrl
    // only ever deletes inside the user's own folder.
    if (existing.imageUrl && data.imageUrl !== undefined && data.imageUrl !== existing.imageUrl) {
      const stillUsed = await prisma.clothingItem.count({ where: { userId: req.userId, imageUrl: existing.imageUrl } });
      if (!stillUsed) await deleteImageByUrl(existing.imageUrl, req.userId);
    }

    res.json({ item });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/items/:id — real delete (not archive) per privacy guide:
// user must be able to actually remove a photo, not just hide it.
// Use PATCH { archived: true } for soft-archive instead.
async function deleteItem(req, res, next) {
  try {
    const existing = await prisma.clothingItem.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    await prisma.clothingItem.delete({ where: { id: req.params.id } });

    // "Real delete" has to include the photo itself, not just its database
    // row — otherwise the image stays reachable at its public URL forever.
    // Skipped if another item of the same user still points at the same URL.
    if (existing.imageUrl) {
      const stillUsed = await prisma.clothingItem.count({ where: { userId: req.userId, imageUrl: existing.imageUrl } });
      if (!stillUsed) await deleteImageByUrl(existing.imageUrl, req.userId);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listItems, getItem, createItem, updateItem, deleteItem, classifyItem };
