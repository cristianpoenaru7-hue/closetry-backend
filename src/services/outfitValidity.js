// Deterministic validity layer for generated outfits — code, not AI
// judgment, per 03-ai-integration.md and 05-tech-stack-and-constraints.md.
// The LLM proposes combinations; everything here re-checks them before
// they're shown to the user. An outfit that fails `checkComposition` or
// `checkNoDuplicateSubcategory` is rejected outright. Season and color
// are advisory ("soft") checks: they annotate the outfit with a note
// instead of dropping it, since neither rule is reliable enough on this
// data (no explicit event-season input yet, and `color` is free-form
// hex/named) to justify silently discarding an otherwise-valid outfit.

const NEUTRAL_COLOR_WORDS = [
  'black', 'white', 'grey', 'gray', 'beige', 'navy', 'cream', 'ivory',
  'tan', 'brown', 'charcoal', 'khaki', 'stone', 'camel', 'denim',
];

// Thresholds per the example rule sketched in
// 12_ARHITECTURA_AI_SI_COMPUTER_VISION1.md §1 ("sub 10°C exclude tricouri
// fără strat peste"). Round numbers, not derived from any real data —
// revisit once there's actual usage to tune against.
const COLD_THRESHOLD_C = 10;
const HOT_THRESHOLD_C = 27;
const HEAVY_MATERIALS = ['wool', 'leather', 'cashmere'];

// Minimum composition: top + bottom, or dress — plus shoes.
function checkComposition(items) {
  const hasCategory = (cat) => items.some((i) => i.category === cat);
  const hasShoes = hasCategory('shoes');
  const hasDress = hasCategory('dress');
  const hasTopAndBottom = hasCategory('top') && hasCategory('bottom');

  if (!hasShoes) return { valid: false, reason: 'Missing shoes' };
  if (!hasDress && !hasTopAndBottom) {
    return { valid: false, reason: 'Needs a top + bottom, or a dress' };
  }
  return { valid: true };
}

// No two items of the identical subcategory — e.g. two hoodies, two
// pairs of jeans. Checked at the *subcategory* level, not category: a
// t-shirt + hoodie (both "top") or shorts + leggings (both "bottom", a
// real layered look for e.g. running) are different subcategories and
// stay allowed — only an exact repeat is nonsensical.
function checkNoDuplicateSubcategory(items) {
  const seen = new Map(); // subcategory -> count
  for (const item of items) {
    seen.set(item.subcategory, (seen.get(item.subcategory) || 0) + 1);
  }
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([sub]) => sub);
  if (duplicated.length) {
    return {
      valid: false,
      reason: `Two ${duplicated.join(', ')} in one outfit — pick just one of each`,
    };
  }
  return { valid: true };
}

// Season-appropriateness — only enforced when the caller passes an
// explicit `contextSeason` (weather/event context, Phase 4). Without it,
// this is a no-op so Phase 2 doesn't hard-block on a signal we don't have
// yet; the check is written now so Phase 4 doesn't need to touch this
// file, just start passing the field.
function checkSeason(items, contextSeason) {
  if (!contextSeason || contextSeason === 'all') return { valid: true };
  const mismatched = items.filter((i) => i.season !== 'all' && i.season !== contextSeason);
  if (mismatched.length) {
    return {
      valid: false,
      reason: `${mismatched.map((i) => i.subcategory).join(', ')} ${mismatched.length > 1 ? "aren't" : "isn't"} season-appropriate for ${contextSeason}`,
    };
  }
  return { valid: true };
}

// Cold-weather layering — hard filter, only when the caller passes an
// explicit `contextTemp` (°C, from the weather endpoint, Phase 4).
// Without it this is a no-op, same pattern as checkSeason. A dress counts
// as covering the torso but still needs a layer on top when it's cold —
// same rule as a top would need.
function checkLayering(items, contextTemp) {
  if (contextTemp === undefined || contextTemp === null) return { valid: true };
  if (contextTemp >= COLD_THRESHOLD_C) return { valid: true };

  const hasOuterwear = items.some((i) => i.category === 'outerwear');
  if (!hasOuterwear) {
    return {
      valid: false,
      reason: `It's ${Math.round(contextTemp)}°C — this needs a layer (jacket/coat) to be weather-appropriate`,
    };
  }
  return { valid: true };
}

// Hot-weather heavy materials — soft/advisory only, same reasoning as
// checkColorCoordination: a wool blazer on a hot day might be a deliberate
// choice (evening event, AC everywhere), so this flags rather than
// rejects.
function checkHeatMaterials(items, contextTemp) {
  if (contextTemp === undefined || contextTemp === null) return { valid: true };
  if (contextTemp < HOT_THRESHOLD_C) return { valid: true };

  const heavy = items.filter((i) => HEAVY_MATERIALS.includes(i.material));
  if (heavy.length) {
    return {
      valid: true,
      note: `It's ${Math.round(contextTemp)}°C — the ${heavy.map((i) => i.subcategory).join(', ')} might feel heavy in this heat.`,
    };
  }
  return { valid: true };
}

function isNeutral(color) {
  if (!color) return true;
  const lower = color.toLowerCase();
  if (NEUTRAL_COLOR_WORDS.some((w) => lower.includes(w))) return true;
  if (lower.startsWith('#')) {
    const sat = hexSaturation(lower);
    return sat !== null && sat < 0.35; // low-saturation hex reads as neutral
  }
  return false;
}

function hexSaturation(hex) {
  const m = hex.replace('#', '');
  if (![3, 6].includes(m.length)) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

// Basic color coordination — soft/advisory only (see file header). Flags
// outfits with more than two non-neutral, "loud" colors so the rationale
// can mention it; never rejects an outfit on this alone.
function checkColorCoordination(items) {
  const loudCount = items.filter((i) => !isNeutral(i.color)).length;
  if (loudCount > 2) {
    return { valid: true, note: 'This mixes a few bold colors — worth a second look in person.' };
  }
  return { valid: true };
}

// Runs all checks. `hard` failures (composition, season when a context
// season is supplied, and layering when a context temperature is
// supplied) exclude the outfit; `soft` results are merged into a single
// advisory note.
//
// `relaxed` (default false): an explicit, user-opted-in mode — not the
// model's choice — for "closest possible outfit anyway" after a normal
// attempt found nothing valid (see generation.controller.js's `relaxed`
// body flag, only ever sent after the user taps a specific button for
// it). It downgrades the three hard checks above to advisory: they no
// longer exclude the outfit, they just get folded into the note so the
// user sees plainly what's missing/off about it. This is still 100%
// deterministic code deciding what's true and what to say about it —
// nothing here asks the model to judge validity, only the *threshold*
// for what counts as acceptable changes, and only because the user
// explicitly asked for that trade-off.
function validateOutfit(items, { contextSeason, contextTemp, relaxed = false } = {}) {
  const composition = checkComposition(items);
  const noDupes = checkNoDuplicateSubcategory(items);
  const season = checkSeason(items, contextSeason);
  const layering = checkLayering(items, contextTemp);
  const hardFailures = [composition, noDupes, season, layering].filter((r) => !r.valid);

  if (hardFailures.length && !relaxed) {
    return { valid: false, reason: hardFailures[0].reason };
  }

  const color = checkColorCoordination(items);
  const heat = checkHeatMaterials(items, contextTemp);
  const notes = [
    ...(relaxed ? hardFailures.map((f) => f.reason) : []),
    color.note,
    heat.note,
  ].filter(Boolean);

  return { valid: true, note: notes.join(' ') || undefined };
}

module.exports = {
  validateOutfit, checkComposition, checkNoDuplicateSubcategory, checkSeason, checkLayering, checkHeatMaterials,
  checkColorCoordination, isNeutral,
};
