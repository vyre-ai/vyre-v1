// Lane screenshots without ensureDeps (the shared node_modules is never reinstalled): export the shots app once, serve it, shoot each ADDSHEET_01 target in paper and graphite at the wide size
// (1440) and the phone size (390). Each target scripts the clicks and typing that reach its state. Run on the build box from the worktree:
//   node scripts/shots/addsheet-shoot.mjs [out-dir] [--skip-export] [--only=empty,two] [--size=wide|phone]
// A step selector may list alternatives with " || ": the first one on the page is used (the header + on a desktop, the message box + on a phone).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-addsheet/ui-shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const sizeOnly = (args.find((a) => a.startsWith("--size=")) ?? "").slice(7);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync(`/root/export-slot.sh ${path.join(REPO, "node_modules/.bin/expo")} export --platform web --output-dir dist`, { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("ADDSHEET_01") && (only.length === 0 || only.includes(t.id.replace("ADDSHEET_01-", ""))));

/** The first selector of "a || b" that is on the page. */
async function pick(page, sel) {
  for (const s of sel.split("||").map((x) => x.trim())) if (await page.$(s)) return s;
  return sel.split("||")[0].trim();
}

for (const t of targets) for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  if (sizeOnly && size !== sizeOnly) continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForTimeout(500);
  await page.waitForSelector(t.waitFor, { timeout: 15000 }).catch(() => errs.push(`no ${t.waitFor}`));
  await page.waitForTimeout(600);
  for (const [op, a, b] of t.steps ?? []) {
    try {
      if (op === "open") {
        // the header + on a desktop; on a phone the message box's + and its Add people and agents row
        if (await page.$("[data-testid='add-agent']")) await page.click("[data-testid='add-agent']", { timeout: 8000 });
        else { await page.click("[data-testid='composer-attach']", { timeout: 8000 }); await page.click("[data-testid='row-plus-people']", { timeout: 8000 }); }
        await page.waitForSelector("[data-testid='add-sheet']", { timeout: 8000 });
      } else if (op === "click") await page.click(await pick(page, a), { timeout: 8000 });
      else if (op === "fill") await page.fill(a, b, { timeout: 8000 });
      else if (op === "wait") await page.waitForSelector(a, { timeout: 8000 });
    } catch (e) { errs.push(`${op} ${a ?? ""}: ${String(e).slice(0, 120)}`); }
    await page.waitForTimeout(350);
  }
  const found = t.after ? await page.waitForSelector(t.after, { timeout: 6000 }).then(() => true, () => false) : true;
  await page.waitForTimeout(700);
  const file = path.join(out, `${t.id.replace("ADDSHEET_01-", "")}-${skin}-${size}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.basename(file)} found=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 500) : ""}`);
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
