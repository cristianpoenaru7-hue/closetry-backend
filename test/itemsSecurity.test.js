const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const calls = { count: [], deleted: [] };
let rows = [];
let classifyError = null;

const fakePrisma = {
  clothingItem: {
    async findFirst({ where }) { const r = rows.find((x) => x.id === where.id && x.userId === where.userId); return r ? { ...r } : null; },
    async count({ where }) {
      calls.count.push(where);
      return rows.filter((r) => r.imageUrl === where.imageUrl && (where.userId === undefined || r.userId === where.userId)).length;
    },
    async update({ where, data }) {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    async delete({ where }) { rows = rows.filter((r) => r.id !== where.id); },
  },
};

function stub(rel, exportsObj) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
stub('src/config/db.js', fakePrisma);
const realCloudinary = require('../src/config/cloudinary');
stub('src/config/cloudinary.js', { ...realCloudinary, deleteImageByUrl: async (url, userId) => { calls.deleted.push({ url, userId }); return true; } });
const { AnthropicConfigError } = require('../src/config/anthropic');
stub('src/services/classification.service.js', { classifyItemPhoto: async () => { throw classifyError; } });

const { updateItem, deleteItem, classifyItem } = require('../src/controllers/items.controller');

async function call(handler, req) {
  const out = {};
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    send() { return this; },
  };
  await handler(req, res, (e) => { throw e; });
  return out;
}

function reset(items) {
  rows = items;
  calls.count = [];
  calls.deleted = [];
}

test('deleting an item counts only the same user\'s items before removing the photo', async () => {
  reset([
    { id: 'i1', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' },
    { id: 'i2', userId: 'u2', imageUrl: 'https://x/wardrobe/u1/a.png' }, // another account pointing at the same URL
  ]);
  const res = await call(deleteItem, { params: { id: 'i1' }, userId: 'u1' });
  assert.equal(res.status, 204);
  assert.equal(calls.count[0].userId, 'u1');
  assert.deepEqual(calls.deleted, [{ url: 'https://x/wardrobe/u1/a.png', userId: 'u1' }]);
});

test('deleting an item keeps the photo while another item of the same user still uses it', async () => {
  reset([
    { id: 'i1', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' },
    { id: 'i2', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' },
  ]);
  await call(deleteItem, { params: { id: 'i1' }, userId: 'u1' });
  assert.equal(calls.deleted.length, 0);
});

test('PATCH with a new imageUrl deletes the old photo (own folder, via userId)', async () => {
  reset([{ id: 'i1', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/old.png', category: 'top' }]);
  const res = await call(updateItem, { params: { id: 'i1' }, userId: 'u1', body: { imageUrl: 'https://x/wardrobe/u1/new.png' } });
  assert.equal(res.body.item.imageUrl, 'https://x/wardrobe/u1/new.png');
  assert.deepEqual(calls.deleted, [{ url: 'https://x/wardrobe/u1/old.png', userId: 'u1' }]);
});

test('PATCH keeps the old photo when it is unchanged, or still used by another of the user\'s items', async () => {
  reset([{ id: 'i1', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' }]);
  await call(updateItem, { params: { id: 'i1' }, userId: 'u1', body: { color: 'red' } });
  await call(updateItem, { params: { id: 'i1' }, userId: 'u1', body: { imageUrl: 'https://x/wardrobe/u1/a.png' } });
  assert.equal(calls.deleted.length, 0);

  reset([
    { id: 'i1', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' },
    { id: 'i2', userId: 'u1', imageUrl: 'https://x/wardrobe/u1/a.png' },
  ]);
  await call(updateItem, { params: { id: 'i1' }, userId: 'u1', body: { imageUrl: 'https://x/wardrobe/u1/b.png' } });
  assert.equal(calls.deleted.length, 0);
});

test('deleteImageByUrl never touches another user\'s folder (publicIdFromUrl is scoped to the owner)', () => {
  assert.equal(realCloudinary.publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/v1/wardrobe/u2/a.png', 'u1'), null);
});

test('classify 503 does not reveal environment variable names', async () => {
  classifyError = new AnthropicConfigError();
  const realErr = console.error;
  console.error = () => {};
  try {
    const res = await call(classifyItem, { file: { buffer: Buffer.from('x'), mimetype: 'image/png' } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'This feature is temporarily unavailable. Please try again later.');
    assert.ok(!/ANTHROPIC|API_KEY|env/i.test(res.body.error));
  } finally {
    console.error = realErr;
  }
});
