// Model responses are instructed to be raw JSON, but strip a markdown
// fence defensively in case one shows up anyway, then parse. Returns null
// on failure instead of throwing — every caller decides its own fallback.
function parseModelJson(raw) {
  const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { parseModelJson };
