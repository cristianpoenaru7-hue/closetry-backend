const prisma = require('../config/db');
const { sendContactEmail, EmailConfigError } = require('../config/email');

const MAX_MESSAGE_LENGTH = 5000;

// POST /api/contact — Body: { subject?: string, message: string }
//
// Requires auth (not an anonymous form) so the sender is always a real
// account, not a bot — the user's own name/email from the DB is used as
// the "From" identity, never something the client can spoof by passing
// arbitrary values in the body.
async function submitContact(req, res, next) {
  try {
    const { subject, message } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true, email: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await sendContactEmail({
      fromName: user.name,
      fromEmail: user.email,
      subject: typeof subject === 'string' ? subject.trim().slice(0, 200) : undefined,
      message: message.trim(),
    });

    res.json({ sent: true });
  } catch (err) {
    if (err instanceof EmailConfigError) return res.status(503).json({ error: err.message });
    next(err);
  }
}

module.exports = { submitContact };
