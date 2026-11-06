// Lane l-calm, on the build box from the worktree: node scripts/shots/l-calm-shoot.mjs [out-dir] [--skip-export]
// The real app's CALM_01 mount at 1440 and 2000 wide and a phone, paper and graphite.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/l-calm-shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { w1440: { width: 1440, height: 900 }, w2000: { width: 2000, height: 1000 }, phone: { width: 390, height: 844 } };
for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(routeUrl(real.origin, "/m/CALM_01", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const file = path.join(out, `real-${skin}-${size}.png`);
  await page.screenshot({ path: file });
  console.log(file, errs.length ? `errors: ${errs.join(" | ")}` : "no page errors");
  await ctx.close();
}
// states: the people popover, the chart's quiet controls on hover, and Mark all seen on the away row
for (const skin of ["paper", "graphite"]) {
  const ctx = await browser.newContext({ viewport: SIZES.w1440, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CALM_01", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.hover("[data-testid='away-digest-row']");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `real-${skin}-w1440-awayhover.png`), clip: { x: 0, y: 0, width: 280, height: 260 } });
  const chart = await page.$("[data-testid^='block-'] [data-testid^='chart-']");
  if (chart) { await chart.hover(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, `real-${skin}-w1440-charthover.png`) }); }
  await page.click("[data-testid='participants-button']");
  await page.waitForSelector("[data-testid='people-popover']", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `real-${skin}-w1440-people.png`) });
  console.log("states", skin);
  await ctx.close();
}
await browser.close();
real.close?.();
process.exit(0);
