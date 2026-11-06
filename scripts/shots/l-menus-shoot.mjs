// l-menus lane shots, before and after (paper and graphite, wide): the reaction chip toggle, a person's name pressed on a message, the chat header "...", one project row menu.
// Run on the lane box from the worktree: PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-menus-shoot.mjs <out-dir> <tag> [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-menus/shots";
const tag = args.filter((a) => !a.startsWith("--"))[1] || "after";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const vp = { width: 1440, height: 900 };
for (const skin of ["paper", "graphite"]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const snap = async (name) => { const f = path.join(out, `${name}-${tag}-${skin}.png`); await page.screenshot({ path: f }); console.log("shot", path.basename(f), errs.length ? "errors=" + errs.join(" | ").slice(0, 300) : ""); };
  const go = async (route) => { const url = routeUrl(real.origin, route, skin); await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 })); await page.waitForTimeout(700); };

  // 1. the reaction chip: react through the message's "..." (Add Reaction), press the chip (removes yours), then react again and press the chip of someone else's reaction
  const react = async () => {
    await msg.hover(); await page.waitForTimeout(250);
    await page.locator("[data-testid^='act-more-']").first().click({ timeout: 4000 });
    await page.getByText("Add Reaction", { exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(250);
    await page.locator("[data-testid^='react-']").first().click({ timeout: 4000 });
    await page.waitForTimeout(500);
  };
  await go("/m/P-L9b_04");
  await page.waitForSelector("[data-testid^='msg-']", { timeout: 15000 });
  const msg = page.locator("[data-testid^='msg-']").filter({ has: page.locator("[data-testid^='who-']") }).first();
  await react().catch((e) => console.log("react failed", String(e).slice(0, 100)));
  await snap("react-1-added");
  const chip = page.locator("[data-testid^='reactions-'] [role='button']").first();
  await chip.click({ timeout: 4000 }).catch((e) => console.log("no chip", String(e).slice(0, 80)));
  await page.waitForTimeout(500);
  await snap("react-2-chip-pressed-once");
  await chip.click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await snap("react-3-chip-pressed-twice");

  // 2. a person's name on a message
  await go("/m/P-L9b_04");
  await page.waitForSelector("[data-testid^='who-']", { timeout: 15000 });
  const ids = await page.$$eval("[data-testid^='who-']", (n) => n.map((x) => x.getAttribute("aria-label") + "|" + x.getAttribute("data-testid")));
  console.log("who rows", JSON.stringify(ids.slice(0, 6)));
  await page.locator("[data-testid^='who-']").first().hover(); await page.waitForTimeout(500);
  await snap("name-hover");

  // 3. the chat header "..."
  await go("/m/P-L9b_04");
  await page.waitForSelector("[data-testid='more-button']", { timeout: 15000 });
  await page.click("[data-testid='more-button']"); await page.waitForTimeout(700);
  console.log("header menu", JSON.stringify(await page.$$eval("[data-testid^='menu-item-']", (n) => n.map((x) => x.getAttribute("data-testid").slice(10)))));
  await snap("header-more");

  // 4. one project row menu in the sidebar
  await go("/m/CTXMENU_01?kind=chat");
  await page.waitForSelector("[data-testid^='row-pj:']", { timeout: 15000 });
  await page.click("[data-testid^='row-pj:']", { button: "right" }); await page.waitForTimeout(900);
  console.log("project menu", JSON.stringify(await page.$$eval("[data-testid^='menu-item-']", (n) => n.map((x) => x.getAttribute("data-testid").slice(10)))));
  await snap("project-row-menu");
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
