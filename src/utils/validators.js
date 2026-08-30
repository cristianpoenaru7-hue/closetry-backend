const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'bag', 'swimwear'];

// Mirrors mobile's src/theme/tokens.js THEME_NAMES — kept as a plain
// array here (not a Prisma enum) since User.theme is a String field with
// a default, same reasoning as category/material staying app-validated.
const THEME_NAMES = ['gold', 'dark', 'light'];
const MATERIALS = ['cotton', 'linen', 'wool', 'silk', 'denim', 'leather', 'cashmere', 'synthetic', 'other'];
const SEASONS = ['spring', 'summer', 'fall', 'winter', 'all'];

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateRegisterInput({ name, email, password, acceptedPolicies }) {
  const errors = [];
  if (!isNonEmptyString(name)) errors.push('name is required');
  if (!isValidEmail(email)) errors.push('a valid email is required');
  if (typeof password !== 'string' || password.length < 8) {
    errors.push('password must be at least 8 characters');
  }
  if (acceptedPolicies !== true) {
    errors.push('you must accept the Privacy Policy and Terms of Service to create an account');
  }
  return errors;
}

function validateLoginInput({ email, password }) {
  const errors = [];
  if (!isValidEmail(email)) errors.push('a valid email is required');
  if (!isNonEmptyString(password)) errors.push('password is required');
  return errors;
}

function validateItemInput(body, { partial = false } = {}) {
  const errors = [];
  const req = (field) => !partial || body[field] !== undefined;

  if (req('category') && !CATEGORIES.includes(body.category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (req('subcategory') && !isNonEmptyString(body.subcategory)) {
    errors.push('subcategory is required');
  }
  if (req('color') && !isNonEmptyString(body.color)) {
    errors.push('color is required');
  }
  if (req('material') && !MATERIALS.includes(body.material)) {
    errors.push(`material must be one of: ${MATERIALS.join(', ')}`);
  }
  if (req('season') && !SEASONS.includes(body.season)) {
    errors.push(`season must be one of: ${SEASONS.join(', ')}`);
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    errors.push('tags must be an array of strings');
  }
  return errors;
}

module.exports = {
  CATEGORIES,
  MATERIALS,
  SEASONS,
  THEME_NAMES,
  isValidEmail,
  isNonEmptyString,
  validateRegisterInput,
  validateLoginInput,
  validateItemInput,
};
