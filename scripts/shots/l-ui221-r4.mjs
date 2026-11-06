// l-ui221 round 4: the real Chats sidebar + channel "amicuspro" (Dex) + Thread pane at 1280, 1440, 2000. Run on the box:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-ui221-r4.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-ui221/r4";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const skin of ["paper", "graphite"]) for (const [w, h] of [[1280, 800], [1440, 900], [2000, 1000]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/UI221_01?part=thread&name=amicuspro&dex=1", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=thread-side]", { timeout: 15000 }).catch(() => console.log("no thread-side"));
  await page.waitForTimeout(2000);
  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
    const t = document.querySelector("[data-testid=conversation-title]");
    return { side: r("[data-testid=real-sidebar]"), conv: r("[data-testid=conversation]"), thread: r("[data-testid=thread-side]"), title: t ? t.textContent : null, titleCut: t ? t.scrollWidth > t.clientWidth : null, faces: document.querySelectorAll("[data-testid=conversation-faces] > *").length };
  });
  console.log(skin, w, JSON.stringify(m));
  await page.screenshot({ path: path.join(out, `three-${skin}-${w}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
