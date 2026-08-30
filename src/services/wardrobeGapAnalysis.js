// Deterministic aggregation/counting — per 03-ai-integration.md: "the
// underlying gap must be computed from real counts, not inferred by the
// model." Every function here is pure (items in, facts out) and gets
// tested directly; the AI layer (smartCloset.service.js) only ever
// rephrases the `fact` string these produce, never decides what's true.

const CORE_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes'];
const CASUAL_SHOE_SUBCATS = ['sneakers', 'sandals', 'flip-flops'];
const FORMAL_SHOE_SUBCATS = ['heels', 'loafers', 'flats'];
const SEASON_SPECIFIC = ['spring', 'summer', 'fall', 'winter'];

// Minimum wardrobe size before gap analysis runs at all — below this,
// any "gap" is just "you haven't added much yet", not a useful insight.
const MIN_ITEMS_FOR_ANALYSIS = 5;
// Minimum wardrobe size before season-coverage gaps are worth flagging —
// a 6-item wardrobe missing "winter" isn't news; it's just small.
const MIN_ITEMS_FOR_SEASON_CHECK = 8;

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] || 0) + 1;
  return counts;
}

// Flags a lopsided wardrobe: one core category has plenty, another core
// category has almost nothing. Threshold is intentionally blunt (round
// numbers, not tuned against real data yet — see file header).
function checkCategoryImbalance(items) {
  const counts = Object.fromEntries(CORE_CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length]));
  const entries = Object.entries(counts);
  const [dominantCategory, dominantCount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const [weakCategory, weakCount] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));

  if (dominantCount >= 4 && weakCount <= 1 && dominantCount - weakCount >= 3) {
    return [{
      key: `gap:category:${weakCategory}`,
      kind: 'category_imbalance',
      fact: `You own ${dominantCount} ${dominantCategory} pieces but only ${weakCount} ${weakCategory} piece${weakCount === 1 ? '' : 's'}.`,
      dominantCategory, dominantCount, weakCategory, weakCount,
    }];
  }
  return [];
}

// The literal example from 03-ai-integration.md / 12_ARHITECTURA...md:
// plenty of casual shoes, zero formal ones. Also estimates how many
// existing top+bottom pairs (or dresses) a new formal shoe could
// complete — a rough combinatorial value, not a real recommendation
// (Smart Closet never suggests what to buy, see the hard boundary).
function checkShoeFormalityGap(items) {
  const shoes = items.filter((i) => i.category === 'shoes');
  const casualCount = shoes.filter((i) => CASUAL_SHOE_SUBCATS.includes(i.subcategory)).length;
  const formalCount = shoes.filter((i) => FORMAL_SHOE_SUBCATS.includes(i.subcategory)).length;

  if (casualCount >= 3 && formalCount === 0) {
    const topCount = items.filter((i) => i.category === 'top').length;
    const bottomCount = items.filter((i) => i.category === 'bottom').length;
    const dressCount = items.filter((i) => i.category === 'dress').length;
    const unlockEstimate = topCount * bottomCount + dressCount;

    return [{
      key: 'gap:shoes:formal',
      kind: 'shoe_formality_gap',
      fact: `You own ${casualCount} casual shoe${casualCount === 1 ? '' : 's'} but no formal shoes (heels, loafers, or flats).`,
      casualCount, formalCount, unlockEstimate,
    }];
  }
  return [];
}

// Flags a season with zero season-specific items — 'all'-season items
// don't count toward any one season, so this only fires on a genuine gap,
// not just "most of my stuff is season-agnostic".
function checkSeasonCoverage(items) {
  if (items.length < MIN_ITEMS_FOR_SEASON_CHECK) return [];
  const counts = countBy(items, 'season');
  return SEASON_SPECIFIC
    .filter((season) => !counts[season])
    .map((season) => ({
      key: `gap:season:${season}`,
      kind: 'season_gap',
      fact: `You have no items specifically tagged for ${season}.`,
      season,
    }));
}

// Entry point: runs every rule, returns the combined fact list. Order is
// stable (category → shoes → season) so `key` order stays predictable,
// though callers should treat the array as unordered.
function analyzeWardrobeGaps(items) {
  if (items.length < MIN_ITEMS_FOR_ANALYSIS) return [];
  return [
    ...checkCategoryImbalance(items),
    ...checkShoeFormalityGap(items),
    ...checkSeasonCoverage(items),
  ];
}

module.exports = {
  analyzeWardrobeGaps, checkCategoryImbalance, checkShoeFormalityGap, checkSeasonCoverage,
  MIN_ITEMS_FOR_ANALYSIS, MIN_ITEMS_FOR_SEASON_CHECK,
};
