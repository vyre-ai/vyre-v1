#!/usr/bin/env node
// Startup probe (budget startup): app.start to app.usable on the real app's web export, cold and warm, in headless Chrome.
//   node scripts/shots/probes/startup.mjs [--skip-export] [--route /home]
// Cold = a new browser context (empty cache and storage). Warm = the same context loaded again (cache and service worker present).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDeps, ensureChromium } from "../ensure-deps.mjs";
import { parseArgs, gotoSafe } from "../lib.mjs";
import { serve } from "../serve.mjs";

export const STARTUP_MS_DESKTOP = 1000;
export const STARTUP_MS_PHONE = 1500;

/** Milliseconds from the app.start mark to the app.usable mark, or null when either is missing. */
export function startupMs(marks) {
  const a = marks.find((m) => m.name === "app.start"), b = marks.find((m) => m.name === "app.usable");
  return a && b ? b.startTime - a.startTime : null;
}

const marksOf = (page) => page.evaluate(() => performance.getEntriesByType("mark").map((m) => ({ name: m.name, startTime: m.startTime })));

if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
  const args = parseArgs(process.argv.slice(2));
  const appDir = path.join(REPO, "apps/app"), dist = path.join(appDir, "dist");
  await ensureDeps(REPO);
  ensureChromium(REPO);
  if (!args["skip-export"]) {
    fs.rmSync(dist, { recursive: true, force: true });
    execSync("npx expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" } });
  }
  const server = await serve(dist, { spa: true });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const results = [];
  try {
    for (const [size, vp, budget] of [["desktop", { width: 1280, height: 800 }, STARTUP_MS_DESKTOP], ["phone", { width: 390, height: 844 }, STARTUP_MS_PHONE]]) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      const reqs = [];
      page.on("request", (r) => reqs.push(r.url()));
      page.on("pageerror", (e) => console.log(`pageerror ${e.message}`));
      page.on("response", (r) => { if (r.status() >= 400) console.log(`http ${r.status()} ${r.url()}`); });
      for (const kind of ["cold", "warm"]) {
        await gotoSafe(page, server.origin + (args.route || "/home"), { waitUntil: "load" });
        await page.waitForFunction(() => performance.getEntriesByName("app.usable").length > 0, null, { timeout: 15000 }).catch(() => {});
        const marks = await marksOf(page);
        const ms = startupMs(marks);
        const offOrigin = reqs.filter((u) => !u.startsWith(server.origin) && !u.startsWith("data:"));
        results.push({ size, kind, ms, budget, offOrigin: offOrigin.length });
        console.log(`METRIC ${JSON.stringify({ name: "startup", size, kind, ms, budget_ms: budget, off_origin_requests: offOrigin.length })}`);
        if (kind === "cold") await page.waitForTimeout(1500); // let the service worker finish precaching before the warm load
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  const bad = results.filter((r) => r.ms === null || r.ms > r.budget || r.offOrigin > 0);
  if (bad.length) { console.error("startup over budget or missing marks:", JSON.stringify(bad)); process.exit(1); }
}
