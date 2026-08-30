const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../config/upload');
const { updateMe, uploadAvatar, changePassword, deleteMe } = require('../controllers/users.controller');

const router = express.Router();

router.use(requireAuth);

router.patch('/me', updateMe);
router.post('/me/avatar', upload.single('photo'), uploadAvatar);
router.post('/me/password', changePassword);
router.delete('/me', deleteMe);

module.exports = router;
