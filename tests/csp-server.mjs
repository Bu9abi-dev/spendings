// Serves docs/ with the same headers Vercel adds (docs/vercel.json), so tests can check the app under its real
// Content-Security-Policy. Run on its own: node tests/csp-server.mjs [port]  (default 8766), or import serve().
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers;
// Vercel's source patterns here are "/sw.js" and "/(.*)"
const matches = (src, p) => (src === '/(.*)' ? true : src === p);
export const headersFor = (p) => Object.fromEntries(rules.filter((r) => matches(r.source, p)).flatMap((r) => r.headers.map((h) => [h.key, h.value])));

export function serve(port = 8766) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...headersFor(p) });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 8766;
  serve(port).then(() => console.log(`docs/ with Vercel's headers on http://localhost:${port}`));
}
