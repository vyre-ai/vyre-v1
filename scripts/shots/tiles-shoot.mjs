// Pictures of the helper tiles (TILES_01) from the real components: export the shots app once, serve it, shoot paper and graphite at the wide size and the phone size, then click the switch and shoot the rows.
// Run on the build box from the worktree:  node scripts/shots/tiles-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r42-subagents/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("TILES_01"));
const report = [];
for (const t of targets)
  for (const skin of ["paper", "graphite"])
    for (const [size, vp] of Object.entries(SIZES)) {
      const ctx = await browser.newContext({
        viewport: vp,
        deviceScaleFactor: 1,
        colorScheme: skin === "graphite" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      const url = routeUrl(real.origin, t.route, skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      let found = true;
      await page.waitForSelector(t.waitFor, { timeout: 8000 }).catch(() => (found = false));
      await page.waitForTimeout(900);
      const tiles = await page.locator("[data-testid='crew-tiles']").count();
      const sw = await page.locator("[data-testid='crew-strip-view']").count();
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const file = path.join(out, `${t.id.replace("TILES_01-", "")}-${skin}-${size}.png`);
      await page.screenshot({ path: file });
      report.push({ file: path.basename(file), found, tiles, switchShown: sw, overflowX: over, errs: errs.slice(0, 2) });
      // the switch: tiles to rows and back on the same page
      if (t.id.endsWith("-tiles") && sw > 0) {
        await page.click("[data-testid='crew-strip-view']");
        await page.waitForTimeout(300);
        const asRows = await page.locator("[data-testid='crew-tiles']").count();
        await page.screenshot({ path: file.replace(".png", "-switched.png") });
        await page.click("[data-testid='crew-strip-view']");
        await page.waitForTimeout(300);
        const back = await page.locator("[data-testid='crew-tiles']").count();
        report.push({ file: path.basename(file) + " switch", tilesAfterSwitch: asRows, tilesAfterSecondPress: back });
      }
      await ctx.close();
    }
console.log(JSON.stringify(report, null, 1));
await browser.close();
real.close();
process.exit(0);
