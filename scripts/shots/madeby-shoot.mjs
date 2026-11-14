// The made-for-me row, shot in paper and graphite at the wide size (1440) and the phone size (390) without ensureDeps: export the shots app once, serve it, shoot /m/MADEBY_01. Run on the build box from the worktree:
//   node scripts/shots/madeby-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-f-reach/madeby-shots";
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
    const url = routeUrl(real.origin, "/m/MADEBY_01", skin);
    await page
      .goto(url, { waitUntil: "load", timeout: 60000 })
      .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
    await page.waitForSelector("text=Made this for you", { timeout: 20000 }).catch(() => errs.push("no made row"));
    await page.hover("text=Made this for you").catch(() => errs.push("no hover"));
    await page.waitForTimeout(800);
    const file = path.join(out, `madeby-${skin}-${size}.png`);
    await page.screenshot({ path: file });
    const text = await page
      .locator("text=Made this for you")
      .first()
      .innerText()
      .catch(() => "");
    const remove = await page.locator("[aria-label='Remove Dex']").count();
    console.log(
      `shot ${path.basename(file)} row=${JSON.stringify(text)} remove=${remove}${errs.length ? " errors=" + errs.join(" | ").slice(0, 300) : ""}`,
    );
    await ctx.close();
  }
await browser.close();
real.close();
process.exit(0);
