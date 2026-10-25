#!/usr/bin/env node
// theme_flash probe (budgets.json): the first frame, and every frame after it, uses the right theme and skin.
//   node scripts/shots/theme-flash.mjs [--app scripts/shots/app] [--route /] [--skip-export]
// For each skin and mode it loads the Expo web export in headless Chrome, records the root background at DOMContentLoaded and on
// each of the first 30 animation frames, and counts frames that differ from the skin's --win token (wrong frames, budget 0).
// It also measures the time from the first response byte to the inline theme script (apply_ms). Ruling 37: wrong frames are binding (0);
// apply time is the median of 5 timed loads per combo after one discarded warm-up load (P-CI_11) and fails only above the budget, so one slow sample never fails a run (gate in probes/theme-flash-gate.mjs).
// Path mapping: the packet P-UI_02 owns scripts/shots/probes/**; this entry file is the probe budgets.json and shots.yml point at, so it is edited with it.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDeps, ensureChromium } from "./ensure-deps.mjs";
import { parseArgs, routeUrl, countWrongFrames, budgetOf } from "./lib.mjs";
import { serve } from "./serve.mjs";
import { summarizeCombo, comboOk } from "./probes/theme-flash-gate.mjs";

// P-CI_11: per skin and mode, one warm-up load (its time is discarded, its wrong frames still count) then 5 timed loads; the median is held to the unchanged budget.
const WARMUP = 1, SAMPLES = 5;

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(REPO, args.app || "scripts/shots/app");
const budget = budgetOf(JSON.parse(fs.readFileSync(path.join(REPO, "budgets.json"), "utf8")), "theme_flash");
await ensureDeps(REPO);
ensureChromium(REPO);
const dist = path.join(appDir, "dist");
// A packet branch with no shot targets exports nothing (shots.yml skips the export). With --skip-export and no build there is nothing to probe: say so and pass.
if (args["skip-export"] && !fs.existsSync(path.join(dist, "index.html"))) {
  console.log(`theme_flash: skipped, no web export at ${path.relative(REPO, dist)} (this branch has no shot targets, so shots.yml exported nothing)`);
  process.exit(0);
}
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
    const samples = [];
    for (let i = 0; i < WARMUP + SAMPLES; i++) {
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
      const { frames, applyAt } = await page.evaluate(() => ({ frames: window.__frames, applyAt: window.__VYRE_THEME_AT__ === undefined ? -1 : window.__VYRE_THEME_AT__ - (performance.getEntriesByType("navigation")[0]?.responseStart ?? 0) }));
      samples.push({ wrong: countWrongFrames(frames, expected), apply_ms: Math.round(applyAt * 10) / 10, frames: frames.length });
      await ctx.close();
    }
    // The warm-up load contributes its wrong frames (binding) but not its apply time.
    const timed = summarizeCombo(samples.slice(WARMUP));
    const warmWrong = samples.slice(0, WARMUP).reduce((a, x) => a + x.wrong, 0);
    results.push({ skin: s.id, mode, expected, ...timed, wrong: timed.wrong + warmWrong });
  }
} finally { await browser.close(); server.close(); }
const wrong = results.reduce((a, r) => a + r.wrong, 0), slowest = Math.max(...results.map((r) => r.apply_ms_median));
const bad = results.filter((r) => !comboOk(r, budget));
const ok = bad.length === 0;
console.log("METRIC " + JSON.stringify({ name: "theme_flash", wrong_frames: wrong, apply_ms_median_max_seen: slowest, samples_per_combo: SAMPLES, warmup: WARMUP, budget, combos: results.length, pass: ok }));
for (const r of bad) console.error("bad", JSON.stringify(r));
process.exit(ok ? 0 : 1);
