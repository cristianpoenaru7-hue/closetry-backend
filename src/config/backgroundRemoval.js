const BG_REMOVAL_URL = process.env.BG_REMOVAL_URL || 'http://localhost:5001';

// Calls our own local Python microservice (rembg + u2net — see
// /bg-removal-service in this repo). Runs entirely on infrastructure you
// control: no external API, no account, no per-image cost, no data
// leaving the machine it runs on.
async function removeBackground(buffer, filename = 'photo.jpg', mimetype = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);

  const res = await fetch(`${BG_REMOVAL_URL}/remove-background`, { method: 'POST', body: form });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Background removal service returned ${res.status}: ${text || 'no details'}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { removeBackground, BG_REMOVAL_URL };
