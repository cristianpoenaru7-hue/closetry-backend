const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderPage } = require('../pages/layout');

// Public, login-free pages App Store Connect points at (Privacy Policy URL,
// Support URL) — and what a human sees if they open the API's own address.
// Served from this server rather than a separate host so there's one thing to
// keep alive: the app needs the API running anyway, and a policy link that
// 404s during review is an automatic rejection.
const router = express.Router();

const UPDATED = '30 October 2026';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.CONTACT_EMAIL_TO || 'cristianpoenaru7@gmail.com';

function load(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'pages', file), 'utf8')
    .replaceAll('{{SUPPORT_EMAIL}}', SUPPORT_EMAIL)
    .replaceAll('{{UPDATED}}', UPDATED);
}

// Read once at startup — these never change at runtime, and failing here (a
// missing file) is a loud boot error instead of a 500 on first request.
const pages = {
  home: renderPage({
    title: 'Closetry — AI wardrobe & outfit stylist',
    description: 'Closetry is a digital wardrobe and AI outfit stylist for iPhone.',
    body: load('home.html'),
  }),
  privacy: renderPage({
    title: 'Closetry — Privacy Policy & Terms of Use',
    description: 'What Closetry collects, why, who it is shared with, how long it is kept, and your choices.',
    body: load('privacy.html'),
  }),
  support: renderPage({
    title: 'Closetry — Support',
    description: 'Get help with Closetry, delete your account, or contact us.',
    body: load('support.html'),
  }),
};

router.get('/', (req, res) => res.type('html').send(pages.home));
router.get('/privacy', (req, res) => res.type('html').send(pages.privacy));
router.get('/terms', (req, res) => res.redirect(301, '/privacy#terms'));
router.get('/support', (req, res) => res.type('html').send(pages.support));

module.exports = router;
