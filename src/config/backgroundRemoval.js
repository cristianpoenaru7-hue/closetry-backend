const BG_REMOVAL_URL = process.env.BG_REMOVAL_URL || 'http://localhost:5001';

// Calls our own local Python microservice (rembg + u2net — see
// /bg-removal-service in this repo). Runs entirely on infrastructure you
// control: no external API, no account, no per-image cost, no data
// leaving the machine it runs on.
async function removeBackground(buffer, filename = 'photo.jpg', mimetype = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);

  // A slow or cold-starting service times out into the caller's existing
  // "save the original photo instead" fallback rather than hanging the upload.
  const res = await fetch(`${BG_REMOVAL_URL}/remove-background`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(Number(process.env.BG_REMOVAL_TIMEOUT_MS) || 60000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Background removal service returned ${res.status}: ${text || 'no details'}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { removeBackground, BG_REMOVAL_URL };
