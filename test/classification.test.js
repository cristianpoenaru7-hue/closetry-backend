const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSuggestion, isValidHex } = require('../src/services/classification.service');

test('sanitizeSuggestion accepts a full, valid response', () => {
  const result = sanitizeSuggestion({
    category: 'top', subcategory: 'T-Shirt', color: '#3F5C4E',
    material: 'cotton', season: 'summer', pattern: 'Solid', brand: 'Everlane',
  });
  assert.deepEqual(result, {
    category: 'top', subcategory: 't-shirt', color: '#3F5C4E',
    material: 'cotton', season: 'summer', pattern: 'solid', brand: 'Everlane',
  });
});

test('sanitizeSuggestion drops an invented category rather than passing it through', () => {
  const result = sanitizeSuggestion({ category: 'hat', color: '#000000' });
  assert.equal(result, null); // no usable category left at all
});

test('sanitizeSuggestion drops an invalid material/season but keeps the rest', () => {
  const result = sanitizeSuggestion({
    category: 'top', material: 'plastic', season: 'monsoon', color: '#EDE6D8',
  });
  assert.equal(result.category, 'top');
  assert.equal(result.color, '#EDE6D8');
  assert.equal('material' in result, false);
  assert.equal('season' in result, false);
});

test('sanitizeSuggestion omits brand entirely when not provided (never guesses)', () => {
  const result = sanitizeSuggestion({ category: 'shoes', color: '#14120F' });
  assert.equal('brand' in result, false);
});

test('sanitizeSuggestion drops a malformed hex color', () => {
  const result = sanitizeSuggestion({ category: 'bag', color: 'navy-ish' });
  assert.equal('color' in result, false);
});

test('sanitizeSuggestion passes through an explicit model error', () => {
  const result = sanitizeSuggestion({ error: "That doesn't look like a clothing item." });
  assert.deepEqual(result, { error: "That doesn't look like a clothing item." });
});

test('sanitizeSuggestion returns null for garbage input', () => {
  assert.equal(sanitizeSuggestion(null), null);
  assert.equal(sanitizeSuggestion('not an object'), null);
  assert.equal(sanitizeSuggestion({}), null);
});

test('isValidHex accepts 3- and 6-digit hex, rejects everything else', () => {
  assert.equal(isValidHex('#fff'), true);
  assert.equal(isValidHex('#3F5C4E'), true);
  assert.equal(isValidHex('navy'), false);
  assert.equal(isValidHex('#gggggg'), false);
  assert.equal(isValidHex(undefined), false);
});
