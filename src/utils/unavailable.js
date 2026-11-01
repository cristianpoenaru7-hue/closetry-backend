// 503 for "this feature isn't configured on the server" (missing API key etc.).
// The client gets a generic sentence in the usual { error } shape; the real
// reason, which can name an environment variable, only goes to the log.
const UNAVAILABLE_MESSAGE = 'This feature is temporarily unavailable. Please try again later.';

function sendUnavailable(res, err) {
  console.error(`Feature unavailable: ${err.message}`);
  return res.status(503).json({ error: UNAVAILABLE_MESSAGE });
}

module.exports = { UNAVAILABLE_MESSAGE, sendUnavailable };
