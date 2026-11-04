// Browser test: keys typed the instant a new note's editor opens are not lost (the editor loads on demand; a stand-in field takes the keys until it exists).
// Run on the build box from the worktree: node scripts/shots/l-editor-early.mjs [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
if (!process.argv.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/wt/l-editor/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
for (const delay of [0, 0, 30, 150]) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/EDITOR_08", "paper"), { waitUntil: "domcontentloaded", timeout: 60000 });
  // type the instant a field can take focus, before the editor has loaded
  await page.waitForSelector("[data-testid=markdown-editor-early], .ProseMirror", { timeout: 20000 });
  if (delay) await page.waitForTimeout(delay);
  await page.keyboard.type("Call the county clerk", { delay: 5 });
  await page.waitForSelector(".ProseMirror", { timeout: 20000 });
  await page.waitForTimeout(300);
  const out = await page.textContent("[data-testid=typed]");
  const ok = JSON.parse(out ?? '""').trim() === "Call the county clerk";
  console.log(`${ok ? "PASS" : "FAIL"} typed ${delay} ms after the field appeared: ${out}`);
  if (!ok) failed++;
  await ctx.close();
}
await browser.close(); real.close();
process.exit(failed ? 1 : 0);
