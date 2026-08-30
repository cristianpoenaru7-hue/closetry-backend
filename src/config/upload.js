const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || 'uploads';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Memory storage (not disk) — we need the raw buffer to forward to
// Cloudinary. If Cloudinary isn't configured yet, saveLocalFallback()
// below writes that same buffer to disk instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

// DEV-ONLY fallback for when CLOUDINARY_* env vars aren't set — keeps the
// app usable (without background removal) before Cloudinary is wired up.
// Not meant for production use (see 05-tech-stack-and-constraints.md).
async function saveLocalFallback(buffer, originalname, userId) {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const ext = path.extname(originalname || '') || '.jpg';
  const filename = `${userId}-${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

module.exports = { upload, uploadDir, saveLocalFallback };
