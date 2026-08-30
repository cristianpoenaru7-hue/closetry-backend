const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidEmail, validateRegisterInput, validateLoginInput, validateItemInput,
} = require('../src/utils/validators');

test('isValidEmail accepts well-formed addresses', () => {
  assert.equal(isValidEmail('ava@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(undefined), false);
});

test('validateRegisterInput rejects short password', () => {
  const errors = validateRegisterInput({ name: 'Ava', email: 'ava@example.com', password: 'short' });
  assert.ok(errors.some((e) => e.includes('8 characters')));
});

test('validateRegisterInput accepts valid input with policies accepted', () => {
  const errors = validateRegisterInput({
    name: 'Ava', email: 'ava@example.com', password: 'longenough123', acceptedPolicies: true,
  });
  assert.deepEqual(errors, []);
});

test('validateRegisterInput rejects registration without accepting policies', () => {
  const errors = validateRegisterInput({ name: 'Ava', email: 'ava@example.com', password: 'longenough123' });
  assert.ok(errors.some((e) => e.includes('Privacy Policy')));
});

test('validateLoginInput requires email and password', () => {
  const errors = validateLoginInput({ email: '', password: '' });
  assert.equal(errors.length, 2);
});

test('validateItemInput rejects invalid category/material/season', () => {
  const errors = validateItemInput({
    category: 'hat', subcategory: 't-shirt', color: 'navy', material: 'plastic', season: 'monsoon',
  });
  assert.equal(errors.length, 3);
});

test('validateItemInput accepts a full valid item', () => {
  const errors = validateItemInput({
    category: 'top', subcategory: 't-shirt', color: 'navy', material: 'cotton', season: 'summer', tags: ['casual'],
  });
  assert.deepEqual(errors, []);
});

test('validateItemInput accepts the swimwear category', () => {
  const errors = validateItemInput({
    category: 'swimwear', subcategory: 'swim-trunks', color: 'navy', material: 'synthetic', season: 'summer',
  });
  assert.deepEqual(errors, []);
});

test('validateItemInput partial mode only checks provided fields (PATCH case)', () => {
  const errors = validateItemInput({ color: 'red' }, { partial: true });
  assert.deepEqual(errors, []);
});

test('validateItemInput partial mode still rejects an invalid provided field', () => {
  const errors = validateItemInput({ material: 'plastic' }, { partial: true });
  assert.equal(errors.length, 1);
});
