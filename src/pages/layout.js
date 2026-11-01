// Shared page shell for the public legal/support pages (privacy, support,
// landing). Deliberately dependency-free and self-contained: system fonts, one
// inline stylesheet, no scripts, no external requests — a privacy policy page
// shouldn't itself phone home to a font CDN, and App Review opens these URLs
// cold, without a login.
const CSS = `
:root{--bg:#F7F5F0;--panel:#FFFFFF;--ink:#1B1915;--muted:#5F5A50;--line:#DDD6C6;--accent:#7A5F0E}
@media (prefers-color-scheme: dark){:root{--bg:#14120F;--panel:#1D1A15;--ink:#EDE6D8;--muted:#A39B8D;--line:#332E26;--accent:#E8CD6B}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:720px;margin:0 auto;padding:56px 22px 72px}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:clamp(30px,6vw,42px);line-height:1.12;margin:10px 0 14px;color:var(--ink)}
h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:22px;line-height:1.25;margin:42px 0 10px;color:var(--ink)}
h3{font-size:15px;margin:22px 0 4px;color:var(--ink)}
p,li{color:var(--muted)}
p{margin:0 0 12px}
ul{padding-left:20px;margin:0 0 12px}
li{margin:0 0 6px}
a{color:var(--accent)}
strong{color:var(--ink);font-weight:600}
.eyebrow{font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0}
.lede{font-size:17px;max-width:62ch}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:26px 0}
.card h2{margin-top:0;font-size:18px}
.card p:last-child,.card ul:last-child{margin-bottom:0}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14.5px}
th,td{text-align:left;vertical-align:top;padding:10px;border-top:1px solid var(--line);color:var(--muted)}
th{color:var(--ink);font-weight:600}
nav a{display:inline-block;margin:0 16px 8px 0}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
footer a{margin-right:14px}
@media (max-width:560px){tr{display:block;border-top:1px solid var(--line);padding:10px 0}th,td{display:block;border:0;padding:2px 0}}
`;

function renderPage({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${description}">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">
${body}
<footer>
  <a href="/privacy">Privacy Policy</a><a href="/privacy#terms">Terms of Use</a><a href="/support">Support</a>
  <p>© 2026 Cristian Poenaru · Closetry</p>
</footer>
</div>
</body>
</html>`;
}

module.exports = { renderPage };
