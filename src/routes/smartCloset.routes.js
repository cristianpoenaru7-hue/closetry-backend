const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSmartCloset, dismissInsight } = require('../controllers/smartCloset.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', getSmartCloset);
router.post('/:id/dismiss', dismissInsight);

module.exports = router;
