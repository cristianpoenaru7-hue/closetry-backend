const test = require('node:test');
const assert = require('node:assert/strict');
const { optimizeDeliveryUrl, publicIdFromUrl, deleteImageByUrl, deleteUserImages } = require('../src/config/cloudinary');

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

// --- publicIdFromUrl: delivery URL -> public ID, used to delete the photo
// when an item (or the whole account) is deleted ---

test('publicIdFromUrl recovers the public ID from a plain upload URL', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1234567890/wardrobe/user1/abc123.png';
  assert.equal(publicIdFromUrl(url), 'wardrobe/user1/abc123');
});

test('publicIdFromUrl ignores the optimized-delivery transformation segment', () => {
  const url = optimizeDeliveryUrl('https://res.cloudinary.com/demo/image/upload/v1234567890/wardrobe/user1/abc123.png');
  assert.equal(publicIdFromUrl(url), 'wardrobe/user1/abc123');
});

test('publicIdFromUrl handles the avatar width variant and a query string', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400/v99/wardrobe/u-2/xyz.jpg?foo=bar';
  assert.equal(publicIdFromUrl(url), 'wardrobe/u-2/xyz');
});

test('publicIdFromUrl returns null for anything that is not one of our uploads', () => {
  assert.equal(publicIdFromUrl('http://localhost:4000/uploads/local-fallback.png'), null); // local dev fallback
  assert.equal(publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/v1/someone-elses/pic.png'), null); // no wardrobe/ folder
  assert.equal(publicIdFromUrl('https://example.com/upload/wardrobe/u/a.png'), null); // not Cloudinary
  assert.equal(publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/v1/wardrobe'), null); // folder only, no file
  assert.equal(publicIdFromUrl(null), null);
  assert.equal(publicIdFromUrl(undefined), null);
});

test('delete helpers are harmless no-ops when Cloudinary is not configured', async () => {
  // No CLOUDINARY_* env vars in the test environment: nothing should throw or reach the network.
  assert.equal(await deleteImageByUrl('https://res.cloudinary.com/demo/image/upload/v1/wardrobe/u/a.png'), false);
  await deleteUserImages('some-user-id');
});

// --- b17: only the owner's own folder counts as "ours" ---

test('publicIdFromUrl with a userId accepts only wardrobe/<userId>/ photos', () => {
  const own = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1200/v1/wardrobe/user1/abc.jpg';
  assert.equal(publicIdFromUrl(own, 'user1'), 'wardrobe/user1/abc');
  assert.equal(publicIdFromUrl(own, 'user2'), null); // someone else's photo
});

test('publicIdFromUrl with a userId rejects prefix lookalikes, traversal and empty ids', () => {
  const base = 'https://res.cloudinary.com/demo/image/upload/v1/';
  assert.equal(publicIdFromUrl(base + 'wardrobe/user10/a.jpg', 'user1'), null); // user1 vs user10
  assert.equal(publicIdFromUrl(base + 'wardrobe/user1/../user2/a.jpg', 'user1'), null);
  assert.equal(publicIdFromUrl(base + 'wardrobe/user1%2F..%2Fuser2/a.jpg', 'user1'), null);
  assert.equal(publicIdFromUrl(base + 'wardrobe/user1/a.jpg', ''), null);
  assert.equal(publicIdFromUrl(base + 'wardrobe/user1/a.jpg', null), null);
});

test('deleteImageByUrl without an owner never deletes', async () => {
  assert.equal(await deleteImageByUrl('https://res.cloudinary.com/demo/image/upload/v1/wardrobe/u/a.png'), false);
});
