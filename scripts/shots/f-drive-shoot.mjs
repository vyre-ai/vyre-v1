// Lane f-drive, on the build box from the worktree: node scripts/shots/f-drive-shoot.mjs [out-dir] [--skip-export]
// The FDRIVE_01 mount of the real shots app, paper (light) and graphite (dark).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/f-drive-shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SHOTS = [
  { id: "list", wait: "[data-testid='fdrive-list']" },
  { id: "live", wait: "[data-testid='live-folders']" },
  {
    id: "live-open",
    view: "live",
    wait: "[data-testid='live-folders']",
    click: "[data-testid='live-skipped-mnt_drive']",
    then: "[data-testid='live-skipped-item-mnt_drive-0']",
  },
  { id: "csv", wait: "[data-testid='vw-sheet']" },
  { id: "loading", wait: "[data-testid='file-viewer-getting']" },
  { id: "failed", wait: "[data-testid='file-viewer-failed']" },
];
for (const skin of ["paper", "graphite"]) {
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 640 },
      deviceScaleFactor: 1,
      colorScheme: skin === "graphite" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(routeUrl(real.origin, `/m/FDRIVE_01?view=${s.view ?? s.id}`, skin), {
      waitUntil: "load",
      timeout: 60000,
    });
    await page.waitForSelector(s.wait, { timeout: 30000 });
    if (s.click) {
      await page.click(s.click);
      await page.waitForSelector(s.then, { timeout: 10000 });
    }
    await page.waitForTimeout(800);
    const file = path.join(out, `${s.id}-${skin}.png`);
    await page.screenshot({ path: file });
    console.log(file, errs.length ? `errors: ${errs.join(" | ")}` : "no page errors");
    await ctx.close();
  }
}
await browser.close();
real.close?.();
