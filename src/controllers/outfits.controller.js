const prisma = require('../config/db');
const { checkSeason } = require('../services/outfitValidity');

const SEASONS = ['spring', 'summer', 'fall', 'winter', 'all'];

// Outfit only stores itemIds[] (see 02-data-model.md) — every response
// here hydrates a full `items` array by joining against the user's own
// ClothingItem rows, so the client never has to do a second round-trip
// (or worse, guess) to render thumbnails. If an item was since deleted,
// it's silently dropped from `items` (itemIds keeps the original id) —
// the outfit itself is still a valid historical record.
async function hydrateOutfits(outfits, userId) {
  const allIds = [...new Set(outfits.flatMap((o) => o.itemIds))];
  if (!allIds.length) return outfits.map((o) => ({ ...o, items: [] }));

  const items = await prisma.clothingItem.findMany({
    where: { id: { in: allIds }, userId },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  return outfits.map((o) => ({
    ...o,
    items: o.itemIds.map((id) => byId.get(id)).filter(Boolean),
  }));
}

// POST /api/outfits — "Save this look" from the Generate chat, or from an
// Event's "Generate outfit for this event" (which passes eventId so the
// outfit can be filtered/found by event later).
// Body: { occasion: string, itemIds: string[], name?: string, eventId?: string }
async function createOutfit(req, res, next) {
  try {
    const { occasion, itemIds, name, eventId } = req.body;

    if (typeof occasion !== 'string' || !occasion.trim()) {
      return res.status(400).json({ error: 'occasion is required' });
    }
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' });
    }

    // Re-verify ownership at save time too — don't trust itemIds blindly
    // just because they came from a generation response earlier in the
    // session (items could've been deleted/archived since, or the client
    // payload could be wrong/tampered).
    const owned = await prisma.clothingItem.findMany({
      where: { id: { in: itemIds }, userId: req.userId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));
    const missing = itemIds.filter((id) => !ownedIds.has(id));
    if (missing.length) {
      return res.status(400).json({ error: `Some items are no longer in your wardrobe: ${missing.join(', ')}` });
    }

    if (eventId !== undefined && eventId !== null) {
      const event = await prisma.event.findFirst({ where: { id: eventId, userId: req.userId }, select: { id: true } });
      if (!event) return res.status(400).json({ error: 'eventId does not belong to an event you own' });
    }

    const outfit = await prisma.outfit.create({
      data: {
        userId: req.userId,
        occasion: occasion.trim(),
        name: name?.trim() || null,
        itemIds,
        eventId: eventId || null,
      },
    });

    const [hydrated] = await hydrateOutfits([outfit], req.userId);
    res.status(201).json({ outfit: hydrated });
  } catch (err) {
    next(err);
  }
}

// GET /api/outfits?occasion=&name=&favorite=true&season=&eventId= — newest
// first. `occasion` and `name` are both case-insensitive partial matches
// (free text, not enums). `eventId` filters to outfits generated for a
// specific event. Outfit has no `season` field of its own (see
// 02-data-model.md), so `season` is *derived*: an outfit "matches" a
// season if every one of its hydrated items is season-compatible with it
// (item.season === 'all' or equal to the filter) — the exact same rule
// generation's deterministic validity layer uses (`checkSeason`), just
// reused here for filtering instead of rejecting. This has to run after
// hydration (in JS), not in the Prisma `where`, since it depends on
// joined item data, not a column on Outfit itself.
async function listOutfits(req, res, next) {
  try {
    const { occasion, name, favorite, season, eventId } = req.query;
    if (season !== undefined && !SEASONS.includes(season)) {
      return res.status(400).json({ error: `season must be one of: ${SEASONS.join(', ')}` });
    }

    const where = {
      userId: req.userId,
      ...(occasion && { occasion: { contains: occasion, mode: 'insensitive' } }),
      ...(name && { name: { contains: name, mode: 'insensitive' } }),
      ...(favorite === 'true' && { isFavorite: true }),
      ...(eventId && { eventId }),
    };

    const outfits = await prisma.outfit.findMany({ where, orderBy: { createdAt: 'desc' } });
    let hydrated = await hydrateOutfits(outfits, req.userId);

    if (season && season !== 'all') {
      hydrated = hydrated.filter((o) => checkSeason(o.items, season).valid);
    }

    res.json({ outfits: hydrated, count: hydrated.length });
  } catch (err) {
    next(err);
  }
}

// GET /api/outfits/:id
async function getOutfit(req, res, next) {
  try {
    const outfit = await prisma.outfit.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    const [hydrated] = await hydrateOutfits([outfit], req.userId);
    res.json({ outfit: hydrated });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/outfits/:id — rename and/or toggle favorite. itemIds/occasion
// are intentionally not editable here (re-save from Generate for that) to
// keep this endpoint's contract small and predictable.
async function updateOutfit(req, res, next) {
  try {
    const existing = await prisma.outfit.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Outfit not found' });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name === null ? null : String(req.body.name).trim() || null;
    if (req.body.isFavorite !== undefined) data.isFavorite = !!req.body.isFavorite;

    const outfit = await prisma.outfit.update({ where: { id: existing.id }, data });
    const [hydrated] = await hydrateOutfits([outfit], req.userId);
    res.json({ outfit: hydrated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/outfits/:id — real delete, consistent with items (see
// 09_GHID_PRIVACY_SI_POLITICI.md); there's no soft-archive concept for
// outfits in the data model.
async function deleteOutfit(req, res, next) {
  try {
    const existing = await prisma.outfit.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Outfit not found' });

    await prisma.outfit.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// POST /api/outfits/:id/worn — logs a wear. Body: { date? } (ISO string;
// defaults to now). Appends rather than replaces, since wornDates is a
// running log, not a single value.
async function logWorn(req, res, next) {
  try {
    const existing = await prisma.outfit.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Outfit not found' });

    let wornDate = new Date();
    if (req.body.date !== undefined) {
      wornDate = new Date(req.body.date);
      if (Number.isNaN(wornDate.getTime())) return res.status(400).json({ error: 'date must be a valid date' });
    }

    const outfit = await prisma.outfit.update({
      where: { id: existing.id },
      data: { wornDates: { push: wornDate } },
    });
    const [hydrated] = await hydrateOutfits([outfit], req.userId);
    res.json({ outfit: hydrated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createOutfit, listOutfits, getOutfit, updateOutfit, deleteOutfit, logWorn };
