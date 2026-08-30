const prisma = require('../config/db');

const RATINGS = ['up', 'down'];

// POST /api/feedback
// Body: { itemIds: string[], occasion: string, rating: 'up'|'down', rationale?: string, sessionId?: string }
//
// Writes to StylePreferenceSignal only — a table nothing else in the app
// reads from (see schema.prisma's comment on it). This is a one-way data
// collection endpoint, not a personalization feature: giving feedback
// here has zero effect on future generations today. That's a deliberate,
// separate decision for later, not an accidental side effect of this one.
async function createFeedback(req, res, next) {
  try {
    const { itemIds, occasion, rating, rationale, sessionId } = req.body;

    if (!RATINGS.includes(rating)) {
      return res.status(400).json({ error: `rating must be one of: ${RATINGS.join(', ')}` });
    }
    if (typeof occasion !== 'string' || !occasion.trim()) {
      return res.status(400).json({ error: 'occasion is required' });
    }
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' });
    }

    // Same ownership check pattern as saving an outfit — a signal
    // referencing items that aren't (or never were) actually the user's
    // is worthless as training data and a mild data-integrity risk.
    const owned = await prisma.clothingItem.findMany({
      where: { id: { in: itemIds }, userId: req.userId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));
    const missing = itemIds.filter((id) => !ownedIds.has(id));
    if (missing.length) {
      return res.status(400).json({ error: `Some items aren't in your wardrobe: ${missing.join(', ')}` });
    }

    if (sessionId !== undefined) {
      const session = await prisma.generationSession.findFirst({
        where: { id: sessionId, userId: req.userId },
        select: { id: true },
      });
      if (!session) return res.status(400).json({ error: 'sessionId does not belong to a session you own' });
    }

    const signal = await prisma.stylePreferenceSignal.create({
      data: {
        userId: req.userId,
        occasion: occasion.trim(),
        itemIds,
        rating,
        rationale: typeof rationale === 'string' ? rationale.trim().slice(0, 2000) : null,
        sessionId: sessionId || null,
      },
    });

    res.status(201).json({ signal: { id: signal.id, rating: signal.rating, createdAt: signal.createdAt } });
  } catch (err) {
    next(err);
  }
}

module.exports = { createFeedback };
