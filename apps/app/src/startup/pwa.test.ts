import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(APP, "public");
const HTML = fs.readFileSync(path.join(APP, "app", "+html.tsx"), "utf8");

test("PWA manifest declares an installable standalone Vyre app", () => {
  const manifestPath = path.join(PUBLIC, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "apps/app/public/manifest.json must ship with the web export");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, "Vyre");
  assert.equal(manifest.short_name, "Vyre");
  assert.equal(manifest.start_url, "/chat");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#ffffff");
  assert.equal(manifest.background_color, "#ffffff");
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  assert.ok(Array.isArray(icons));
  for (const size of ["192x192", "512x512"]) {
    const icon = icons.find((entry) => entry.sizes === size);
    assert.ok(icon, `manifest needs a ${size} icon`);
    assert.equal(icon?.type, "image/png");
    assert.match(icon?.src ?? "", /^\/icons\//);
    assert.ok(fs.existsSync(path.join(PUBLIC, (icon?.src ?? "").replace(/^\//, ""))), `${size} icon file exists`);
  }
  assert.ok(icons.some((entry) => entry.purpose?.includes("maskable")), "one icon must support Android masking");
});

test("web document advertises the install surface and iPhone safe-area contract", () => {
  assert.match(HTML, /rel="manifest"/);
  assert.match(HTML, /href="\/manifest\.json"/);
  assert.match(HTML, /name="theme-color"/);
  assert.match(HTML, /name="apple-mobile-web-app-capable"\s+content="yes"/);
  assert.match(HTML, /name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/);
  assert.match(HTML, /name="apple-mobile-web-app-title"\s+content="Vyre"/);
  assert.match(HTML, /rel="apple-touch-icon"/);
  assert.match(HTML, /viewport-fit=cover/);
  assert.match(HTML, /safe-area-inset-(top|bottom)/);
});

test("service worker keeps the connection truthful while supporting offline shell and updates", () => {
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  assert.match(sw, /const CACHE = "vyre-shell-v2"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /url\.pathname\.startsWith\("\/sync"\)/);
  assert.match(sw, /req\.mode === "navigate"/);
  assert.match(sw, /await fetch\(req\)/);
  assert.match(sw, /await cache\.match\("\/"\)/);
  assert.match(sw, /await self\.skipWaiting\(\)/);
});

test("production export keeps the install contract in the files a browser receives", (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST is set by the shots workflow after the production export");
    return;
  }
  const root = path.resolve(dist);
  const read = (name: string): string => fs.readFileSync(path.join(root, name), "utf8");
  const manifest = JSON.parse(read("manifest.json")) as { display?: string; start_url?: string; scope?: string; icons?: { src: string }[] };
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/chat");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons?.length);
  for (const icon of manifest.icons ?? []) assert.ok(fs.statSync(path.join(root, icon.src.replace(/^\//, ""))).size > 0, icon.src);
  const html = read("index.html");
  assert.match(html, /rel="manifest"[^>]+href="\/manifest\.json"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(read("sw.js"), /vyre-shell-v2/);
});

test("the web session persistence contract remains local and explicit", () => {
  const stored = fs.readFileSync(path.join(APP, "src", "shell", "session", "stored.ts"), "utf8");
  assert.match(stored, /const KEY = "vyre\.session\.v1"/);
  assert.match(stored, /localStorage/);
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  assert.match(sw, /startsWith\("\/api\/"\)/);
  assert.match(sw, /startsWith\("\/sync"\)/);
});

test("the service worker registers once the app is usable after load, not at load while startup still runs", async () => {
  const { bootScript } = await import("./boot.ts");
  const run = (order: ("load" | "usable")[], waitMs: number): Promise<number> => {
    const on = new Map<string, () => void>();
    let registered = 0;
    const timers: { at: number; fn: () => void }[] = [];
    let now = 0;
    const win = {
      performance: { mark() {}, now: () => 0 }, location: { search: "" }, URLSearchParams,
      document: { documentElement: { style: { setProperty() {} }, setAttribute() {} } },
      navigator: { serviceWorker: { register: () => { registered++; return { catch() {} }; } } },
      addEventListener: (type: string, fn: () => void) => on.set(type, fn),
      setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }),
    };
    new Function(...Object.keys(win), "window", bootScript())(...Object.values(win), win);
    for (const e of order) on.get(e === "load" ? "load" : "vyre:usable")?.();
    now = waitMs;
    for (const t of timers.splice(0)) if (t.at <= now) t.fn();
    return Promise.resolve(registered);
  };
  assert.equal(await run(["load"], 100), 0, "load alone does not register while the app is still starting");
  assert.equal(await run(["load", "usable"], 0), 1);
  assert.equal(await run(["usable", "load"], 0), 1);
  assert.equal(await run(["load"], 5000), 1, "a page that never marks usable still gets its worker");
  assert.equal(await run(["load", "usable", "usable"], 5000), 1, "registered once");
});
