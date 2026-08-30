const { createMessage } = require('../config/anthropic');
const { validateOutfit } = require('./outfitValidity');
const { parseModelJson } = require('../utils/parseModelJson');

// How many prior messages (user+assistant turns combined) to replay to the
// model. Keeps follow-ups like "something without the dress" resolvable
// without letting the prompt grow unbounded — see 03-ai-integration.md's
// note on trimming/summarizing long sessions. Revisit with real
// conversation-length data before raising this.
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT = `You are a personal AI stylist for a wardrobe app. You select outfits ONLY from the user's actual closet — you must never invent a clothing item.

You will be given:
1. The user's wardrobe as a JSON array of items, each with an "id" you MUST use verbatim.
2. The recent conversation so far.
3. The user's latest message.

Rules:
- Every item you reference MUST be one of the given wardrobe item ids. Never invent an id, name, or item that isn't in the list.
- Suggest 1-2 outfits per turn.
- Each outfit needs at least one "shoes" item, plus either a "dress" or both a "top" and a "bottom". Outerwear, accessories, and bags are optional additions.
- Never include two items with the exact same subcategory in one outfit (e.g. two hoodies, two pairs of jeans) — pick whichever one fits best. Two DIFFERENT subcategories in the same category are fine and sometimes correct (a t-shirt under a hoodie, or shorts over leggings for a workout look).
- Consider color/material coordination and fit for the stated occasion/vibe/season in your choice, and explain your reasoning briefly.
- If current weather is provided, treat it as real context for your choice (e.g. prefer boots over open sandals when it's raining, avoid suggesting shorts when it's cold) — beyond the hard temperature/layering rule enforced separately, use your judgment for conditions like rain, wind, or humidity that aren't captured by temperature alone.
- If a follow-up asks to change something (swap an item, drop a piece, make it warmer, etc.), modify the most recent outfit you suggested rather than starting over, unless the user clearly asks for something new.
- If the wardrobe genuinely doesn't have enough pieces to form a valid outfit, say so plainly in "note" and return an empty "outfits" array — do not force an invalid combination.

Respond with ONLY a JSON object, no markdown fences, no prose outside the JSON, in this exact shape:
{
  "outfits": [
    { "itemIds": ["<id>", "<id>"], "rationale": "one or two sentences" }
  ],
  "note": "optional short message, e.g. when you can't fully satisfy the request"
}`;

function buildWardrobeContext(items) {
  return items.map((i) => ({
    id: i.id,
    category: i.category,
    subcategory: i.subcategory,
    color: i.color,
    material: i.material,
    season: i.season,
    tags: i.tags,
  }));
}

function trimHistory(messages) {
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

// Converts our stored session messages (role + content, where assistant
// content may be a structured object) into the flat text turns the
// Anthropic Messages API expects.
function toApiMessages(sessionMessages, wardrobeContext, latestUserText, weather) {
  const history = trimHistory(sessionMessages).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  const wardrobeBlock = `Wardrobe (JSON):\n${JSON.stringify(wardrobeContext)}`;
  const weatherBlock = weather
    ? `\n\nCurrent weather: ${Math.round(weather.tempC)}°C, ${weather.condition || weather.description || 'unknown conditions'}.`
    : '';
  const userBlock = `${wardrobeBlock}${weatherBlock}\n\nUser: ${latestUserText}`;

  return [...history, { role: 'user', content: userBlock }];
}

// Grounding: drop any itemId the model returned that isn't actually in
// the user's wardrobe. Never trust the model's ids at face value — see
// the non-negotiable grounding rule in 03-ai-integration.md.
function groundOutfit(outfit, itemsById) {
  const itemIds = (outfit.itemIds || []).filter((id) => itemsById.has(id));
  const items = itemIds.map((id) => itemsById.get(id));
  return { ...outfit, itemIds, items };
}

// Orchestrates one generation turn: calls the model, grounds the result
// against the real wardrobe, and applies the deterministic validity layer.
// Returns { outfits: [...], note } where each outfit is hydrated with full
// item objects (for the client to render) plus a `warning` if a soft
// check (color coordination, hot-weather heavy materials) flagged it.
// contextTemp (°C) and weatherCondition are both optional — when present
// they're shown to the model as real context AND enforced by the
// deterministic layer's cold-weather layering rule; omitting them is a
// full no-op, unchanged from Phase 2 behavior.
async function generateOutfits({
  wardrobeItems, sessionMessages, userText, contextSeason, contextTemp, weatherCondition, relaxed = false,
}) {
  const itemsById = new Map(wardrobeItems.map((i) => [i.id, i]));
  const wardrobeContext = buildWardrobeContext(wardrobeItems);
  const weather = contextTemp !== undefined && contextTemp !== null
    ? { tempC: contextTemp, condition: weatherCondition }
    : null;
  const apiMessages = toApiMessages(sessionMessages, wardrobeContext, userText, weather);

  const raw = await createMessage({ system: SYSTEM_PROMPT, messages: apiMessages });
  const parsed = parseModelJson(raw);

  if (!parsed || !Array.isArray(parsed.outfits)) {
    return {
      outfits: [],
      note: "I had trouble putting a look together just now — try rephrasing the occasion or ask again.",
    };
  }

  // Collected purely from the deterministic layer's own `reason` strings
  // (checkComposition/checkSeason/checkLayering in outfitValidity.js) —
  // never inferred by the model. Surfacing *why* a hard check rejected a
  // candidate is still 100% code deciding what's true, same as before;
  // this only changes whether that reason reaches the user instead of
  // being silently dropped.
  const outfits = [];
  const hardFailReasons = [];
  for (const candidate of parsed.outfits) {
    const grounded = groundOutfit(candidate, itemsById);
    if (!grounded.items.length) continue; // model invented ids we can't use at all

    const result = validateOutfit(grounded.items, { contextSeason, contextTemp, relaxed });
    if (!result.valid) {
      hardFailReasons.push(result.reason);
      continue; // fails the hard deterministic rules — drop it
    }

    outfits.push({
      itemIds: grounded.itemIds,
      items: grounded.items,
      rationale: candidate.rationale || '',
      warning: result.note || null,
    });
  }

  let note = parsed.note || null;
  if (!outfits.length && !note) {
    if (hardFailReasons.length) {
      // Dedupe — the same missing piece (e.g. "Missing shoes") often
      // repeats across every candidate the model tried this turn.
      const reasons = [...new Set(hardFailReasons)];
      note = `Ava couldn't complete a look for that — ${reasons.join('; ')}. Add the missing piece(s) to your wardrobe, or try a different occasion.`;
    } else {
      note = "I couldn't build a complete outfit from your wardrobe for that yet — try adding a few more pieces, or describe it differently.";
    }
  }

  // Only offer the "closest possible outfit anyway" follow-up when this
  // WAS a normal (non-relaxed) attempt, it came up empty, AND the reason
  // was specifically the hard rules rejecting real candidates — not
  // "the model invented items" or "the model itself gave up" (relaxing
  // validity wouldn't fix either of those).
  const canRetryRelaxed = !relaxed && !outfits.length && hardFailReasons.length > 0;

  return { outfits: outfits.slice(0, 2), note, canRetryRelaxed, relaxed };
}

module.exports = { generateOutfits, buildWardrobeContext, trimHistory };
