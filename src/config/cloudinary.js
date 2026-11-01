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

// Everything we upload lives under "wardrobe/<userId>/" (see uploadImage), so
// a delivery URL maps back to its public ID by anchoring on that folder. A
// URL that doesn't contain it — a local /uploads path, someone else's CDN —
// yields null, which means callers skip the delete instead of ever pointing
// the Admin API at an asset that isn't ours. When `userId` is given, the
// public ID must also sit under "wardrobe/<userId>/", so a URL pointing at
// another user's photo is never treated as ours (items accept an imageUrl
// from the request body).
function publicIdFromUrl(url, userId) {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return null;
  const segments = url.split('/upload/')[1].split('?')[0].split('/');
  const start = segments.indexOf('wardrobe');
  if (start === -1 || start === segments.length - 1) return null;
  const idSegments = segments.slice(start);
  idSegments[idSegments.length - 1] = idSegments[idSegments.length - 1].replace(/\.[^./]+$/, ''); // drop the file extension
  let publicId;
  try {
    publicId = decodeURIComponent(idSegments.join('/'));
  } catch {
    return null;
  }
  if (userId !== undefined) {
    if (!userId || publicId.split('/').includes('..') || !publicId.startsWith(`wardrobe/${userId}/`)) return null;
  }
  return publicId;
}

// Best-effort by design: the database row is already gone by the time this
// runs (the user's deletion is real either way), so a Cloudinary hiccup is
// logged for manual cleanup rather than turned into a failed request.
async function deleteImageByUrl(url, userId) {
  if (!isConfigured) return false;
  const publicId = publicIdFromUrl(url, userId || ''); // no owner given: never delete
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    return true;
  } catch (err) {
    console.error(`Cloudinary: could not delete ${publicId}: ${err.message}`);
    return false;
  }
}

// Account deletion: removes every photo the user ever uploaded (item photos
// and the profile picture share the same per-user folder). The Admin API
// removes up to 1000 resources per call and reports `partial` while more
// remain, hence the loop — capped so a misbehaving response can't spin.
async function deleteUserImages(userId) {
  if (!isConfigured) return;
  try {
    for (let i = 0; i < 20; i++) {
      const res = await cloudinary.api.delete_resources_by_prefix(`wardrobe/${userId}/`, { invalidate: true });
      if (!res.partial) break;
    }
    await cloudinary.api.delete_folder(`wardrobe/${userId}`).catch(() => {}); // empty-folder tidy-up; the images are what matter
  } catch (err) {
    console.error(`Cloudinary: could not fully delete images for user ${userId}: ${err.message}`);
  }
}

module.exports = { isConfigured, uploadImage, optimizeDeliveryUrl, publicIdFromUrl, deleteImageByUrl, deleteUserImages };
