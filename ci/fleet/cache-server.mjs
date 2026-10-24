// Fleet cache server: content-addressed blobs over HTTP, one per host, stored under CACHE_DIR.
//   CACHE_DIR=/var/lib/ci-run/cache-server PORT=7791 HOST=0.0.0.0 node ci/fleet/cache-server.mjs
// GET /k/<key> returns the blob or 404, PUT /k/<key> stores it (first write wins, 409 after), GET /health. Keys are [a-f0-9]{8,64}.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const KEY = /^[a-f0-9]{8,64}$/;

export function createServer(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/health") { res.writeHead(200).end("ok"); return; }
    const m = /^\/k\/([^/]+)$/.exec(u.pathname);
    if (!m || !KEY.test(m[1])) { res.writeHead(400).end("bad key"); return; }
    const file = path.join(dir, m[1]);
    if (req.method === "GET") {
      if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-length": fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
    } else if (req.method === "PUT") {
      if (fs.existsSync(file)) { req.resume(); res.writeHead(409).end("exists"); return; }
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      const out = fs.createWriteStream(tmp);
      req.pipe(out);
      out.on("finish", () => { fs.renameSync(tmp, file); res.writeHead(201).end(); });
      out.on("error", () => { fs.rmSync(tmp, { force: true }); res.writeHead(500).end(); });
    } else res.writeHead(405).end();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  createServer(process.env.CACHE_DIR ?? "/var/lib/ci-run/cache-server").listen(Number(process.env.PORT ?? 7791), process.env.HOST ?? "127.0.0.1");
}
