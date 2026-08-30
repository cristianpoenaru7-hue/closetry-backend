require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const itemsRoutes = require('./routes/items.routes');
const generationRoutes = require('./routes/generation.routes');
const outfitsRoutes = require('./routes/outfits.routes');
const feedbackRoutes = require('./routes/feedback.routes');
const weatherRoutes = require('./routes/weather.routes');
const eventsRoutes = require('./routes/events.routes');
const smartClosetRoutes = require('./routes/smartCloset.routes');
const contactRoutes = require('./routes/contact.routes');
const usersRoutes = require('./routes/users.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { generalLimiter, authLimiter } = require('./middleware/rateLimits');

const app = express();

// Behind a reverse proxy/load balancer in production (Render, Railway,
// Fly.io, Heroku, etc.) — needed so express-rate-limit and req.ip see the
// real client IP from X-Forwarded-For instead of the proxy's.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS_ORIGIN unset = permissive (dev default). Set it to your actual
// web origin(s) in production if you ever add a web/admin client — the
// mobile app itself isn't subject to CORS (it's not a browser), so this
// mainly matters if a browser-based client gets added later.
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Serve dev-local uploaded photos. Replace with Cloudinary/S3 CDN URLs
// before launch (see 05-tech-stack-and-constraints.md).
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/generation', generationRoutes);
app.use('/api/outfits', outfitsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/smart-closet', smartClosetRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', usersRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Wardrobe backend listening on port ${PORT}`);
});

module.exports = app;
