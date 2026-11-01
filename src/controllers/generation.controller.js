const prisma = require('../config/db');
const { generateOutfits } = require('../services/generation.service');
const { sendUnavailable } = require('../utils/unavailable');
const { AnthropicConfigError } = require('../config/anthropic');

const SEASONS = ['spring', 'summer', 'fall', 'winter', 'all'];

// POST /api/generation/sessions
async function createSession(req, res, next) {
  try {
    const session = await prisma.generationSession.create({
      data: { userId: req.userId, messages: [] },
    });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
}

// GET /api/generation/sessions — newest first; enough for a simple
// "resume last chat" client behavior. Full session-history UI is Phase 3.
async function listSessions(req, res, next) {
  try {
    const sessions = await prisma.generationSession.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
}

// GET /api/generation/sessions/:id
async function getSession(req, res, next) {
  try {
    const session = await prisma.generationSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

// POST /api/generation/sessions/:id/messages
// Body: { content: string, contextSeason?, contextTemp?: number (°C), weatherCondition?: string }
//
// contextSeason/contextTemp/weatherCondition are all optional — the
// mobile client only sends them once it's successfully fetched weather
// (GET /api/weather), and generation works exactly as it did in Phase 2
// when they're omitted (e.g. weather permission denied, or the
// OPENWEATHER_API_KEY isn't configured).
async function postMessage(req, res, next) {
  try {
    const { content, contextSeason, contextTemp, weatherCondition, relaxed } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (contextSeason !== undefined && !SEASONS.includes(contextSeason)) {
      return res.status(400).json({ error: `contextSeason must be one of: ${SEASONS.join(', ')}` });
    }
    if (contextTemp !== undefined && (typeof contextTemp !== 'number' || Number.isNaN(contextTemp))) {
      return res.status(400).json({ error: 'contextTemp must be a number (°C)' });
    }

    const session = await prisma.generationSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Only non-archived items are eligible — an archived item isn't really
    // "in the closet" right now.
    const wardrobeItems = await prisma.clothingItem.findMany({
      where: { userId: req.userId, archived: false },
    });

    const existingMessages = Array.isArray(session.messages) ? session.messages : [];
    const userMessage = { role: 'user', content: content.trim(), createdAt: new Date().toISOString() };

    const { outfits, note, canRetryRelaxed } = await generateOutfits({
      wardrobeItems,
      sessionMessages: existingMessages,
      userText: content.trim(),
      contextSeason,
      contextTemp,
      weatherCondition,
      relaxed: relaxed === true,
    });

    // Stored form stays compact (ids + text, no hydrated item objects) —
    // hydration happens fresh from the live wardrobe on every read/replay
    // so edits/deletes to items are always reflected, and so the JSON
    // column doesn't duplicate item data that can go stale. canRetryRelaxed
    // isn't persisted — it's only meaningful for the client rendering the
    // message the instant it arrives, not on session replay later.
    const assistantMessageForStorage = {
      role: 'assistant',
      content: {
        outfits: outfits.map((o) => ({ itemIds: o.itemIds, rationale: o.rationale, warning: o.warning })),
        note,
      },
      createdAt: new Date().toISOString(),
    };

    const updatedMessages = [...existingMessages, userMessage, assistantMessageForStorage];

    const updatedSession = await prisma.generationSession.update({
      where: { id: session.id },
      data: { messages: updatedMessages },
    });

    res.json({
      session: { id: updatedSession.id, updatedAt: updatedSession.updatedAt },
      // Response is hydrated (full item objects) for the client to render
      // thumbnails immediately, unlike the compact stored form above.
      message: { role: 'assistant', content: { outfits, note, canRetryRelaxed }, createdAt: assistantMessageForStorage.createdAt },
    });
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return sendUnavailable(res, err);
    }
    next(err);
  }
}

module.exports = { createSession, listSessions, getSession, postMessage };
