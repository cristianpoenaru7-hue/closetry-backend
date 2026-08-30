const cloudinary = require('cloudinary').v2;

// Cloudinary is now used only as image storage/CDN — background removal
// happens locally via bg-removal-service before the buffer ever gets
// here, so this no longer needs the paid "AI Background Removal" add-on.
const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function uploadImage(buffer, { userId }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `wardrobe/${userId}`, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// Rewrites a Cloudinary secure_url to request an optimized delivery
// variant instead of the raw upload — f_auto picks the best format per
// client (WebP/AVIF where supported), q_auto picks a quality level with
// no visible loss, and the width cap matters because phone camera photos
// routinely come in at 3000-4000px while nothing in this app ever
// displays an item photo anywhere near that size. This is a URL rewrite,
// not a re-upload — Cloudinary generates/caches the transformed version
// on first request, the original is untouched on their end.
function optimizeDeliveryUrl(secureUrl, { width = 1200 } = {}) {
  if (!secureUrl || !secureUrl.includes('/upload/')) return secureUrl;
  return secureUrl.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
}

module.exports = { isConfigured, uploadImage, optimizeDeliveryUrl };
