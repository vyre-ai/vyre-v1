// The booted-daemon harness shared by the real-app e2e test and the real-app screenshots (scripts/shots/real-app.mjs): the daemon as a person starts it on a copy of the frozen core seed, the app's
// web export on one origin with the gateway and the live socket proxied to the daemon (the production shape: no CORS), and the owner bootstrap session a signed-in browser carries.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
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
  "inbox": { modules: ["inbox"], packet: "P-L5_LIVE" },
  "apps": { modules: ["sites", "forms", "campaigns"], packet: "P-L8_LIVE" },
  "automations": { modules: ["automations"], packet: "P-L3_LIVE" },
  "vault": { modules: ["vault"], packet: "P-L7_LIVE" },
  "settings": { modules: ["settings"], packet: "P-L7_LIVE" },
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
export function edge(dist: string, daemonUrl: string, tls?: { key: string; cert: string }): Promise<Edge> {
  const target = new URL(daemonUrl);
  const base = path.resolve(dist);
  const proxied = (p: string): boolean => p.startsWith("/v1/") || p.startsWith("/sync/") || p === "/healthz" || p.startsWith("/live") || p.startsWith("/local/vault/key/");
  const handle: http.RequestListener = (req, res) => {
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
  };
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `${tls ? "https" : "http"}://127.0.0.1:${(server.address() as net.AddressInfo).port}`, close: () => server.close() })));
}

const ADMIN_TOKEN = "e2e-owner-bootstrap-token";

export interface Space { url: string; token: string; space: string; dir: string; stop(): Promise<void>; /** The one-time owner claim link the daemon printed (fresh installs only), or null. */ claim: string | null }

const stopper = (child: ChildProcess): (() => Promise<void>) => () => new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000).unref(); });

/** Starts the daemon as a person does and reads the address it prints (and, on a fresh install, the claim link it prints right after). */
async function startDaemon(dir: string, extra: string[]): Promise<{ child: ChildProcess; url: string; claim: string | null }> {
  const child: ChildProcess = spawn(process.execPath, ["host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--port", "0", ...extra], {
    cwd: REPO, env: { ...process.env, VYRE_ADMIN_TOKEN: ADMIN_TOKEN }, stdio: ["ignore", "pipe", "inherit"],
  });
  const printed = await new Promise<{ url: string; claim: string | null }>((resolve, reject) => {
    let out = "";
    let url: string | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => reject(new Error(`the daemon did not start in 30 s: ${out}`)), 30_000);
    const done = (): void => {
      clearTimeout(timer);
      if (settle) clearTimeout(settle);
      resolve({ url: url ?? "", claim: /Claim this Space[^\n]*?: (http\S+)/.exec(out)?.[1] ?? null });
    };
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (!url) {
        const m = /listening on (http\S+)/.exec(out);
        if (m?.[1]) { url = m[1]; settle = setTimeout(done, 2000); }   // the claim line follows at once on a fresh install; a seeded Space prints none
      }
      if (url && /Claim this Space[^\n]*?: http\S+/.test(out)) done();
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`the daemon exited with ${String(code)}: ${out}`)); });
  });
  return { child, ...printed };
}

/** The daemon on a copy of the frozen core seed (owner bootstrap token only; nobody can sign in with a password). */
export async function bootSpace(): Promise<Space> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-real-app-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon(dir, ["--space", CORE_SPACE]);
  return { url: d.url, token: ADMIN_TOKEN, space: CORE_SPACE, dir, stop: stopper(d.child), claim: d.claim };
}

/** A fresh install (ruling 71): an empty data directory. The host makes the Space and prints a one-time claim link; the owner becomes the owner by claiming it, as a person does. */
export async function bootFreshSpace(): Promise<Space> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-real-app-fresh-"));
  const d = await startDaemon(dir, ["--space", "spc_fresh", "--space-name", "Fresh Co"]);
  return { url: d.url, token: ADMIN_TOKEN, space: "spc_fresh", dir, stop: stopper(d.child), claim: d.claim };
}

/** The claim link as the browser opens it: the daemon prints its own address, the page is served from the edge, so the path and fragment move to the edge's origin. */
export function claimOnEdge(link: string, origin: string): string {
  const u = new URL(link);
  return `${origin}${u.pathname}${u.hash}`;
}

/** What a browser holds once signed in as the owner of this Space (the owner bootstrap token, the same door the CLI and the Console use). */
export function ownerSession(space: Space, origin: string): { baseUrl: string; token: string; def: Record<string, unknown>; personId: string } {
  const def = { spaceId: space.space, name: "Space", kind: "team", address: origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} };
  return { baseUrl: origin, token: space.token, def, personId: "owner" };
}

import test from "node:test";
import assert from "node:assert/strict";

test("harness: the owner session a browser carries names the Space, the owner token and the origin it was served from", () => {
  const s = ownerSession({ url: "http://127.0.0.1:1", token: "tok", space: "spc_core", dir: "/x", stop: async () => undefined, claim: null }, "http://127.0.0.1:2");
  assert.equal(s.baseUrl, "http://127.0.0.1:2");
  assert.equal(s.token, "tok");
  assert.equal(s.def["spaceId"], "spc_core");
  for (const step of Object.keys(STEP_NEEDS)) assert.equal(typeof todoFor(step, new Set()), "string", step);
});

test("harness: the claim link moves to the edge's origin with its path and fragment", () => {
  assert.equal(claimOnEdge("http://127.0.0.1:7777/claim/clm_abc#fp=aa11&s=spc_fresh", "http://127.0.0.1:9000"), "http://127.0.0.1:9000/claim/clm_abc#fp=aa11&s=spc_fresh");
});
