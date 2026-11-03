// Lane screenshots without ensureDeps (the shared node_modules is never reinstalled): export the shots app once, serve it, shoot each GOALS_01 target in paper and graphite, at the
// wide size and the phone size (a phone-only part is shot at the phone size only). Run on the build box from the worktree:
//   node scripts/shots/notes-shoot.mjs [out-dir] [--skip-export] [--only=grid,take] [--size=wide|phone]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-goals2/ui-shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const sizeOnly = (args.find((a) => a.startsWith("--size=")) ?? "").slice(7);
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
const t = loadTargets(path.join(REPO, "scripts/shots")).find((x) => x.id === "GOALS_01-page-draft");
for (const skin of ["paper", "graphite"]) {
  const ctx = await browser.newContext({ viewport: SIZES.wide, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid='goal-draft']", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(900);
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, `${name}-${skin}.png`) }); console.log("shot", name, skin, errs.length ? errs.join(" | ").slice(0, 300) : ""); };
  const tid = (id) => page.locator(`[data-testid='${id}']`).first();
  await shot("1-draft");
  await tid("goal-title-edit").click(); await shot("2-title-editing");
  await page.keyboard.press("Escape");
  await tid("goal-deadline-edit").click(); await shot("3-deadline-editing");
  await tid("goal-deadline-cancel").click();
  await tid("goal-add-helper").click(); await shot("4-helpers-dialog");
  await page.keyboard.press("Escape");
  await tid("goal-lead").click(); await shot("5-lead-dialog");
  await page.keyboard.press("Escape");
  await tid("goal-step-title-rem-edit").click().catch(() => undefined); await shot("6-step-editing");
  await page.keyboard.press("Escape");
  await page.getByText("Details", { exact: true }).first().click().catch(() => undefined); await shot("7-details");
  await tid("goal-set-checkins-change").click().catch(() => undefined); await shot("8-checkins-editing");
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
