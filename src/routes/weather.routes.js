const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getCurrentWeather } = require('../controllers/weather.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', getCurrentWeather);

module.exports = router;
