// Thin wrapper around OpenWeatherMap's current-weather endpoint (free
// tier). See 05-tech-stack-and-constraints.md — confirm current pricing
// before scale, this was chosen for MVP-scale usage.

const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';

class WeatherConfigError extends Error {}

async function fetchCurrentWeather(lat, lon) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new WeatherConfigError(
      'OPENWEATHER_API_KEY is not set — add it to .env before using weather-based generation.'
    );
  }

  const url = `${OPENWEATHER_URL}?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenWeatherMap returned ${res.status}: ${text || 'no details'}`);
  }

  const data = await res.json();
  return {
    tempC: typeof data.main?.temp === 'number' ? data.main.temp : null,
    condition: data.weather?.[0]?.main || null, // e.g. "Rain", "Clear", "Snow"
    description: data.weather?.[0]?.description || null,
    locationName: data.name || null,
  };
}

module.exports = { fetchCurrentWeather, WeatherConfigError };
