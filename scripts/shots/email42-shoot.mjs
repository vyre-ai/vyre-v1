// r42-email-in pictures: the templates page, an inbox that works and one that fails, and the delivery line under a sent email, from the real components, paper and graphite at 1440 and 390.
//   node scripts/shots/email42-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r42-email-in/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const targets = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/shots/targets/EMAIL42_01.json"), "utf8")).targets;
const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const t of targets)
  for (const skin of ["paper", "graphite"])
    for (const [size, vp] of Object.entries(SIZES)) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      const url = routeUrl(real.origin, t.route, skin);
      await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      let found = true;
      await page.waitForSelector(t.waitFor, { timeout: 20000 }).catch(() => (found = false));
      await page.waitForTimeout(700);
      if (t.id.endsWith("trail-delivered") || t.id.endsWith("trail-bounced") || t.id.endsWith("trail-retrying"))
        await page.click("[data-testid^='trail-toggle:']").catch(() => undefined);
      await page.waitForTimeout(300);
      const file = path.join(out, `${t.id.replace("EMAIL42_01-", "")}-${skin === "graphite" ? "dark" : "light"}-${size}.png`);
      await page.screenshot({ path: file });
      console.log(`shot ${path.basename(file)} found=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 300) : ""}`);
      await ctx.close();
    }
await browser.close();
real.close?.();
process.exit(0);
