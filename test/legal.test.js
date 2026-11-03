const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const legalRoutes = require('../src/routes/legal.routes');

// Boots just the legal router on an ephemeral port — requiring src/index.js
// would start the real server (and need a database), which these static pages don't.
async function withServer(fn) {
  const app = express();
  app.use(legalRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /privacy serves a complete policy page without a login', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/privacy`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    // The elements App Review guideline 5.1.1(i)/5.1.2(i) look for.
    for (const phrase of ['Anthropic', 'Delete account', 'How long we keep data', 'Withdraw consent', 'Terms of Use', 'Cloudinary', 'OpenWeather', 'Sign in with Apple', 'Google', 'provider user ID']) {
      assert.ok(html.includes(phrase), `privacy page should mention "${phrase}"`);
    }
    assert.ok(html.includes('Apple or Google if you signed up that way'), 'deletion row covers social accounts');
    assert.ok(!html.includes('{{'), 'no unreplaced template placeholders');
    assert.ok(!/Draft/i.test(html), 'no draft/placeholder marker left in the live policy');
  });
});

test('GET /support serves contact details and the deletion instructions', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/support`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /mailto:/);
    assert.ok(html.includes('Delete account'));
    assert.ok(!html.includes('{{'));
    assert.ok(!/Forgot password/.test(html), 'must not promise a self-service reset the app does not have');
  });
});

test('GET / is a human-readable landing page and /terms points at the policy', async () => {
  await withServer(async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Closetry/);

    const terms = await fetch(`${base}/terms`, { redirect: 'manual' });
    assert.equal(terms.status, 301);
    assert.equal(terms.headers.get('location'), '/privacy#terms');
  });
});
