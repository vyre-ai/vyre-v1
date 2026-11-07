// l-shell221 final shots: Home, Chats and Settings at 1440 and 390 in graphite and paper, and a menu opened at the right edge (it must stay 8 px inside the window).
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-shell221-final.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-shell221/final";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;
const SIZES = { w1440: { width: 1440, height: 900 }, w900: { width: 900, height: 800 }, phone: { width: 390, height: 844 } };
for (const skin of ["graphite", "paper"]) for (const [size, vp] of Object.entries(SIZES)) for (const [place, realOn] of [["home", 0], ["chats", 0], ["settings", 1]]) {
  if (size === "w900" && place !== "chats") continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, `/m/SHELL221_01?place=${place}&pane=0${realOn ? "&real=1" : ""}`, skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid=shell-rail], [data-testid=shell-rail-bottom]", { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `${place}-${skin}-${size}.png`) });
  if (place === "chats" && size !== "phone") {
    const b = page.locator("[data-testid=edge-menu]");
    if (await b.count()) {
      await b.click(); await page.waitForTimeout(500);
      const m = await page.evaluate(() => { const e = document.querySelector("[role=menu]"); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right, t: r.top, b: innerHeight - r.bottom }; });
      const okm = m && m.l >= 8 - 0.6 && m.r >= 8 - 0.6 && m.t >= 8 - 0.6 && m.b >= 8 - 0.6;
      if (!okm) bad++;
      console.log(`${okm ? "ok  " : "FAIL"} menu ${skin} ${size} ${JSON.stringify(m)}`);
      await page.screenshot({ path: path.join(out, `menu-edge-${skin}-${size}.png`) });
    }
  }
  console.log("shot", place, skin, size);
  await ctx.close();
}
console.log(bad === 0 ? "FINAL OK" : `${bad} FAILED`);
await browser.close(); real.close();
process.exit(bad ? 1 : 0);
