const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createOutfit, listOutfits, getOutfit, updateOutfit, deleteOutfit, logWorn,
} = require('../controllers/outfits.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', createOutfit);
router.get('/', listOutfits);
router.get('/:id', getOutfit);
router.patch('/:id', updateOutfit);
router.delete('/:id', deleteOutfit);
router.post('/:id/worn', logWorn);

module.exports = router;
