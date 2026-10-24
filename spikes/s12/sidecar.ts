// vyred sidecar for the spike. Loopback HTTP only.
// GET /health and GET /v1/health return { ok, name: "vyred", pid }.
// GET / serves the web build when VYRE_WEB is set, so a shell can load that origin and reach /health.
// The Tauri shell spawns this (or the python copy under src-tauri/binaries) with VYRE_SIDECAR_PORT.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export type Health = { ok: true; name: "vyred"; pid: number };

export function healthBody(): Health {
  return { ok: true, name: "vyred", pid: process.pid };
}

function webIndex(webRoot: string, urlPath: string): string | null {
  if (!webRoot) return null;
  if (urlPath !== "/" && urlPath !== "/index.html") return null;
  const file = path.resolve(webRoot, "index.html");
  const root = path.resolve(webRoot);
  if (file !== path.join(root, "index.html")) return null;
  return fs.existsSync(file) ? file : null;
}

export function serve(port: number, webRoot: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
    const write = (status: number, type: string, body: Buffer): void => {
      res.writeHead(status, {
        "content-type": type,
        "content-length": String(body.length),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      res.end(body);
    };
    if (req.method === "GET" && (urlPath === "/health" || urlPath === "/v1/health")) {
      write(200, "application/json; charset=utf-8", Buffer.from(JSON.stringify(healthBody())));
      return;
    }
    if (req.method === "GET") {
      const file = webIndex(webRoot, urlPath);
      if (file) {
        write(200, "text/html; charset=utf-8", fs.readFileSync(file));
        return;
      }
    }
    write(404, "text/plain; charset=utf-8", Buffer.from("not found"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const chosen = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: chosen,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv.includes("--serve")) {
  const port = Number(process.env.VYRE_SIDECAR_PORT ?? "47211");
  const webRoot = process.env.VYRE_WEB ?? "";
  serve(port, webRoot)
    .then((listening) => {
      process.stdout.write(`LISTENING ${listening.port}\n`);
      if (process.env.VYRE_PORT_FILE) fs.writeFileSync(process.env.VYRE_PORT_FILE, String(listening.port));
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : "sidecar failed"}\n`);
      process.exit(1);
    });
}
