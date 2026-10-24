#!/usr/bin/env node
// theme_flash probe (budgets.json): the first frame, and every frame after it, uses the right theme and skin.
//   node scripts/shots/theme-flash.mjs [--app scripts/shots/app] [--route /] [--skip-export]
// For each skin and mode it loads the Expo web export in headless Chrome, records the root background at DOMContentLoaded and on
// each of the first 30 animation frames, and counts frames that differ from the skin's --win token (wrong frames, budget 0).
// It also measures the time from navigation start to the inline theme script (apply_ms, budget in budgets.json).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDeps, ensureChromium } from "./ensure-deps.mjs";
import { parseArgs, routeUrl, countWrongFrames, budgetOf } from "./lib.mjs";
import { serve } from "./serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(REPO, args.app || "scripts/shots/app");
const budget = budgetOf(JSON.parse(fs.readFileSync(path.join(REPO, "budgets.json"), "utf8")), "theme_flash");
await ensureDeps(REPO);
ensureChromium(REPO);
const dist = path.join(appDir, "dist");
if (!args["skip-export"] && !fs.existsSync(dist)) execSync("npx expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" } });

const { skins } = await import("../../ui/src/tokens/skins.ts");
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const { chromium } = await import("playwright-core");
const server = await serve(dist, { spa: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results = [];
try {
  for (const s of skins) for (const mode of ["light", "dark"]) {
    const expected = rgb(s[mode]["--win"]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: mode });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__frames = [];
      const sample = () => getComputedStyle(document.documentElement).backgroundColor;
      document.addEventListener("DOMContentLoaded", () => window.__frames.push(sample()));
      let n = 0;
      const tick = () => { window.__frames.push(sample()); if (++n < 30) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.goto(routeUrl(server.origin, args.route || "/", s.id, mode), { waitUntil: "load" });
    await page.waitForTimeout(700);
    const { frames, applyAt } = await page.evaluate(() => ({ frames: window.__frames, applyAt: window.__VYRE_THEME_AT__ ?? -1 }));
    const wrong = countWrongFrames(frames, expected);
    results.push({ skin: s.id, mode, frames: frames.length, wrong, apply_ms: Math.round(applyAt * 10) / 10, expected });
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
const wrong = results.reduce((a, r) => a + r.wrong, 0), slowest = Math.max(...results.map((r) => r.apply_ms));
const ok = wrong <= budget.wrong_frames_max && slowest >= 0 && slowest <= budget.apply_ms_max;
console.log("METRIC " + JSON.stringify({ name: "theme_flash", wrong_frames: wrong, apply_ms_max_seen: slowest, budget, combos: results.length, pass: ok }));
for (const r of results.filter((r) => r.wrong || r.apply_ms < 0 || r.apply_ms > budget.apply_ms_max)) console.error("bad", JSON.stringify(r));
process.exit(ok ? 0 : 1);
