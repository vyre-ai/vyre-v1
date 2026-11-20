// The booted-daemon harness shared by the real-app e2e test and the real-app screenshots (scripts/shots/real-app.mjs): the daemon as a person starts it on a copy of the frozen core seed, the app's
// web export on one origin with the gateway and the live socket proxied to the daemon (the production shape: no CORS), and the owner bootstrap session a signed-in browser carries.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { CORE_SPACE, bootCore } from "../../../fixtures/seed/core/index.ts";
import { ADMIN_TOKEN, REPO, bootFreshSpace, startDaemon, stopper } from "./support/fresh-space.ts";
import type { Space } from "./support/fresh-space.ts";
export { ADMIN_TOKEN, REPO, bootFreshSpace, startDaemon, stopper };
export type { Space };

/** Which module each step needs, and the packet that flips it (docs/lanes: L7 identity/spaces, L2 chat, L3 records, L4 files). */
export const STEP_NEEDS: Record<string, { modules: string[]; packet: string }> = {
  "sign in": { modules: ["identity", "spaces", "devices"], packet: "P-L7_LIVE" },
  home: { modules: ["home", "tasks"], packet: "P-L6_LIVE" },
  chats: { modules: ["chat"], packet: "P-L2_LIVE" },
  records: { modules: ["records"], packet: "P-L3_LIVE" },
  files: { modules: ["files"], packet: "P-L4_LIVE" },
  inbox: { modules: ["inbox"], packet: "P-L5_LIVE" },
  apps: { modules: ["sites", "forms"], packet: "P-L8_LIVE" },
  automations: { modules: ["automations"], packet: "P-L3_LIVE" },
  vault: { modules: ["vault"], packet: "P-L7_LIVE" },
  settings: { modules: ["settings"], packet: "P-L7_LIVE" },
};

export function liveModules(root = REPO): Set<string> {
  const list = JSON.parse(fs.readFileSync(path.join(root, "host/modules.json"), "utf8")) as {
    modules: { id: string; status: string }[];
  };
  return new Set(list.modules.filter((m) => m.status === "live").map((m) => m.id));
}

/** Null when every module the step needs is live; else the TODO line naming what is missing and who flips it. */
export function todoFor(step: string, live: Set<string>): string | null {
  const need = STEP_NEEDS[step];
  if (!need) throw new Error(`unknown step ${step}`);
  const missing = need.modules.filter((m) => !live.has(m));
  return missing.length === 0
    ? null
    : `${step}: ${missing.join(", ")} still a stub in host/modules.json (live with ${need.packet})`;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export interface Edge {
  origin: string;
  close(): void;
}

/** The app's export on one origin, with the gateway (/v1, /sync, /healthz, the Space's blobs) and the live socket (/live) passed through to the daemon. */
export function edge(
  dist: string,
  daemonUrl: string | (() => string),
  tls?: { key: string; cert: string },
  port = 0,
): Promise<Edge> {
  // a function gives the daemon's address when the first request needs it: the edge can listen (and so hold its port) before the daemon it fronts has finished starting
  const targetNow = (): URL => new URL(typeof daemonUrl === "function" ? daemonUrl() : daemonUrl);
  const base = path.resolve(dist);
  const proxied = (p: string): boolean =>
    p.startsWith("/v1/") ||
    // the public path: what the relay carries to the daemon for people with no session (a form, a signing link)
    p.startsWith("/p/") ||
    p.startsWith("/sync/") ||
    /^\/spaces\/[^/]+\/blobs\//.test(p) ||
    p === "/healthz" ||
    p.startsWith("/live") ||
    // the live view of an agent's browser: the daemon's own stream and socket, a ticket in the address (the app asks for them at the Space's address)
    /^\/browsers\/[^/]+\/(stream|ws)$/.test(p) ||
    p.startsWith("/local/vault/key/") ||
    p === "/mcp" ||
    p.startsWith("/.well-known/oauth-") ||
    /^\/oauth\/(authorize|register|token|wait)$/.test(p);
  const handle: http.RequestListener = (req, res) => {
    const u = new URL(req.url ?? "/", "http://edge");
    if (proxied(u.pathname)) {
      let target: URL;
      try {
        target = targetNow();
      } catch {
        res.writeHead(503);
        res.end("the daemon is still starting");
        return;
      }
      const up = http.request(
        { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        res.writeHead(502);
        res.end("daemon unreachable");
      });
      // a viewer that goes away ends the request it made to the daemon, as a gateway does (a live view's stream would otherwise stay open and count as someone watching)
      res.on("close", () => up.destroy());
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
    let target: URL;
    try {
      target = targetNow();
    } catch {
      socket.destroy();
      return;
    }
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
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({
        origin: `${tls ? "https" : "http"}://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
        close: () => server.close(),
      }),
    );
  });
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

/** The claim link as the browser opens it: the daemon prints its own address, the page is served from the edge, so the path and fragment move to the edge's origin. */
interface Loc {
  waitFor(o?: { timeout?: number; state?: "detached" | "visible" }): Promise<void>;
  click(o?: { timeout?: number }): Promise<void>;
  first(): Loc;
  or(other: Loc): Loc;
}
interface Pg {
  getByTestId(id: string): Loc;
}

/**
 * Onboarding opens fullscreen the first time a person enters a Space (right after a claim or a join). A live test that is not about onboarding walks past it the way a person does:
 * Finish later, then the shell is back. Returns whether onboarding opened, so the one test about it can assert that it did.
 */
export async function dismissOnboarding(page: Pg, o: { wait?: number } = {}): Promise<boolean> {
  await page.getByTestId("shell").or(page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
  const screen = page.getByTestId("onboarding");
  try {
    await screen.waitFor({ timeout: o.wait ?? 8_000 });
  } catch {
    return false;
  }
  // the wide layout closes with "Finish later" (onboarding-close); a phone or a narrow window has the X (onboarding-x)
  await page.getByTestId("onboarding-close").or(page.getByTestId("onboarding-x")).first().click({ timeout: 10_000 });
  await screen.waitFor({ state: "detached", timeout: 10_000 });
  return true;
}

export function claimOnEdge(link: string, origin: string): string {
  const u = new URL(link);
  return `${origin}${u.pathname}${u.hash}`;
}

/** What a browser holds once signed in as the owner of this Space (the owner bootstrap token, the same door the CLI and the Console use). */
export function ownerSession(
  space: Space,
  origin: string,
): { baseUrl: string; token: string; def: Record<string, unknown>; personId: string } {
  const def = {
    spaceId: space.space,
    name: "Space",
    kind: "team",
    address: origin,
    role: "Owner",
    tint: ["#6E5CF0", "#9B6BE8"],
    kit: "northwind",
    skinDefault: "system",
    starred: true,
    needsYou: false,
    console: true,
    terminal: true,
    counts: {},
    dots: {},
  };
  return { baseUrl: origin, token: space.token, def, personId: "owner" };
}

import test from "node:test";
import assert from "node:assert/strict";

test("harness: the owner session a browser carries names the Space, the owner token and the origin it was served from", () => {
  const s = ownerSession(
    { url: "http://127.0.0.1:1", token: "tok", space: "spc_core", dir: "/x", stop: async () => undefined, claim: null },
    "http://127.0.0.1:2",
  );
  assert.equal(s.baseUrl, "http://127.0.0.1:2");
  assert.equal(s.token, "tok");
  assert.equal(s.def["spaceId"], "spc_core");
  for (const step of Object.keys(STEP_NEEDS)) assert.equal(typeof todoFor(step, new Set()), "string", step);
});

test("harness: the claim link moves to the edge's origin with its path and fragment", () => {
  assert.equal(
    claimOnEdge("http://127.0.0.1:7777/claim/clm_abc#fp=aa11&s=spc_fresh", "http://127.0.0.1:9000"),
    "http://127.0.0.1:9000/claim/clm_abc#fp=aa11&s=spc_fresh",
  );
});
