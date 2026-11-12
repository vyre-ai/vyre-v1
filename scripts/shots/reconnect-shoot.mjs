// f-desktop: shots of the top bar while the server is unreachable. node scripts/shots/reconnect-shoot.mjs <out-dir> [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-f-desktop/shots-rc";
if (!args.includes("--skip-export")) { fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true }); execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() }); }
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [vp, w, h] of [["desktop", 1100, 300], ["phone", 390, 300]]) {
  for (const part of ["before", "after", "waiting"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(routeUrl(real.origin, `/m/RECONNECT_01?part=${part}`, "paper"), { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${vp}-${part}.png`) });
    await ctx.close();
  }
}
await browser.close(); real.close?.();
