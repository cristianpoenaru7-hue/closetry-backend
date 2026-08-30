const { createMessage } = require('../config/anthropic');
const { parseModelJson } = require('../utils/parseModelJson');

// Third AI use case (03-ai-integration.md #3) — its own prompt, its own
// call site, never imported by generation.service.js or
// classification.service.js and never imports them. The model's only job
// is turning already-true facts into warm sentences; it is never asked
// (and structurally cannot, since it only ever sees `fact`/`key`, never
// raw item data) to decide what's true or to suggest a purchase.
const SYSTEM_PROMPT = `You phrase factual wardrobe-gap observations as short, friendly insights for a wardrobe app user.

You are given a JSON array of FACTS that are already true and already computed elsewhere — every number and category in them is correct and final. Your only job is to rephrase each fact's "fact" field as one warm, concise sentence (under 25 words), matched back by "key".

Rules:
- Never invent, change, round, or omit any number or category from the given fact — rephrase the wording, not the substance.
- Do not suggest what to buy, where to buy it, or any brand — this is a closet observation, not a shopping recommendation.
- One sentence per fact.

Respond with ONLY a JSON object, no markdown fences, no prose outside the JSON, in this exact shape:
{ "insights": [ { "key": "<key>", "text": "<one warm sentence>" } ] }`;

// Takes deterministic facts (from wardrobeGapAnalysis.js) and returns a
// Map<key, phrasedText> for whichever ones the model successfully
// phrased. Callers MUST fall back to the fact's own plain-English `fact`
// string for any key missing from the result (model error, invalid JSON,
// a key it dropped) — see smartCloset.controller.js. This function never
// throws for a bad *response*, only for actual request failures
// (network, missing API key), so a flaky phrasing pass degrades to
// plainer wording instead of breaking the feature.
async function phraseGapFacts(facts) {
  if (!facts.length) return new Map();

  const raw = await createMessage({
    system: SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens: 500,
    messages: [
      {
        role: 'user',
        content: JSON.stringify(facts.map((f) => ({ key: f.key, fact: f.fact }))),
      },
    ],
  });

  const parsed = parseModelJson(raw);
  const validKeys = new Set(facts.map((f) => f.key));
  const result = new Map();

  if (parsed && Array.isArray(parsed.insights)) {
    for (const item of parsed.insights) {
      // Grounding, same discipline as generation/classification: only
      // accept a phrasing for a key we actually asked about.
      if (item && validKeys.has(item.key) && typeof item.text === 'string' && item.text.trim()) {
        result.set(item.key, item.text.trim());
      }
    }
  }

  return result;
}

module.exports = { phraseGapFacts };
