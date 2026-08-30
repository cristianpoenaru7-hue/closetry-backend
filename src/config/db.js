const { PrismaClient } = require('@prisma/client');

// Singleton so we don't open a new connection pool per request/hot-reload.
const prisma = new PrismaClient();

module.exports = prisma;
