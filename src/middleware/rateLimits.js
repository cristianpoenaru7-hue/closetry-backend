const rateLimit = require('express-rate-limit');

// These are baseline, per-IP abuse protection — NOT the same thing as
// Phase 5's planned per-user freemium generation limits
// (11_GHID_MONETIZARE_SI_BUSINESS_MODEL.md §2/§4: "se limitează generările
// în tier-ul free"). That's a business-tier quota keyed on the user's
// Subscription, doesn't exist yet, and belongs to Phase 5. This is just
// "don't let one IP hammer the API or rack up Anthropic API costs."

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter — protects login/register against basic credential-guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in a few minutes.' },
});

// Applied narrowly to the endpoints that call Anthropic/OpenWeatherMap
// per-request (generation, classification, Smart Closet phrasing) — a
// real per-user cost source, unlike everything else in the API which is
// just a DB query. Per-IP, not per-user: real usage-tier quotas are
// Phase 5, see the file header.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests from this network — try again later.' },
});

// Protects the Contact us inbox from being flooded — 5/hour per IP is
// generous for a real person, restrictive for a script.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent — try again later.' },
});

module.exports = { generalLimiter, authLimiter, aiLimiter, contactLimiter };
