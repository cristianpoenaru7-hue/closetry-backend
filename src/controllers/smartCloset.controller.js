const prisma = require('../config/db');
const { analyzeWardrobeGaps, MIN_ITEMS_FOR_ANALYSIS } = require('../services/wardrobeGapAnalysis');
const { phraseGapFacts } = require('../services/smartCloset.service');
const { AnthropicConfigError } = require('../config/anthropic');

// GET /api/smart-closet
//
// 1. Recompute facts fresh from the live wardrobe every call (cheap,
//    deterministic — see wardrobeGapAnalysis.js).
// 2. Only ask the model to phrase facts whose `key` we haven't seen
//    before — an unchanged gap (e.g. still no formal shoes) doesn't get
//    re-phrased and re-billed on every screen view.
// 3. Any previously-stored insight whose key ISN'T in the current facts
//    anymore means the gap resolved (user added the missing item) — its
//    row is deleted rather than left stale.
// 4. If phrasing fails (no ANTHROPIC_API_KEY, network error), fall back
//    to the deterministic `fact` string as-is — Smart Closet still works,
//    just with plainer wording, never a hard failure.
async function getSmartCloset(req, res, next) {
  try {
    const items = await prisma.clothingItem.findMany({ where: { userId: req.userId, archived: false } });
    const facts = analyzeWardrobeGaps(items);

    if (!facts.length) {
      const note = items.length < MIN_ITEMS_FOR_ANALYSIS
        ? 'Add a few more items and Smart Closet will start surfacing gaps in your wardrobe.'
        : 'Your wardrobe looks reasonably balanced — no gaps detected right now.';
      // Nothing current — also clean up any stale rows from before.
      await prisma.recommendation.deleteMany({ where: { userId: req.userId, type: 'gap_analysis' } });
      return res.json({ insights: [], note });
    }

    const currentKeys = facts.map((f) => f.key);
    const existingRows = await prisma.recommendation.findMany({
      where: { userId: req.userId, type: 'gap_analysis' },
    });
    const existingByKey = new Map(existingRows.map((r) => [r.key, r]));

    const staleRowIds = existingRows.filter((r) => !currentKeys.includes(r.key)).map((r) => r.id);
    if (staleRowIds.length) {
      await prisma.recommendation.deleteMany({ where: { id: { in: staleRowIds } } });
    }

    const newFacts = facts.filter((f) => !existingByKey.has(f.key));
    let phrasedByKey = new Map();
    if (newFacts.length) {
      try {
        phrasedByKey = await phraseGapFacts(newFacts);
      } catch (err) {
        if (!(err instanceof AnthropicConfigError)) throw err;
        // else: proceed with deterministic fallback text below
      }
    }

    const createdRows = [];
    for (const fact of newFacts) {
      const text = phrasedByKey.get(fact.key) || fact.fact;
      const row = await prisma.recommendation.create({
        data: { userId: req.userId, type: 'gap_analysis', key: fact.key, payload: { text, ...fact } },
      });
      createdRows.push(row);
    }

    const unchangedRows = existingRows.filter((r) => currentKeys.includes(r.key));
    const allCurrentRows = [...unchangedRows, ...createdRows];
    const visible = allCurrentRows.filter((r) => !r.dismissedAt);

    res.json({
      insights: visible.map((r) => ({ id: r.id, ...r.payload, createdAt: r.createdAt })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/smart-closet/:id/dismiss — hides an insight from future
// responses. It stays dismissed even if the underlying gap is still
// present; it only reappears if the gap fully resolves and re-occurs
// later (new row, new id, since the old one was deleted as stale).
async function dismissInsight(req, res, next) {
  try {
    const existing = await prisma.recommendation.findFirst({
      where: { id: req.params.id, userId: req.userId, type: 'gap_analysis' },
    });
    if (!existing) return res.status(404).json({ error: 'Insight not found' });

    await prisma.recommendation.update({ where: { id: existing.id }, data: { dismissedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { getSmartCloset, dismissInsight };
