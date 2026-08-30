const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeWardrobeGaps, checkCategoryImbalance, checkShoeFormalityGap, checkSeasonCoverage,
} = require('../src/services/wardrobeGapAnalysis');

function item(category, subcategory, season = 'all') {
  return { category, subcategory, season };
}

test('analyzeWardrobeGaps returns nothing below the minimum wardrobe size', () => {
  const items = [item('top', 't-shirt'), item('bottom', 'jeans')];
  assert.deepEqual(analyzeWardrobeGaps(items), []);
});

test('checkCategoryImbalance flags a lopsided wardrobe (plenty of tops, almost no outerwear)', () => {
  const items = [
    ...Array(5).fill(0).map(() => item('top', 't-shirt')),
    item('bottom', 'jeans'), item('bottom', 'jeans'),
    item('dress', 'midi-dress'),
    item('shoes', 'sneakers'),
  ];
  const result = checkCategoryImbalance(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'gap:category:outerwear');
  assert.equal(result[0].weakCount, 0);
  assert.equal(result[0].dominantCategory, 'top');
});

test('checkCategoryImbalance stays quiet on a reasonably balanced wardrobe', () => {
  const items = [
    item('top', 't-shirt'), item('top', 'shirt'),
    item('bottom', 'jeans'), item('bottom', 'trousers'),
    item('shoes', 'sneakers'), item('outerwear', 'jacket'),
  ];
  assert.deepEqual(checkCategoryImbalance(items), []);
});

test('checkShoeFormalityGap fires on 3+ casual shoes and zero formal ones', () => {
  const items = [
    item('shoes', 'sneakers'), item('shoes', 'sneakers'), item('shoes', 'sandals'),
    item('top', 't-shirt'), item('bottom', 'jeans'),
  ];
  const result = checkShoeFormalityGap(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'gap:shoes:formal');
  assert.equal(result[0].casualCount, 3);
  assert.equal(result[0].formalCount, 0);
});

test('checkShoeFormalityGap computes a combinatorial unlock estimate from tops/bottoms/dresses', () => {
  const items = [
    item('shoes', 'sneakers'), item('shoes', 'sneakers'), item('shoes', 'sneakers'),
    item('top', 't-shirt'), item('top', 'shirt'),
    item('bottom', 'jeans'), item('bottom', 'trousers'), item('bottom', 'shorts'),
    item('dress', 'midi-dress'),
  ];
  const [result] = checkShoeFormalityGap(items);
  // 2 tops * 3 bottoms + 1 dress = 7
  assert.equal(result.unlockEstimate, 7);
});

test('checkShoeFormalityGap does not fire once a formal shoe exists', () => {
  const items = [
    item('shoes', 'sneakers'), item('shoes', 'sneakers'), item('shoes', 'sneakers'),
    item('shoes', 'loafers'),
  ];
  assert.deepEqual(checkShoeFormalityGap(items), []);
});

test('checkSeasonCoverage is a no-op below the season-check minimum', () => {
  const items = Array(6).fill(0).map(() => item('top', 't-shirt', 'summer'));
  assert.deepEqual(checkSeasonCoverage(items), []);
});

test('checkSeasonCoverage flags every season with zero season-specific items', () => {
  const items = [
    ...Array(9).fill(0).map(() => item('top', 't-shirt', 'summer')),
  ];
  const result = checkSeasonCoverage(items);
  const seasons = result.map((r) => r.season).sort();
  assert.deepEqual(seasons, ['fall', 'spring', 'winter']);
});

test('checkSeasonCoverage does not flag a season that has any items, however few', () => {
  const items = [
    ...Array(7).fill(0).map(() => item('top', 't-shirt', 'summer')),
    item('outerwear', 'coat', 'winter'),
  ];
  const result = checkSeasonCoverage(items);
  assert.equal(result.some((r) => r.season === 'winter'), false);
});

test('checkSeasonCoverage ignores "all"-season items entirely (they cover no specific season)', () => {
  const items = Array(9).fill(0).map(() => item('top', 't-shirt', 'all'));
  const result = checkSeasonCoverage(items);
  assert.equal(result.length, 4); // all four specific seasons still flagged
});

test('analyzeWardrobeGaps combines every rule and every fact has a unique key', () => {
  const items = [
    ...Array(5).fill(0).map(() => item('top', 't-shirt', 'summer')),
    ...Array(3).fill(0).map(() => item('shoes', 'sneakers', 'summer')),
  ];
  const facts = analyzeWardrobeGaps(items);
  const keys = facts.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(facts.length > 1); // both category imbalance and shoe-formality should fire here
});
