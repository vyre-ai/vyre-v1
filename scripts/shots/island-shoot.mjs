// Lane screenshots without ensureDeps (the shared node_modules is never reinstalled): export the shots app once, serve it, shoot each ISLAND_01 target in paper and graphite, at the
// wide size and the phone size (a phone-only part is shot at the phone size only). Run on the build box from the worktree:
//   node scripts/shots/island-shoot.mjs [out-dir] [--skip-export] [--only=grid,take] [--size=wide|phone]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const { guardCrashes } = await import(path.join(REPO, "apps/app/tests/crash-guard.ts"));
let crashed = 0;
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-island2/ui-shots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const sizeOnly = (args.find((a) => a.startsWith("--size=")) ?? "").slice(7);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/export-slot.sh /root/wt/l-island2/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 560 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("ISLAND_01") && (only.length === 0 || only.includes(t.id.replace("ISLAND_01-", ""))));
for (const t of targets) for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  if (sizeOnly && size !== sizeOnly) continue;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const guard = guardCrashes(page);
  const check = async (where) => { try { await guard.check(`${t.id} ${skin} ${size} ${where}`); } catch (e) { crashed++; console.log(`CRASH ${String(e.message).split("\n")[0].slice(0, 300)}`); } };
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  // a busy box drops a navigation now and then: one more try before giving up
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForTimeout(500);
  let found = true;
  if (t.waitFor) await page.waitForSelector(t.waitFor, { timeout: 30000 }).catch(() => { found = false; });
  await page.waitForTimeout(600);
  // the walk: a person scrolls the chat. "away" puts the question card out of view, "back" goes away and returns to the card, "card" leaves it in view. The feed is the scroller.
  const scrollFeed = (top) => page.evaluate((y) => { const card = document.querySelector("[data-block-id='blk_q1']"); const f = card?.closest("[data-vyre-feed]") ?? document.querySelector("[data-vyre-feed]"); const sc = [f, ...(f ? f.querySelectorAll("*") : [])].find((e) => e && e.scrollHeight > e.clientHeight + 4); if (!sc) return false; if (y === "card") card.scrollIntoView({ block: "center" }); else sc.scrollTop = y; return true; }, top);
  if (t.walk === "away" || t.walk === "back") { await scrollFeed(0); await page.waitForTimeout(900); await check("after scrolling the card away"); }
  if (t.walk === "back") { await scrollFeed("card"); await page.waitForTimeout(900); await check("after scrolling back"); }
  if (t.after) await page.waitForSelector(t.after, { timeout: 8000 }).catch(() => { found = false; });
  if (t.walk === "card" || t.walk === "back") { const q = await page.$("[data-testid='island-question']"); if (q) found = false; console.log(`  ${t.id}: question in pill while card in view = ${!!q}`); }
  if (t.click && found) { await page.click(t.click).catch(() => { found = false; }); await page.waitForSelector(t.after2, { timeout: 8000 }).catch(() => { found = false; }); }
  await check("before the shot");
  await page.waitForTimeout(500);
  const file = path.join(out, `${t.id.replace("ISLAND_01-", "")}-${skin}-${size}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.basename(file)} waitFor=${found}${errs.length ? " errors=" + errs.join(" | ").slice(0, 400) : ""}`);
  await ctx.close();
}
await browser.close(); real.close();
console.log(crashed === 0 ? "walk clean: no error page, no crash in the console" : `walk FAILED: ${crashed} crash check(s)`);
process.exit(crashed === 0 ? 0 : 1);
