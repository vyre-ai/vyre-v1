// Lane l-hooks screenshots: export the shots app, serve it, shoot HOOKS_01 in paper and graphite at the wide size (1440) and the phone size (390). Run on the build box from the worktree:
//   node scripts/shots/hooks-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-hooks/ui-shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/wt/base/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("HOOKS_01"));
for (const t of targets) for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForTimeout(500);
  await page.waitForSelector(t.waitFor, { timeout: 15000 }).catch(() => errs.push(`no ${t.waitFor}`));
  await page.waitForTimeout(900);
  // named by the prototype state it matches, the theme and the size: vyre-v1.html#chat,at:crew;t=55;hooks=hchat
  const file = path.join(out, `${t.id.replace("HOOKS_01-", "")}__chat-at-crew-t55-hooks-hchat__${skin}__${size}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.basename(file)}${errs.length ? " errors=" + errs.join(" | ").slice(0, 400) : ""}`);
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
