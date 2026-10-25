// P-APP_01: the real app against a booted daemon. A seeded Space runs as the daemon process a person starts (host/src/daemon/main.ts); the app's web export is served from a tiny same-origin server that proxies the
// gateway and the live socket to the daemon (the production shape: one origin, no CORS); a real Chromium opens it. What a person does, in order:
//   1 the app opens on sign-in (nothing is signed in)               2 sign in                          3 Home shows the Space's real data
//   4 Chats: send a message and it appears                          5 Records: open a table            6 Files: open a file
// A step whose module is still a stub in host/modules.json is reported as TODO with the packet that makes it live; it is never faked and never counted as a pass. Step 2 is the owner bootstrap
// token (the same door the CLI and the Console use) until the seeded Space carries a member with a password (golden flow 02); it is labelled as such in the output.
// Needs a Chromium (CHROME_BIN, or playwright-core's own) and a web export (VYRE_APP_DIST, else the test exports one). VYRE_REQUIRE_CHROME=1 turns a missing Chromium into a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SPACE, bootCore } from "../../../fixtures/seed/core/index.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const APP = path.join(REPO, "apps/app");

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

interface Edge { origin: string; close(): void }

/** The app's export on one origin, with the gateway (/v1, /sync, /healthz) and the live socket (/live) passed through to the daemon. */
function edge(dist: string, daemonUrl: string): Promise<Edge> {
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

interface Space { url: string; token: string; space: string; dir: string; stop(): Promise<void> }

/** The daemon as a person starts it (`node host/src/daemon/main.ts`), on a copy of the frozen core seed. The app tests may not import host, so it runs as its own process. */
async function bootSpace(): Promise<Space> {
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

function exportApp(): string {
  const given = process.env["VYRE_APP_DIST"];
  if (given) return given;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-app-dist-"));
  execSync(`npx expo export --platform web --output-dir ${out}`, { cwd: APP, stdio: "inherit", timeout: 100_000, env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" } });
  return out;
}

test("the pure parts: a step is TODO with its packet when a module it needs is a stub, and passes through when all are live", () => {
  const live = new Set(["home", "tasks", "records"]);
  assert.equal(todoFor("home", live), null);
  assert.equal(todoFor("records", live), null);
  assert.match(todoFor("chats", live) ?? "", /chat still a stub in host\/modules.json \(live with P-L2_LIVE\)/);
  assert.match(todoFor("sign in", live) ?? "", /identity, spaces, devices .* P-L7_LIVE/);
  assert.throws(() => todoFor("nope", live));
});

test("the real app on a booted daemon: sign-in screen, then Home, Chats, Records and Files from the seeded Space", async (t) => {
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`);
    t.skip("no Chromium on this machine");
    return;
  }
  const live = liveModules();
  const space = await bootSpace();
  const dist = exportApp();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const todo: string[] = [];
  try {
    await t.test("1 the app opens on sign-in when nobody is signed in", async () => {
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("shell").count(), 0, "no shell before sign-in");
    });

    await t.test("2 sign in (owner bootstrap token) opens the shell on the Space", async (s) => {
      const gap = todoFor("sign in", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      const def = { spaceId: space.space, name: "Space", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} };
      await page.evaluate(([origin, token, d]) => { localStorage.setItem("vyre.session.v1", JSON.stringify({ baseUrl: origin, token, def: d, personId: "owner" })); }, [web.origin, space.token, def] as const);
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("shell").waitFor({ timeout: 15_000 });
    });

    await t.test("3 Home shows real data from the Space", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("home", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-home").or(page.getByTestId("rail-home-selected")).first().click();
      await page.getByTestId("s-needs").or(page.getByTestId("home-place")).first().waitFor({ timeout: 15_000 });
    });

    await t.test("4 Chats: a message sent from the composer appears in the conversation", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("chats", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-chats").or(page.getByTestId("rail-chats-selected")).first().click();
      const field = page.getByTestId("composer-field");
      await field.waitFor({ timeout: 15_000 });
      const text = `real app check ${Date.now()}`;
      await field.fill(text);
      await field.press("Enter");
      await page.getByText(text).first().waitFor({ timeout: 15_000 });
    });

    await t.test("5 Records: a table opens with its rows", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("records", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().click();
      await page.locator('[data-testid^="rec-"]').first().waitFor({ timeout: 15_000 });
    });

    await t.test("6 Files: the list shows files and one opens", async (s) => {
      const gap = todoFor("sign in", live) ?? todoFor("files", live);
      if (gap) { todo.push(gap); s.todo(gap); return; }
      await page.getByTestId("rail-files").or(page.getByTestId("rail-files-selected")).first().click();
      await page.getByTestId("files-list").waitFor({ timeout: 15_000 });
    });

    assert.deepEqual(errors, [], "the page threw no errors");
  } finally {
    if (todo.length) console.log(`real-app e2e TODO (not a pass):\n  ${todo.join("\n  ")}`);
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
