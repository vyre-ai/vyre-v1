// The process: settings, the signing key, the stores, an HTTP server on node:http, and a minute-by-minute retry of what could not be finished.
// Run with `node apps/reports/src/main.ts`. Outward HTTP (GitHub, the team Space, a Space's webhook) goes through one function, the platform's own.

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { base64url, fromBase64url, generateSigningKey, loadSigningKey } from "./crypto.ts";
import type { SigningKey } from "./crypto.ts";
import { loadConfig } from "./config.ts";
import { createService } from "./service.ts";
import type { Req } from "./service.ts";
import { MAX_BODY } from "./bundle.ts";
import { DirObjectStore, FileDb } from "./store.ts";
import type { HttpLike } from "./github.ts";

async function signingKey(dataDir: string): Promise<SigningKey> {
  const path = join(dataDir, "signing-key.json");
  try {
    const j = JSON.parse(await readFile(path, "utf8")) as { pkcs8?: unknown };
    if (typeof j.pkcs8 === "string") return await loadSigningKey(fromBase64url(j.pkcs8));
  } catch { /* none yet */ }
  const key = await generateSigningKey();
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, JSON.stringify({ pkcs8: base64url(key.pkcs8) }), { mode: 0o600 });
  return key;
}

export interface Running { port: number; close(): Promise<void>; retry(): Promise<number> }

export async function start(env: Record<string, string | undefined>, o: { outbound?: HttpLike; retryMs?: number } = {}): Promise<Running> {
  const s = loadConfig(env);
  const outbound: HttpLike = o.outbound ?? (globalThis.fetch.bind(globalThis) as unknown as HttpLike);
  const service = createService(s.config, {
    db: await FileDb.open(join(s.dataDir, "reports.json")),
    objects: new DirObjectStore(join(s.dataDir, "objects")),
    outbound, now: Date.now, random: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), key: await signingKey(s.dataDir),
  });
  const server = createServer((req, res) => {
    const chunks: Uint8Array[] = [];
    let size = 0, tooBig = false;
    req.on("data", (c: Uint8Array) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://service.invalid");
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      const forwarded = s.trustProxy ? (headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "";
      const body = new Uint8Array(size > MAX_BODY ? 0 : size);
      let at = 0;
      for (const c of tooBig ? [] : chunks) { body.set(c, at); at += c.length; }
      const r: Req = { method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body: tooBig ? new Uint8Array(MAX_BODY + 1) : body, ip: forwarded || req.socket.remoteAddress || "unknown" };
      service.handle(r).then((out) => {
        res.writeHead(out.status, out.headers);
        res.end(typeof out.body === "string" ? out.body : out.body);
      }, () => { res.writeHead(500); res.end(); });
    });
  });
  await new Promise<void>((resolve) => server.listen(s.port, resolve));
  const timer = setInterval(() => { service.retryPending().catch(() => {}); }, o.retryMs ?? 60_000);
  timer.unref();
  const addr = server.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : s.port,
    retry: () => service.retryPending(),
    close: () => new Promise<void>((resolve) => { clearInterval(timer); server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

if (import.meta.main) {
  start(process.env).then((r) => console.log(`reports listening on ${r.port}`), (e: Error) => { console.error(`reports: ${e.message}`); process.exit(1); });
}
