// Thin wrapper around the Anthropic Messages API. Text-only (no vision) —
// used exclusively by the outfit-generation service (src/services/
// generation.service.js). Auto-tagging (Phase 4, vision calls) and
// Smart Closet (Phase 4, separate prompt) must never share this module's
// call sites — see 03-ai-integration.md's hard boundary.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

// Thrown when the API key is missing so callers can surface a clear,
// actionable error instead of a confusing fetch/auth failure.
class AnthropicConfigError extends Error {}

// `temperature` is deliberately NOT sent — the currently configured model
// (see CLAUDE_MODEL/DEFAULT_MODEL above) rejects it outright with a 400
// ("temperature is deprecated for this model"), so every call site
// (generation, classification, Smart Closet phrasing) would otherwise
// fail on every request. Callers may still pass `temperature` (kept for
// call-site clarity about intended creativity/consistency), but it's a
// no-op until Anthropic's API supports it again for this model — don't
// re-add it to the request body without confirming the model accepts it.
async function createMessage({ system, messages, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicConfigError(
      'ANTHROPIC_API_KEY is not set — add it to .env before using the outfit generator.'
    );
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API returned ${res.status}: ${text || 'no details'}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { createMessage, AnthropicConfigError, DEFAULT_MODEL };
