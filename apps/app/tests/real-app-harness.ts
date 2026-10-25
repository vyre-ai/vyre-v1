// The booted-daemon harness shared by the real-app e2e test and the real-app screenshots (scripts/shots/real-app.mjs): the daemon as a person starts it on a copy of the frozen core seed, the app's
// web export on one origin with the gateway and the live socket proxied to the daemon (the production shape: no CORS), and the owner bootstrap session a signed-in browser carries.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SPACE, bootCore } from "../../../fixtures/seed/core/index.ts";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));

/** Which module each step needs, and the packet that flips it (docs/lanes: L7 identity/spaces, L2 chat, L3 records, L4 files). */
export const STEP_NEEDS: Record<string, { modules: string[]; packet: string }> = {
  "sign in": { modules: ["identity", "spaces", "devices"], packet: "P-L7_LIVE" },
  "home": { modules: ["home", "tasks"], packet: "P-L6_LIVE" },
  "chats": { modules: ["chat"], packet: "P-L2_LIVE" },
  "records": { modules: ["records"], packet: "P-L3_LIVE" },
  "files": { modules: ["files"], packet: "P-L4_LIVE" },
};

export function liveModules(root = REPO): Set<string> {
  const list = JSON.parse(fs.readFileSync(path.join(root, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  return new Set(list.modules.filter((m) => m.status === "live").map((m) => m.id));
}

/** Null when every module the step needs is live; else the TODO line naming what is missing and who flips it. */
export function todoFor(step: string, live: Set<string>): string | null {
  const need = STEP_NEEDS[step];
  if (!need) throw new Error(`unknown step ${step}`);
  const missing = need.modules.filter((m) => !live.has(m));
  return missing.length === 0 ? null : `${step}: ${missing.join(", ")} still a stub in host/modules.json (live with ${need.packet})`;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".ttf": "font/ttf" };

export interface Edge { origin: string; close(): void }

/** The app's export on one origin, with the gateway (/v1, /sync, /healthz) and the live socket (/live) passed through to the daemon. */
export function edge(dist: string, daemonUrl: string): Promise<Edge> {
  const target = new URL(daemonUrl);
  const base = path.resolve(dist);
  const proxied = (p: string): boolean => p.startsWith("/v1/") || p.startsWith("/sync/") || p === "/healthz" || p.startsWith("/live");
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://edge");
    if (proxied(u.pathname)) {
      const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      up.on("error", () => { res.writeHead(502); res.end("daemon unreachable"); });
      req.pipe(up);
      return;
    }
    const p = decodeURIComponent(u.pathname);
    const cands = [p, `${p}.html`, path.join(p, "index.html")].map((c) => path.join(base, c));
    let file = cands.find((c) => c.startsWith(base) && fs.existsSync(c) && fs.statSync(c).isFile());
    if (!file) file = path.join(base, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.on("upgrade", (req, socket, head) => {
    const up = net.connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, close: () => server.close() })));
}

const ADMIN_TOKEN = "e2e-owner-bootstrap-token";

export interface Space { url: string; token: string; space: string; dir: string; stop(): Promise<void> }

/** The daemon as a person starts it (`node host/src/daemon/main.ts`), on a copy of the frozen core seed. The app tests may not import host, so it runs as its own process. */
export async function bootSpace(): Promise<Space> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-real-app-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const child: ChildProcess = spawn(process.execPath, ["host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--space", CORE_SPACE, "--port", "0"], {
    cwd: REPO, env: { ...process.env, VYRE_ADMIN_TOKEN: ADMIN_TOKEN }, stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`the daemon did not start in 30 s: ${out}`)), 30_000);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      const m = /listening on (http\S+)/.exec(out);
      if (m?.[1]) { clearTimeout(timer); resolve(m[1]); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`the daemon exited with ${String(code)}: ${out}`)); });
  });
  return {
    url, token: ADMIN_TOKEN, space: CORE_SPACE, dir,
    stop: () => new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000).unref(); }),
  };
}


/** What a browser holds once signed in as the owner of this Space (the owner bootstrap token, the same door the CLI and the Console use). */
export function ownerSession(space: Space, origin: string): { baseUrl: string; token: string; def: Record<string, unknown>; personId: string } {
  const def = { spaceId: space.space, name: "Space", kind: "team", address: origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} };
  return { baseUrl: origin, token: space.token, def, personId: "owner" };
}
