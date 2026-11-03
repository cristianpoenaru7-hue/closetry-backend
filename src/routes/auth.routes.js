const express = require('express');
const { register, login, me } = require('../controllers/auth.controller');
const { apple, google } = require('../controllers/social.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/apple', apple);
router.post('/google', google);
router.get('/me', requireAuth, me);

module.exports = router;
