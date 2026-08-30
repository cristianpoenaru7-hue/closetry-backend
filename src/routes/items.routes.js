const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');
const { upload } = require('../config/upload');
const {
  listItems, getItem, createItem, updateItem, deleteItem, classifyItem,
} = require('../controllers/items.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', listItems);
router.get('/:id', getItem);
router.post('/classify', aiLimiter, upload.single('photo'), classifyItem);
router.post('/', upload.single('photo'), createItem);
router.patch('/:id', updateItem);
router.delete('/:id', deleteItem);

module.exports = router;
