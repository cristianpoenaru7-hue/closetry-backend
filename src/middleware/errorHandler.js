// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);

  // Prisma unique constraint violation (e.g. duplicate email)
  if (err.code === 'P2002') {
    return res.status(409).json({ error: `${err.meta?.target?.join(', ') || 'field'} already in use` });
  }

  // Prisma "record not found"
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  // multer (photo uploads): a too-large or malformed upload is the
  // client's problem, not a server fault — say so instead of a bare 500.
  if (err.name === 'MulterError') {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'That photo is too large (8 MB max).' : err.message });
  }

  const status = err.status || 500;
  // An unexpected server error's own message can carry internals — SQL
  // fragments, an upstream API's raw response body — none of which belongs
  // in a response the app displays to the user. It's already in the log
  // above; the client gets a plain sentence instead. 4xx errors are ones we
  // deliberately raised with a user-facing message, so those pass through.
  const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message || 'Request failed';
  // Optional machine-readable code that a client can branch on (4xx only).
  const body = { error: message };
  if (status < 500 && typeof err.clientCode === 'string') body.code = err.clientCode;
  res.status(status).json(body);
}

module.exports = { errorHandler };
