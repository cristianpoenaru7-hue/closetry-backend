const { createMessage } = require('../config/anthropic');
const { parseModelJson } = require('../utils/parseModelJson');
const { CATEGORIES, MATERIALS, SEASONS } = require('../utils/validators');

// Vision classification (use case #1 in 03-ai-integration.md) is a
// different problem from outfit generation (use case #2) — different
// prompt, different call site, never shares code with
// services/generation.service.js. Both happen to call the same Anthropic
// Messages API, just with an image content block here instead of
// text-only.

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches config/upload.js's multer limit

const SYSTEM_PROMPT = `You classify a single photographed clothing item for a wardrobe app. Look only at the item itself — ignore background, lighting, or any people in the shot.

Respond with ONLY a JSON object, no markdown fences, no prose outside the JSON, in this exact shape:
{
  "category": one of ["top","bottom","dress","outerwear","shoes","accessory","bag","swimwear"],
  "subcategory": a short lowercase label, e.g. "t-shirt", "jeans", "sneakers",
  "color": a hex color string like "#3F5C4E" approximating the item's dominant color,
  "material": one of ["cotton","linen","wool","silk","denim","leather","cashmere","synthetic","other"] or null if you can't tell,
  "season": one of ["spring","summer","fall","winter","all"] — your best guess at when this item is typically worn, or "all" if it's not season-specific,
  "pattern": a short lowercase label like "solid", "striped", "floral", "plaid", or null,
  "brand": the brand name ONLY if clearly legible on a visible tag/logo with high confidence — omit this field entirely otherwise. Never guess a brand from style alone.
}

If you genuinely cannot identify a plausible category (the photo isn't a clothing item, or is unreadable), respond with {"error": "reason"} instead.`;

function isValidHex(color) {
  return typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

// Validates the model's output against our controlled enums before it
// ever reaches the client — an invented category/material/season would
// silently break the app's enum-based filter chips (see 02-data-model.md's
// note on subcategory/material staying controlled, not free text).
function sanitizeSuggestion(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.error) return { error: String(parsed.error) };

  const suggestion = {};
  if (CATEGORIES.includes(parsed.category)) suggestion.category = parsed.category;
  if (typeof parsed.subcategory === 'string' && parsed.subcategory.trim()) {
    suggestion.subcategory = parsed.subcategory.trim().toLowerCase().slice(0, 40);
  }
  if (isValidHex(parsed.color)) suggestion.color = parsed.color;
  if (MATERIALS.includes(parsed.material)) suggestion.material = parsed.material;
  if (SEASONS.includes(parsed.season)) suggestion.season = parsed.season;
  if (typeof parsed.pattern === 'string' && parsed.pattern.trim()) {
    suggestion.pattern = parsed.pattern.trim().toLowerCase().slice(0, 40);
  }
  // Brand is deliberately only included when the model gave one — a
  // missing key here means "omitted", never coerced to a guess (see
  // 03-ai-integration.md: "treat low-confidence brand guesses as omitted
  // rather than wrong").
  if (typeof parsed.brand === 'string' && parsed.brand.trim()) {
    suggestion.brand = parsed.brand.trim().slice(0, 60);
  }

  // A classification with no usable category is not worth returning as a
  // suggestion — the whole point is pre-filling the category picker.
  if (!suggestion.category) return null;
  return suggestion;
}

// Every field in the returned suggestion is EDITABLE, never auto-applied
// (see the non-negotiable rule in 07_GHID_DEZVOLTARE_APLICATIE.md §4) —
// this function only ever returns a suggestion object; nothing here
// touches the database.
async function classifyItemPhoto(buffer, mimetype) {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Photo is too large to classify');
  }

  const raw = await createMessage({
    system: SYSTEM_PROMPT,
    temperature: 0.2, // classification should be consistent, not creative
    maxTokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimetype, data: buffer.toString('base64') } },
          { type: 'text', text: 'Classify this clothing item.' },
        ],
      },
    ],
  });

  const parsed = parseModelJson(raw);
  const suggestion = sanitizeSuggestion(parsed);

  if (!suggestion) {
    return { suggestion: null, note: "Couldn't confidently identify this item — enter its details manually." };
  }
  if (suggestion.error) {
    return { suggestion: null, note: suggestion.error };
  }
  return { suggestion, note: null };
}

module.exports = { classifyItemPhoto, sanitizeSuggestion, isValidHex };
