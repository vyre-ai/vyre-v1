// The end-to-end rig for Vyre for Chrome: the unpacked extension loaded in a real headless Chromium, its native messaging host (src/worker/native/host.js) started by Chromium itself,
// and the daemon's side of the bridge (lib/chrome-bridge.ts) on loopback with a fake app behind it that answers bridge operations and capability calls and records them.
// Nothing here runs on a person's Mac: the tests that use it skip where no Chromium is installed, and the lanes run them on the build box.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createChromeBridge } from "../../../../lib/chrome-bridge.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT = process.env["VYRE_SHOT_DIR"] ?? path.join(os.tmpdir(), "vyre-chrome-e2e-shots");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as { key: string };
export const EXT_ID = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

export async function findChromium(): Promise<{ chromium: any; exe: string } | null> {
  if (process.platform === "darwin" && !process.env["VYRE_E2E_ON_MAC"]) return null; // never on the Mac: the build box runs these
  let pw: any;
  try { pw = await import("playwright-core"); } catch { return null; }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) return null;
  const candidates = [process.env["CHROME_BIN"], (() => { try { return chromium.executablePath(); } catch { return undefined; } })(), "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const exe = candidates.find((c) => c && fs.existsSync(c));
  return exe ? { chromium, exe } : null;
}

export type Handler = (input: Record<string, any>, extra?: Record<string, any>) => unknown | Promise<unknown>;

/** A small web server for fixture pages: `pages` maps a path to HTML (or a function of the request). */
export function site(pages: Record<string, string | ((req: http.IncomingMessage, body: string) => string)>) {
  const hits: { method: string; path: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      hits.push({ method: req.method ?? "GET", path: u.pathname, body });
      const p = pages[u.pathname];
      if (p === undefined) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(typeof p === "function" ? p(req, body) : p);
    });
  });
  return new Promise<{ url: string; hits: typeof hits; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, hits, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  })));
}

/**
 * Start the fake app (the daemon's bridge with handlers) and a Chromium with the extension. `ops` answers bridge operations by name, `caps` answers capability calls by name.
 * Every call is recorded in `calls`. Returns the browser context, the extension's service worker, and helpers.
 */
export async function launch(found: { chromium: any; exe: string }, o: { ops?: Record<string, Handler>; caps?: Record<string, Handler>; colorScheme?: "light" | "dark"; incognito?: boolean; agent?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-"));
  const data = path.join(dir, "data");
  const profile = path.join(dir, "profile");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(profile, "NativeMessagingHosts"), { recursive: true });
  const token = "e2e-token-" + Math.random().toString(36).slice(2);
  const calls: { kind: "op" | "invoke"; name: string; input: Record<string, any>; extra?: Record<string, any> }[] = [];
  const events: Record<string, any>[] = [];
  const ops: Record<string, Handler> = {
    hello: () => ({ version: "e2e", spaces: [{ id: "spc_mla", name: "My Legal Academy", webUrl: "https://mla.vyre.test" }, { id: "spc_me", name: "Personal", webUrl: "https://me.vyre.test" }], active: "spc_mla", locked: false }),
    ...o.ops,
  };
  const caps: Record<string, Handler> = { ...o.caps };
  const bridge = createChromeBridge({
    token,
    op: async (name, input) => { calls.push({ kind: "op", name, input }); const h = ops[name]; if (!h) throw Object.assign(new Error("not here"), { code: "not_available" }); return h(input); },
    invoke: async (name, input, extra) => { calls.push({ kind: "invoke", name, input, extra }); const h = caps[name]; if (!h) throw Object.assign(new Error("not here"), { code: "not_available" }); return h(input, extra); },
    onEvent: (e) => { events.push(e); },
  });
  const server = http.createServer((req, res) => { if (!bridge.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fs.writeFileSync(path.join(data, "vyred.json"), JSON.stringify({ url, pid: process.pid, roles: ["space"] }));
  fs.writeFileSync(path.join(data, "admin.token"), token);

  // The native host, as the desktop app installs it: a launcher Chromium starts, which runs host.js with node.
  const launcher = path.join(dir, "run-vyre-bridge");
  fs.writeFileSync(launcher, `#!/bin/sh\nexport VYRE_DATA_DIR='${data}'\nexec '${process.execPath}' '${path.join(ROOT, "src/worker/native/host.js")}' "$@"\n`, { mode: 0o755 });
  const hostManifest = fs.readFileSync(path.join(ROOT, "src/worker/native/run.vyre.bridge.json"), "utf8").replace("__HOST_PATH__", launcher).replace("__EXTENSION_ID__", EXT_ID);
  fs.writeFileSync(path.join(profile, "NativeMessagingHosts", "run.vyre.bridge.json"), hostManifest);

  // "Allow in Incognito", as a person turns it on at chrome://extensions, seeded in the profile before Chromium starts.
  if (o.incognito) {
    fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
    const prefs = JSON.stringify({ extensions: { settings: { [EXT_ID]: { incognito: true } } } });
    fs.writeFileSync(path.join(profile, "Default", "Preferences"), prefs);
    fs.writeFileSync(path.join(profile, "Default", "Secure Preferences"), prefs);
  }
  // Agent browsing needs chrome.debugger, which the product asks the person for when they open Chrome to an agent (an optional permission). A test cannot click that prompt, so with
  // `agent` the extension is loaded from a copy whose manifest holds the permission from the start. Same key, same id, same code.
  let extRoot = ROOT;
  if (o.agent) {
    extRoot = path.join(dir, "ext");
    fs.cpSync(ROOT, extRoot, { recursive: true, filter: (src) => !/[\\/]tests([\\/]|$)/.test(src) });
    const m = JSON.parse(fs.readFileSync(path.join(extRoot, "manifest.json"), "utf8"));
    m.permissions = [...m.permissions, "debugger"];
    delete m.optional_permissions;
    fs.writeFileSync(path.join(extRoot, "manifest.json"), JSON.stringify(m));
  }
  const context = await found.chromium.launchPersistentContext(profile, {
    executablePath: found.exe, headless: true, channel: "chromium", viewport: { width: 1280, height: 800 }, colorScheme: o.colorScheme ?? "light",
    args: [`--disable-extensions-except=${extRoot}`, `--load-extension=${extRoot}`, "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--enable-unsafe-extension-debugging"],
  });
  let worker = context.serviceWorkers().find((w: any) => w.url().startsWith(`chrome-extension://${EXT_ID}/`));
  if (!worker) worker = await context.waitForEvent("serviceworker", { predicate: (w: any) => w.url().startsWith(`chrome-extension://${EXT_ID}/`), timeout: 10_000 });

  async function waitFor<T>(f: () => T | undefined | null | false, ms = 5000, what = "a condition"): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v) return v as T;
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return {
    context, worker, bridge, calls, events, ops, caps, url,
    extUrl: (p: string) => `chrome-extension://${EXT_ID}/${p}`,
    waitFor,
    /** The calls made to one bridge operation or capability. */
    callsTo: (name: string) => calls.filter((c) => c.name === name),
    async shot(page: any, name: string) {
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },
    async close() {
      await context.close().catch(() => {});
      bridge.failAll();
      bridge.closeStreams();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
