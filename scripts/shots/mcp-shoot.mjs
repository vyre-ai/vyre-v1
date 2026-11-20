// r42-mcp pictures: Settings > Connected apps from the sample Space, after real presses, in paper and graphite at 1440 and 390. Run on a build box from the worktree:
//   node scripts/shots/mcp-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-r42-mcp/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const row = (id) => `[data-sid='${id}']`;
const STEPS = {
  apps: [],
  open: [
    ["click", row("outside.agt_claude")],
    ["wait", 500],
  ],
  connect: [
    ["click", row("connect-outside")],
    ["wait", 600],
  ],
  "c-claude": [
    ["click", row("connect-outside")],
    ["wait", 600],
    ["click", "[data-testid='connect-app-claude']"],
  ],
  "c-cursor": [
    ["click", row("connect-outside")],
    ["wait", 600],
    ["click", "[data-testid='connect-app-cursor']"],
  ],
  "c-code": [
    ["click", row("connect-outside")],
    ["wait", 600],
    ["click", "[data-testid='connect-app-code']"],
  ],
};
for (const [part, steps] of Object.entries(STEPS))
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
      const url = routeUrl(real.origin, "/m/SETTINGSAPP_01?part=outside", skin);
      await page
        .goto(url, { waitUntil: "load", timeout: 60000 })
        .catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
      let found = true;
      await page.waitForSelector(row("outside.agt_claude"), { timeout: 20000 }).catch(() => (found = false));
      await page.waitForTimeout(400);
      for (const [op, sel] of steps) {
        if (op === "wait") await page.waitForTimeout(sel);
        else await page.click(sel, { timeout: 8000 }).catch(() => (found = false));
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(300);
      const file = path.join(out, `${part}-${skin === "graphite" ? "dark" : "light"}-${size}.png`);
      await page.screenshot({ path: file });
      console.log(
        `shot ${path.basename(file)} found=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 300) : ""}`,
      );
      await ctx.close();
    }
await browser.close();
process.exit(0);
