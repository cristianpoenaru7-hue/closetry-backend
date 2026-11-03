const prisma = require('../config/db');
const { verifyToken } = require('../utils/authUtils');

// Verifies the bearer token, then checks the account in the database:
// - the user must still exist (a deleted account's token stops working at once);
// - if the account's password was disabled (passwordDisabledAt, set when a
//   Sign in with Apple/Google identity is linked to an email account), any
//   token issued before that moment is rejected, so a previous holder of the
//   password cannot keep a session. Accounts with passwordDisabledAt = null
//   (all password accounts) are unaffected.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { passwordDisabledAt: true } });
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    if (user.passwordDisabledAt && !(payload.iat >= Math.floor(user.passwordDisabledAt.getTime() / 1000))) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = payload.sub;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
