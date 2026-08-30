const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createFeedback } = require('../controllers/feedback.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', createFeedback);

module.exports = router;
