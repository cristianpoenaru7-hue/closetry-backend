const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');
const {
  createEvent, listEvents, getEvent, updateEvent, deleteEvent, generateOutfitForEvent,
} = require('../controllers/events.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', createEvent);
router.get('/', listEvents);
router.get('/:id', getEvent);
router.patch('/:id', updateEvent);
router.delete('/:id', deleteEvent);
router.post('/:id/generate', aiLimiter, generateOutfitForEvent);

module.exports = router;
