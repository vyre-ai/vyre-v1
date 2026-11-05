// Browser check of the live-block seam: two live blocks drawn by the host view, the "/" menu and its "Live block" pick, read mode, and the Markdown handed back unchanged by an edit elsewhere.
// Run on the build box: node scripts/shots/l-editor-live.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const out = process.argv.slice(2).find((a) => !a.startsWith("--")) || "/root/wt/l-tools-out/live";
fs.mkdirSync(out, { recursive: true });
if (!process.argv.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync(`${"/root/wt/l-editor/node_modules/.bin/expo"} export --platform web --output-dir dist`, { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + x}`); if (!ok) failed++; };
for (const skin of ["paper", "graphite"]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  await page.goto(routeUrl(real.origin, "/m/EDITOR_09", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".ProseMirror", { timeout: 20000 });
  await page.waitForSelector("[data-testid=lb-records]", { timeout: 10000 });
  const n = await page.locator("[data-testid=live-block]").count();
  check(`${skin}: two live blocks are drawn by the host view`, n === 2 && (await page.locator("[data-testid=lb-tasks]").count()) === 1, `n=${n}`);
  await page.screenshot({ path: path.join(out, `live-edit-${skin}.png`) });
  // an edit elsewhere leaves ids and live lines as they were
  await page.click(".ProseMirror p");
  await page.keyboard.press("End");
  await page.keyboard.type(" Updated.");
  await page.waitForTimeout(300);
  const md = (await page.textContent("[data-testid=md-out]")) ?? "";
  check(`${skin}: an edit keeps every block id and live line`, md.includes("<!--b:blk_c3--> | :::live") && md.includes("blk_d4") && md.includes("Updated."), md.slice(0, 200));
  // slash menu at the start of a new line
  await page.click(".ProseMirror");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/live");
  await page.waitForTimeout(300);
  check(`${skin}: the slash menu offers Live block`, (await page.locator("[data-testid=md-suggest-live]").count()) === 1);
  const withSlash = (await page.textContent("[data-testid=md-out]")) ?? "";
  const ids = [...withSlash.matchAll(/<!--b:(\w+)-->/g)].map((m) => m[1]);
  check(`${skin}: Enter in a block does not copy its id onto the new one`, new Set(ids).size === ids.length, ids.join(","));
  await page.screenshot({ path: path.join(out, `live-slash-${skin}.png`) });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const after = await page.locator("[data-testid=live-block]").count();
  check(`${skin}: picking it inserts a third live block`, after === 3, `count ${after}`);
  await page.screenshot({ path: path.join(out, `live-inserted-${skin}.png`) });
  await page.goto(routeUrl(real.origin, "/m/EDITOR_09?mode=read", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid=lb-records]", { timeout: 20000 });
  const editable = await page.locator(".ProseMirror[contenteditable=true]").count();
  check(`${skin}: read mode keeps both live blocks and is not editable`, (await page.locator("[data-testid=live-block]").count()) === 2 && editable === 0 && (await page.locator("[data-testid=md-bar]").count()) === 0);
  await page.screenshot({ path: path.join(out, `live-read-${skin}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
process.exit(failed ? 1 : 0);
