#!/usr/bin/env node
// PWA smoke against the production web export at an iPhone-sized viewport.
// Chromium can prove the exported manifest, service-worker shell fallback and browser storage contract. It cannot prove
// Safari's Add to Home Screen UI, so this output calls the standalone media query a controlled simulation and never labels
// it as a real iPhone pass.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureChromium } from "./ensure-deps.mjs";
import { serve } from "./serve.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const dist = path.resolve(REPO, arg("--dist", "apps/app/dist"));
const out = path.resolve(REPO, arg("--out", "shots-out/pwa-mobile"));
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error(`no production export at ${dist}`);
  process.exit(1);
}

ensureChromium(REPO);
fs.mkdirSync(out, { recursive: true });
const web = await serve(dist);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
// No browser engine in this job implements iOS's installed display mode. Mark only that media query as a simulation, and
// record it in the evidence so a reviewer knows the remaining owner check is a physical iPhone Add to Home Screen pass.
await ctx.addInitScript(() => {
  const native = window.matchMedia.bind(window);
  window.matchMedia = (query) => query === "(display-mode: standalone)" ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : native(query);
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
});
const page = await ctx.newPage();
const result = { evidence: "Chromium iPhone-width PWA smoke; standalone media query simulated", viewport: { width: 390, height: 844 }, checks: {} };
try {
  await page.goto(`${web.origin}/home`, { waitUntil: "load", timeout: 30_000 });
  result.checks.document = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifest = manifestLink ? await fetch(manifestLink.href).then((r) => r.json()) : null;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      manifest: manifest?.display === "standalone" && manifest?.start_url === "/home" && manifest?.scope === "/",
      apple: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content") === "yes",
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content")?.includes("viewport-fit=cover") === true,
      standalone,
      safeAreaVars: ["--vyre-safe-area-top", "--vyre-safe-area-bottom"].every((name) => root.getPropertyValue(name).trim().length > 0),
      bodyBoxSizing: body.boxSizing === "border-box",
    };
  });
  if (!Object.values(result.checks.document).every(Boolean)) throw new Error(`PWA document check failed: ${JSON.stringify(result.checks.document)}`);

  result.checks.serviceWorker = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null || (await navigator.serviceWorker.getRegistration()) !== undefined;
  });
  if (!result.checks.serviceWorker) throw new Error("service worker did not become ready");

  result.checks.sessionStorage = await page.evaluate(() => {
    const value = JSON.stringify({ spaceId: "pwa-smoke", token: "vst_pwa_smoke", def: { name: "Smoke" }, personId: "person" });
    localStorage.setItem("vyre.session.v1", value);
    return localStorage.getItem("vyre.session.v1") === value;
  });
  if (!result.checks.sessionStorage) throw new Error("browser storage did not retain the session record");

  await ctx.setOffline(true);
  const offline = await page.goto(`${web.origin}/home?offline=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  result.checks.offlineShell = (offline?.status() ?? 0) === 200 && await page.locator("body").count() === 1;
  await ctx.setOffline(false);
  const reconnect = await page.goto(`${web.origin}/manifest.json?reconnected=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  result.checks.reconnect = (reconnect?.status() ?? 0) === 200;
  if (!result.checks.offlineShell || !result.checks.reconnect) throw new Error(`offline/reconnect check failed: ${JSON.stringify({ offline: result.checks.offlineShell, reconnect: result.checks.reconnect })}`);

  await page.goto(`${web.origin}/home?standalone=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.screenshot({ path: path.join(out, "iphone-390x844-standalone-simulated.png"), fullPage: false });
  fs.writeFileSync(path.join(out, "evidence.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  web.close();
}
