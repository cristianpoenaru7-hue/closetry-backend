const prisma = require('../config/db');
const { generateOutfits } = require('../services/generation.service');
const { deriveSeasonFromMonth } = require('./weather.controller');
const { fetchCurrentWeather, WeatherConfigError } = require('../config/weather');
const { sendUnavailable } = require('../utils/unavailable');
const { AnthropicConfigError } = require('../config/anthropic');

// Only try to attach real weather to a pre-generated outfit if the event
// is imminent — we only have a CURRENT-weather API (see config/weather.js),
// not a forecast one, so using "now's" weather for an event next month
// would be actively misleading. This is a simplification, documented, not
// a real forecast integration.
const WEATHER_LOOKAHEAD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function serializeEvent(event) {
  return event; // no hydration needed — Event has no itemIds/collection to join
}

// POST /api/events
// Body: { name, date (ISO string), occasionType, dressCode?, location? }
async function createEvent(req, res, next) {
  try {
    const { name, date, occasionType, dressCode, location } = req.body;
    if (!isNonEmptyString(name)) return res.status(400).json({ error: 'name is required' });
    if (!isNonEmptyString(occasionType)) return res.status(400).json({ error: 'occasionType is required' });

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return res.status(400).json({ error: 'date must be a valid date' });

    const event = await prisma.event.create({
      data: {
        userId: req.userId,
        name: name.trim(),
        date: parsedDate,
        occasionType: occasionType.trim(),
        dressCode: isNonEmptyString(dressCode) ? dressCode.trim() : null,
        location: isNonEmptyString(location) ? location.trim() : null,
      },
    });

    res.status(201).json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
}

// GET /api/events?upcoming=true — soonest first when `upcoming` is set
// (date >= now), otherwise every event, newest-date-first.
async function listEvents(req, res, next) {
  try {
    const { upcoming } = req.query;
    const where = {
      userId: req.userId,
      ...(upcoming === 'true' && { date: { gte: new Date() } }),
    };
    const events = await prisma.event.findMany({
      where,
      orderBy: { date: upcoming === 'true' ? 'asc' : 'desc' },
    });
    res.json({ events, count: events.length });
  } catch (err) {
    next(err);
  }
}

// GET /api/events/:id
async function getEvent(req, res, next) {
  try {
    const event = await prisma.event.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/events/:id
async function updateEvent(req, res, next) {
  try {
    const existing = await prisma.event.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const data = {};
    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name)) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = req.body.name.trim();
    }
    if (req.body.date !== undefined) {
      const parsedDate = new Date(req.body.date);
      if (Number.isNaN(parsedDate.getTime())) return res.status(400).json({ error: 'date must be a valid date' });
      data.date = parsedDate;
    }
    if (req.body.occasionType !== undefined) {
      if (!isNonEmptyString(req.body.occasionType)) return res.status(400).json({ error: 'occasionType cannot be empty' });
      data.occasionType = req.body.occasionType.trim();
    }
    if (req.body.dressCode !== undefined) {
      data.dressCode = req.body.dressCode === null ? null : String(req.body.dressCode).trim() || null;
    }
    if (req.body.location !== undefined) {
      data.location = req.body.location === null ? null : String(req.body.location).trim() || null;
    }
    if (req.body.linkedOutfitId !== undefined) {
      if (req.body.linkedOutfitId === null) {
        data.linkedOutfitId = null;
      } else {
        // Verify the outfit is actually the user's own before linking —
        // same ownership-check pattern used everywhere else.
        const outfit = await prisma.outfit.findFirst({
          where: { id: req.body.linkedOutfitId, userId: req.userId },
          select: { id: true },
        });
        if (!outfit) return res.status(400).json({ error: 'linkedOutfitId does not belong to an outfit you own' });
        data.linkedOutfitId = req.body.linkedOutfitId;
      }
    }

    const event = await prisma.event.update({ where: { id: existing.id }, data });
    res.json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/events/:id — real delete; does not touch a linked Outfit.
async function deleteEvent(req, res, next) {
  try {
    const existing = await prisma.event.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    await prisma.event.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// POST /api/events/:id/generate — Body: { lat?, lon? }
//
// One-shot outfit generation for this event: no GenerationSession is
// created (this is a separate entry point into the SAME generation
// service used by the Generate chat — see generation.service.js — not a
// parallel/duplicate implementation). contextSeason always comes from the
// event's own date (works for any future date); contextTemp/weather only
// gets attached when the event is within WEATHER_LOOKAHEAD_MS AND lat/lon
// were provided, since we only have current-weather, not a forecast API.
// What is stored on the event: conditions only. The place name OpenWeather
// returns is deliberately NOT kept (the privacy policy says location is not saved).
function toWeatherSnapshot(weather) {
  return { tempC: weather.tempC ?? null, condition: weather.condition ?? null, description: weather.description ?? null };
}

async function generateOutfitForEvent(req, res, next) {
  try {
    const event = await prisma.event.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const wardrobeItems = await prisma.clothingItem.findMany({
      where: { userId: req.userId, archived: false },
    });

    const contextSeason = deriveSeasonFromMonth(event.date);

    let contextTemp;
    let weatherCondition;
    let weatherSnapshot = null;
    const { lat, lon } = req.body;
    const isImminent = event.date.getTime() - Date.now() <= WEATHER_LOOKAHEAD_MS && event.date.getTime() - Date.now() >= -WEATHER_LOOKAHEAD_MS;
    if (isImminent && lat !== undefined && lon !== undefined) {
      try {
        const weather = await fetchCurrentWeather(Number(lat), Number(lon));
        contextTemp = weather.tempC ?? undefined;
        weatherCondition = weather.condition ?? undefined;
        weatherSnapshot = toWeatherSnapshot(weather);
      } catch (err) {
        // Weather is a nice-to-have here too — a misconfigured/unset
        // OPENWEATHER_API_KEY should not block event outfit generation.
        if (!(err instanceof WeatherConfigError)) console.warn(`Weather lookup failed for event ${event.id}: ${err.message}`);
      }
    }

    const occasionParts = [
      `Outfit for the event "${event.name}"`,
      `a ${event.occasionType}`,
      event.dressCode && `dress code: ${event.dressCode}`,
      event.location && `at ${event.location}`,
      `on ${event.date.toDateString()}`,
    ].filter(Boolean);
    const userText = occasionParts.join(', ') + '.';

    const { outfits, note } = await generateOutfits({
      wardrobeItems,
      sessionMessages: [],
      userText,
      contextSeason,
      contextTemp,
      weatherCondition,
    });

    // Best-effort: remember what weather we generated against, purely for
    // the user's own reference later (never read back into generation).
    if (weatherSnapshot) {
      await prisma.event.update({ where: { id: event.id }, data: { weatherSnapshot } }).catch(() => {});
    }

    res.json({ outfits, note, contextSeason, contextTemp: contextTemp ?? null });
  } catch (err) {
    if (err instanceof AnthropicConfigError) return sendUnavailable(res, err);
    next(err);
  }
}

module.exports = {
  createEvent, listEvents, getEvent, updateEvent, deleteEvent, generateOutfitForEvent, toWeatherSnapshot,
};
