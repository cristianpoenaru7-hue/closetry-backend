const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { contactLimiter } = require('../middleware/rateLimits');
const { submitContact } = require('../controllers/contact.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', contactLimiter, submitContact);

module.exports = router;
