const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOutfit, checkComposition, checkNoDuplicateSubcategory, checkLayering, checkHeatMaterials, isNeutral } = require('../src/services/outfitValidity');

const top = { category: 'top', subcategory: 't-shirt', color: '#EDE6D8', season: 'summer' };
const bottom = { category: 'bottom', subcategory: 'jeans', color: '#2C3E50', season: 'all' };
const dress = { category: 'dress', subcategory: 'midi-dress', color: '#3F5C4E', season: 'summer' };
const shoes = { category: 'shoes', subcategory: 'sneakers', color: '#EDE6D8', season: 'all' };

test('checkComposition rejects an outfit with no shoes', () => {
  const result = checkComposition([top, bottom]);
  assert.equal(result.valid, false);
});

test('checkComposition accepts top + bottom + shoes', () => {
  const result = checkComposition([top, bottom, shoes]);
  assert.equal(result.valid, true);
});

test('checkComposition accepts a dress + shoes, no top/bottom needed', () => {
  const result = checkComposition([dress, shoes]);
  assert.equal(result.valid, true);
});

test('checkComposition rejects a lone top with no bottom or dress', () => {
  const result = checkComposition([top, shoes]);
  assert.equal(result.valid, false);
});

test('checkNoDuplicateSubcategory rejects two items of the exact same subcategory', () => {
  const hoodie1 = { category: 'top', subcategory: 'hoodie', color: '#14120F', season: 'all' };
  const hoodie2 = { category: 'top', subcategory: 'hoodie', color: '#EDE6D8', season: 'all' };
  const result = checkNoDuplicateSubcategory([hoodie1, hoodie2, bottom, shoes]);
  assert.equal(result.valid, false);
  assert.match(result.reason, /hoodie/);
});

test('checkNoDuplicateSubcategory allows two different subcategories in the same category', () => {
  const tshirt = { category: 'top', subcategory: 't-shirt', color: '#EDE6D8', season: 'all' };
  const hoodie = { category: 'top', subcategory: 'hoodie', color: '#14120F', season: 'all' };
  const result = checkNoDuplicateSubcategory([tshirt, hoodie, bottom, shoes]);
  assert.equal(result.valid, true);
});

test('checkNoDuplicateSubcategory allows shorts + leggings (a real layered look), rejects two of either alone', () => {
  const shorts = { category: 'bottom', subcategory: 'shorts', color: '#14120F', season: 'summer' };
  const leggings = { category: 'bottom', subcategory: 'leggings', color: '#0A0908', season: 'all' };
  assert.equal(checkNoDuplicateSubcategory([top, shorts, leggings, shoes]).valid, true);

  const shorts2 = { category: 'bottom', subcategory: 'shorts', color: '#EDE6D8', season: 'summer' };
  assert.equal(checkNoDuplicateSubcategory([top, shorts, shorts2, shoes]).valid, false);
});

test('validateOutfit rejects a duplicate-subcategory outfit even though composition/season/layering all pass', () => {
  const jeans1 = { category: 'bottom', subcategory: 'jeans', color: '#2C3E50', season: 'all' };
  const jeans2 = { category: 'bottom', subcategory: 'jeans', color: '#14120F', season: 'all' };
  const result = validateOutfit([top, jeans1, jeans2, shoes]);
  assert.equal(result.valid, false);
});

test('validateOutfit in relaxed mode downgrades the duplicate-subcategory rule to an advisory note', () => {
  const jeans1 = { category: 'bottom', subcategory: 'jeans', color: '#2C3E50', season: 'all' };
  const jeans2 = { category: 'bottom', subcategory: 'jeans', color: '#14120F', season: 'all' };
  const result = validateOutfit([top, jeans1, jeans2, shoes], { relaxed: true });
  assert.equal(result.valid, true);
  assert.match(result.note, /jeans/);
});

test('validateOutfit rejects an incomplete outfit regardless of season/color', () => {
  const result = validateOutfit([top]);
  assert.equal(result.valid, false);
});

test('validateOutfit enforces contextSeason when explicitly provided', () => {
  const wool_coat = { category: 'outerwear', subcategory: 'coat', color: '#14120F', season: 'winter' };
  const result = validateOutfit([top, bottom, shoes, wool_coat], { contextSeason: 'summer' });
  assert.equal(result.valid, false);
});

test('validateOutfit is a no-op on season when contextSeason is not provided', () => {
  const wool_coat = { category: 'outerwear', subcategory: 'coat', color: '#14120F', season: 'winter' };
  const result = validateOutfit([top, bottom, shoes, wool_coat]);
  assert.equal(result.valid, true);
});

test('validateOutfit flags (but does not reject) heavy color mixing', () => {
  const red = { category: 'top', subcategory: 't-shirt', color: '#D9CBAE', season: 'all' };
  const bright1 = { category: 'bottom', subcategory: 'jeans', color: '#B5443B', season: 'all' };
  const bright2 = { category: 'outerwear', subcategory: 'jacket', color: '#3F5C4E', season: 'all' };
  const bright3 = { category: 'accessory', subcategory: 'scarf', color: '#C9A227', season: 'all' };
  const result = validateOutfit([red, bright1, bright2, bright3, shoes]);
  assert.equal(result.valid, true);
  assert.ok(result.note);
});

test('isNeutral treats named neutrals and low-saturation hex as neutral', () => {
  assert.equal(isNeutral('black'), true);
  assert.equal(isNeutral('#14120F'), true);
  assert.equal(isNeutral('#B5443B'), false);
});

test('checkLayering rejects a top+bottom+shoes outfit with no outerwear when it is cold', () => {
  const result = checkLayering([top, bottom, shoes], 3);
  assert.equal(result.valid, false);
});

test('checkLayering accepts the same outfit once outerwear is added', () => {
  const coat = { category: 'outerwear', subcategory: 'coat', color: '#14120F', material: 'wool', season: 'winter' };
  const result = checkLayering([top, bottom, shoes, coat], 3);
  assert.equal(result.valid, true);
});

test('checkLayering is a no-op above the cold threshold', () => {
  const result = checkLayering([top, bottom, shoes], 18);
  assert.equal(result.valid, true);
});

test('checkLayering is a no-op when contextTemp is not provided', () => {
  const result = checkLayering([top, bottom, shoes], undefined);
  assert.equal(result.valid, true);
});

test('validateOutfit enforces layering as a hard rule via contextTemp', () => {
  const result = validateOutfit([top, bottom, shoes], { contextTemp: 2 });
  assert.equal(result.valid, false);
});

test('checkHeatMaterials flags (but does not reject) heavy materials above the hot threshold', () => {
  const woolSweater = { category: 'top', subcategory: 'sweater', color: '#3F5C4E', material: 'wool', season: 'all' };
  const result = checkHeatMaterials([woolSweater, bottom, shoes], 30);
  assert.equal(result.valid, true);
  assert.ok(result.note.includes('sweater'));
});

test('checkHeatMaterials is a no-op below the hot threshold', () => {
  const woolSweater = { category: 'top', subcategory: 'sweater', color: '#3F5C4E', material: 'wool', season: 'all' };
  const result = checkHeatMaterials([woolSweater, bottom, shoes], 20);
  assert.equal(result.note, undefined);
});
