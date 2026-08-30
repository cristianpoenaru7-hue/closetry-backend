const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');
const {
  createSession, listSessions, getSession, postMessage,
} = require('../controllers/generation.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/sessions', createSession);
router.get('/sessions', listSessions);
router.get('/sessions/:id', getSession);
router.post('/sessions/:id/messages', aiLimiter, postMessage);

module.exports = router;
