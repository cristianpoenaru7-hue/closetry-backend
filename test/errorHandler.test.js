const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/middleware/errorHandler');

// Minimal stand-in for an Express response: records status + JSON body.
function run(err) {
  const out = {};
  const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
  const realError = console.error;
  console.error = () => {}; // the handler logs every error; keep test output clean
  try { errorHandler(err, {}, res, () => {}); } finally { console.error = realError; }
  return out;
}

test('an unexpected server error never leaks its message to the client', () => {
  const { status, body } = run(new Error('Anthropic API returned 529: {"type":"overloaded_error"} SELECT * FROM "User"'));
  assert.equal(status, 500);
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
});

test('a deliberate 4xx error keeps its user-facing message', () => {
  const err = new Error('Only JPEG, PNG or WEBP images are allowed');
  err.status = 400;
  const { status, body } = run(err);
  assert.equal(status, 400);
  assert.equal(body.error, 'Only JPEG, PNG or WEBP images are allowed');
});

test('multer size errors become a 413 with a plain message', () => {
  const err = new Error('File too large');
  err.name = 'MulterError';
  err.code = 'LIMIT_FILE_SIZE';
  const { status, body } = run(err);
  assert.equal(status, 413);
  assert.match(body.error, /too large/);
});

test('prisma unique and not-found errors keep their existing mapping', () => {
  assert.equal(run({ code: 'P2002', meta: { target: ['email'] } }).status, 409);
  assert.equal(run({ code: 'P2025' }).status, 404);
});
