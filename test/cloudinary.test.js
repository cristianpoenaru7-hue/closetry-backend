const test = require('node:test');
const assert = require('node:assert/strict');
const { optimizeDeliveryUrl } = require('../src/config/cloudinary');

test('optimizeDeliveryUrl injects f_auto,q_auto,w_<width> after /upload/', () => {
  const raw = 'https://res.cloudinary.com/demo/image/upload/v1234567890/wardrobe/user1/abc123.jpg';
  const result = optimizeDeliveryUrl(raw);
  assert.equal(result, 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1200/v1234567890/wardrobe/user1/abc123.jpg');
});

test('optimizeDeliveryUrl respects a custom width', () => {
  const raw = 'https://res.cloudinary.com/demo/image/upload/v1/abc.jpg';
  const result = optimizeDeliveryUrl(raw, { width: 400 });
  assert.ok(result.includes('w_400'));
});

test('optimizeDeliveryUrl passes through a non-Cloudinary URL unchanged', () => {
  const raw = 'http://localhost:4000/uploads/local-fallback.png';
  assert.equal(optimizeDeliveryUrl(raw), raw);
});

test('optimizeDeliveryUrl passes through null/undefined unchanged', () => {
  assert.equal(optimizeDeliveryUrl(null), null);
  assert.equal(optimizeDeliveryUrl(undefined), undefined);
});
