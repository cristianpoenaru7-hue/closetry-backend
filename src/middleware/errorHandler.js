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

  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = { errorHandler };
