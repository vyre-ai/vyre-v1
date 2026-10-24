// Tiny static server for the Expo web export (single-page fallback) and for the prototype copy.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".ico": "image/x-icon" };

export function serve(root, { spa = false } = {}) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const cands = [p, p + ".html", path.join(p, "index.html")].map((c) => path.join(base, c));
    let file = cands.find((c) => c.startsWith(base) && fs.existsSync(c) && fs.statSync(c).isFile());
    if (!file && spa) file = path.join(base, "index.html");
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
