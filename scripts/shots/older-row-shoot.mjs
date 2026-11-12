// The "Older desktop" row in its four states, desktop and phone width, light and dark. node scripts/shots/older-row-shoot.mjs <out-dir> [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-f-desktop/older-row";
if (!args.includes("--skip-export")) { fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true }); execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() }); }
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const moved of ["none", "done", "partial", "interrupted"]) for (const skin of ["paper", "graphite"]) for (const [size, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, `/m/WORKSECTIONS_01?part=running&old=1&moved=${moved}`, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid='work-list']", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.evaluate(() => { for (const el of document.querySelectorAll("*")) { const s = getComputedStyle(el); if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight; } });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `older-${moved}-${size}-${skin}.png`) });
  console.log(`shot older-${moved}-${size}-${skin}`);
  await ctx.close();
}
await browser.close(); real.close(); process.exit(0);
