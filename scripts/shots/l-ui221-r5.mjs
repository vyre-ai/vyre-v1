// l-ui221 round 5: the model menu's side list floating beside the menu (a wide composer), open and after each way of closing. Run on the box:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-ui221-r5.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-ui221/r5";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ways = { escape: async (p) => { await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); }, outside: async (p) => { await p.mouse.click(200, 200); }, strip: async (p) => { await p.locator("[data-testid=composer-strip]").first().click(); }, pick: async (p) => { await p.locator("[data-testid^=row-model-]").first().click(); await p.mouse.click(200, 200); } };
for (const skin of ["graphite", "paper"]) for (const [way, close] of Object.entries(ways)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/P-L9b_04?v=idle", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=composer-strip]", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator("[data-testid=composer-strip]").first().click();
  await page.waitForTimeout(500);
  await page.locator("[data-testid=model-model]").click();
  await page.waitForTimeout(500);
  if (way === "escape" || way === "strip") await page.screenshot({ path: path.join(out, `open-${skin}.png`) });
  await close(page);
  await page.waitForTimeout(40);   // within a frame or two, no animation settling
  const n = await page.evaluate(() => ({ sub: document.querySelectorAll("[data-testid=model-sub]").length, panel: document.querySelectorAll("[data-testid=model-panel]").length, pops: document.querySelectorAll("[data-cmp-pop]").length }));
  console.log(skin, way, JSON.stringify(n));
  await page.screenshot({ path: path.join(out, `closed-${way}-${skin}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
