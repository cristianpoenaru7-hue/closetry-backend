const { sendUnavailable } = require('../utils/unavailable');
const { fetchCurrentWeather, WeatherConfigError } = require('../config/weather');

// Season is derived from the calendar month, NOT from temperature —
// temperature is noisy day-to-day (a warm February afternoon shouldn't
// suddenly filter the wardrobe as "spring"), while the actual calendar
// season is what ClothingItem.season is meant to represent. Northern
// hemisphere is assumed as a simplification; there's no user-location
// hemisphere detection here yet. Revisit if this app gets real usage in
// the southern hemisphere.
function deriveSeasonFromMonth(date = new Date()) {
  const month = date.getMonth(); // 0 = January
  if ([2, 3, 4].includes(month)) return 'spring';
  if ([5, 6, 7].includes(month)) return 'summer';
  if ([8, 9, 10].includes(month)) return 'fall';
  return 'winter'; // 11, 0, 1
}

// GET /api/weather?lat=&lon=
async function getCurrentWeather(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!req.query.lat || !req.query.lon || Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon query params are required numbers' });
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'lat/lon out of range' });
    }

    const weather = await fetchCurrentWeather(lat, lon);
    res.json({ ...weather, season: deriveSeasonFromMonth() });
  } catch (err) {
    if (err instanceof WeatherConfigError) return sendUnavailable(res, err);
    next(err);
  }
}

module.exports = { getCurrentWeather, deriveSeasonFromMonth };
