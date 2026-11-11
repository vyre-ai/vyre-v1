// f-desktop lane screenshots, run on the build box from the worktree (before: from a clean copy of the base commit, after: from the lane):
//   node scripts/shots/f-desktop-shoot.mjs <out-dir> [--skip-export]
// Shoots the agent menu in the Chats sidebar (an agent with an old desktop, and one without), the Console page of old desktops, and the Computer tab's "no computer" pane when it is still there.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-f-desktop/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const VP = { width: 1440, height: 900 };
async function open(skin, route, waitFor) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForTimeout(500);
  let found = true;
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => { found = false; });
  return { ctx, page, found };
}
for (const skin of ["paper", "graphite"]) {
  // the agent menu: row-f rows are the starred agents; agt_intake has an old desktop in the sample, any other does not
  for (const which of ["with-desktop", "without-desktop"]) {
    const { ctx, page, found } = await open(skin, "/m/CTXMENU_01?kind=agent&pin=agt_docs", "[data-testid='row-f:agt_docs']");
    const sel = `[data-testid='${which === "with-desktop" ? "row-f:agt_intake" : "row-f:agt_docs"}']`;
    await page.click(sel, { button: "right" }).catch(() => undefined);
    await page.waitForTimeout(500); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    await page.click(sel, { button: "right" }).catch(() => undefined);   // the first press reads each agent's computer; the second shows them
    await page.waitForTimeout(700);
    console.log(`menu-${which} ${skin}: ` + JSON.stringify(await page.$$eval("[data-testid^='menu-item-']", (n) => n.map((x) => x.getAttribute("data-testid").slice(10)))) + ` row=${sel} found=${found}`);
    await page.screenshot({ path: path.join(out, `menu-${which}-${skin}.png`) });
    await ctx.close();
  }
  { const { ctx, page, found } = await open(skin, "/m/F-DESKTOP_01", "[data-testid='console-agent-computers']"); await page.waitForTimeout(500);
    console.log(`console-computers ${skin} found=${found}`);
    await page.screenshot({ path: path.join(out, `console-computers-${skin}.png`) }); await ctx.close(); }
  { const { ctx, page, found } = await open(skin, "/m/WORKSECTIONS_01?part=running", "[data-testid='work-list']"); await page.waitForTimeout(500);
    console.log(`computer-tab-older-desktop ${skin} found=${found}`);
    await page.screenshot({ path: path.join(out, `computer-tab-${skin}.png`) }); await ctx.close(); }
  { const { ctx, page, found } = await open(skin, "/m/COMPUTERNONE_01?part=can", "[data-testid='computer-none']"); await page.waitForTimeout(300);
    console.log(`computer-none ${skin} found=${found}`);
    await page.screenshot({ path: path.join(out, `computer-none-${skin}.png`) }); await ctx.close(); }
}
await browser.close(); real.close();
process.exit(0);
