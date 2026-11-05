// Lane screenshots (update screen) without ensureDeps (the shared node_modules is never reinstalled): export the shots app once, serve it, shoot each INSTALL_01 target in paper and graphite, at the
// wide size and the phone size (a phone-only part is shot at the phone size only). Run on the build box from the worktree:
//   node scripts/shots/l-install-shoot.mjs [out-dir] [--skip-export] [--only=grid,take] [--size=wide|phone]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { guardCrashes } = await import(path.join(REPO, "apps/app/tests/crash-guard.ts"));
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-models-upd/ui-shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const sizeOnly = (args.find((a) => a.startsWith("--size=")) ?? "").slice(7);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(process.cwd(), "scripts/shots/expo-cmd.mjs"))).exportCmd(process.cwd()), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("AUTOUPDATE_01") && (only.length === 0 || only.includes(t.id.replace("AUTOUPDATE_01-", ""))));
for (const t of targets) for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  if (sizeOnly && size !== sizeOnly) continue;
  if (size === "wide" && t.id.includes("phone")) continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const guard = guardCrashes(page);
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  // a busy box drops a navigation now and then: one more try before giving up
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForTimeout(500);
  let found = true;
  const jump = () => page.click("text=Jump to latest", { timeout: 1500 }).then(() => page.waitForTimeout(400)).catch(() => undefined);
  if (t.waitFor) await page.waitForSelector(t.waitFor, { timeout: 8000 }).catch(() => { found = false; });
  await guard.check(`${t.id} ${skin} ${size}: after load`);
  await jump();
  const bottom = () => page.evaluate(() => { for (const e of document.querySelectorAll("*")) if (e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== "visible" && getComputedStyle(e).overflowY !== "hidden") e.scrollTop = e.scrollHeight; }).then(() => page.waitForTimeout(300));
  for (const sel of [].concat(t.click ?? [])) { await page.click(sel).catch(() => { found = false; }); await page.waitForTimeout(700); await guard.check(`${t.id} ${skin} ${size}: after click ${sel}`); await page.mouse.move(2, 2); await jump(); }
  // a chat feed ends at its last message; the pane and the Console page are shot where they open
  void bottom;
  await guard.check(`${t.id} ${skin} ${size}: before the shot`);
  await page.waitForTimeout(600);
  const file = path.join(out, `${t.id.replace("AUTOUPDATE_01-", "")}-${skin}-${size}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.basename(file)} waitFor=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 400) : ""}`);
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
