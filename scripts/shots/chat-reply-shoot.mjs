// Lane chat-reply, on the build box from the worktree (the export is reused with --skip-export):
//   node scripts/shots/chat-reply-shoot.mjs <mountId> <out-dir> [--skip-export]   paper and graphite, wide and phone
//   node scripts/shots/chat-reply-shoot.mjs LIVEWORD_01 <out-dir> --live           the live word at 0.5 s, 7 s and 65 s, with the word read from the page each time
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const [id, out] = args.filter((a) => !a.startsWith("--"));
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
const TALL = !args.includes("--live");
const SIZES = { wide: { width: 1100, height: TALL ? 1500 : 400 }, phone: { width: 390, height: TALL ? 2600 : 400 } };
for (const skin of ["paper", "graphite"])
  for (const [size, vp] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({
      viewport: vp,
      colorScheme: skin === "graphite" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(routeUrl(real.origin, `/m/${id}`, skin), { waitUntil: "load", timeout: 60000 });
    if (args.includes("--live")) {
      if (size === "phone") {
        await ctx.close();
        continue;
      }
      const word = async () => (await page.locator("[data-testid='activity-line']").first().innerText()).trim();
      await page.waitForSelector("[data-testid='activity-line']", { timeout: 20000 });
      const t0 = Date.now();
      for (const at of [500, 7000, 65000]) {
        await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
        await page.screenshot({ path: path.join(out, `${id}-${skin}-${at / 1000}s.png`) });
        console.log(`${skin} ${at / 1000}s: word "${await word()}"`);
      }
    } else {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `${id}-${skin}-${size}.png`), fullPage: true });
    }
    await ctx.close();
  }
await browser.close();
real.close?.();
