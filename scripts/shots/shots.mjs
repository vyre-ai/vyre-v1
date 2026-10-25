#!/usr/bin/env node
// Side-by-side screenshots of a real screen (Expo web export) and its prototype screen, in paper and graphite (ruling 14, ruling 21).
//   node scripts/shots/shots.mjs [--target <id|all>] [--skins paper,graphite] [--sizes desktop,phone] [--out shots-out]
//                                [--app scripts/shots/app] [--skip-export] [--max-export-s 120]
// Steps: export the Expo web build, serve it and the prototype copy (scripts/shots/prototype), screenshot both per skin and size,
// compose a side-by-side PNG, write index.md. CI uploads the output directory as an artifact (.github/workflows/shots.yml).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDeps, ensureChromium } from "./ensure-deps.mjs";
import { parseArgs, SKINS, SIZES, MAX_EXPORT_S, protoHash, routeUrl, loadTargets, sideBySideHtml } from "./lib.mjs";
import { serve } from "./serve.mjs";
import { measureScroll, withinBudget, SCROLL_P95_MS } from "./probes/scroll.mjs";
import { traceScroll } from "./probes/trace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(REPO, args.app || "scripts/shots/app");
const out = path.resolve(REPO, args.out || "shots-out");
// --probes-only shoots nothing and runs the scroll probe; --no-probes shoots and skips it (ruling 46: speed is measured on the pinned v1-perf runners).
const skins = args["probes-only"] ? [] : (args.skins || SKINS.join(",")).split(",");
const sizes = (args.sizes || Object.keys(SIZES).join(",")).split(",").map((n) => [n, SIZES[n]]);
const maxExport = Number(args["max-export-s"] || MAX_EXPORT_S);
const want = args.target || "all";

// P-UI_14: the production app's startup and bundle report, on the perf runner (the target carries no screenshots)
if (want === "P-UI_14") { const { main } = await import("./startup.mjs"); await main(args["skip-export"] ? ["--skip-export"] : []); process.exit(0); }

// A packet id (P-L9b_02) selects that packet's targets, whose ids start with it; "all" runs everything.
const targets = loadTargets(HERE).filter((t) => want === "all" || t.id === want || (want.startsWith("P-") && t.id.startsWith(want + "-")));
// A packet branch with no screenshot targets of its own (a backend packet that merged main) has nothing to shoot.
if (!targets.length && want.startsWith("P-")) { console.log(`no targets for ${want}: nothing to shoot`); process.exit(0); }
if (!targets.length) { console.error(`no target ${want}`); process.exit(1); }

await ensureDeps(REPO);
ensureChromium(REPO);

const dist = path.join(appDir, "dist");
let exportSeconds = 0;
if (!args["skip-export"]) {
  fs.rmSync(dist, { recursive: true, force: true });
  const t0 = Date.now();
  execSync("npx expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" } });
  exportSeconds = (Date.now() - t0) / 1000;
  console.log(`METRIC ${JSON.stringify({ name: "expo_web_export", seconds: exportSeconds, budget_seconds: maxExport })}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const real = await serve(dist, { spa: true });
const proto = await serve(path.join(HERE, "prototype"));
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const rows = [];
const scrollFailed = [];
try {
  for (const t of targets) for (const skin of skins) for (const [sizeName, vp] of sizes) {
    const dir = path.join(out, t.id); fs.mkdirSync(dir, { recursive: true });
    const stem = `${skin}-${sizeName}`;
    const shoot = async (url, file, settleMs, scheme, click) => {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      if (t.waitFor) await page.waitForSelector(t.waitFor, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(settleMs);
      // a prototype state with no hash token is reached the way a person does: press the control in whichever frame has it
      if (click) { for (const fr of page.frames()) { const el = fr.locator(click).first(); if (await el.count()) { await el.click().catch(() => {}); break; } } await page.waitForTimeout(600); }
      await page.screenshot({ path: file });
      await ctx.close();
    };
    const scheme = skin === "graphite" ? "dark" : "light";
    await shoot(routeUrl(real.origin, t.route, skin), path.join(dir, `${stem}-real.png`), 800, scheme);
    await shoot(`${proto.origin}/vyre-v1.html#${protoHash(t.proto, skin)}`, path.join(dir, `${stem}-proto.png`), t.protoSettleMs ?? 3000, scheme, t.protoClick);
    const cmp = path.join(dir, `${stem}-compare.html`);
    fs.writeFileSync(cmp, sideBySideHtml({ title: `${t.id} - ${skin} - ${sizeName} ${vp.width}x${vp.height}`, real: `${stem}-real.png`, proto: `${stem}-proto.png` }));
    const ctx = await browser.newContext({ viewport: { width: vp.width * 2 + 36, height: vp.height + 70 } });
    const page = await ctx.newPage();
    await page.goto("file://" + cmp);
    await page.waitForLoadState("load");
    await page.screenshot({ path: path.join(dir, `${stem}-side-by-side.png`) });
    await ctx.close();
    fs.rmSync(cmp);
    rows.push(`| ${t.id} | ${skin} | ${sizeName} ${vp.width}x${vp.height} | ${t.id}/${stem}-side-by-side.png |`);
    console.log(`shot ${t.id} ${skin} ${sizeName}`);
  }
  // Scroll probe (ruling 29): a target with "scroll": { "selector": "<css>" } is scrolled top to bottom and its p95 frame interval checked.
  for (const t of targets) if (t.scroll && !args["no-probes"]) {
    const ctx = await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    await page.goto(routeUrl(real.origin, t.route, "paper"), { waitUntil: "load", timeout: 60000 });
    const r = await measureScroll(page, t.scroll);
    const ok = withinBudget(r);
    console.log(`METRIC ${JSON.stringify({ name: "scroll", target: t.id, frames: r.frames, p95_ms: +r.p95.toFixed(2), max_ms: +r.max.toFixed(2), budget_ms: SCROLL_P95_MS, layout_shift: r.layoutShift, height_stable: r.heightStable, ok })}`);
    if (!ok || !r.heightStable) scrollFailed.push(t.id);
    await ctx.close();
    // --trace: the same scroll again on a fresh page under a Chrome trace (where the time goes); the measured pass above stays untraced.
    if (args.trace) {
      const tctx = await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: 1, reducedMotion: "no-preference" });
      const tpage = await tctx.newPage();
      await tpage.goto(routeUrl(real.origin, t.route, "paper"), { waitUntil: "load", timeout: 60000 });
      await traceScroll(browser, tpage, t.id, t.scroll, path.join(out, "traces"));
      await tctx.close();
    }
  }
} finally { await browser.close(); real.close(); proto.close(); }
fs.writeFileSync(path.join(out, "index.md"), `# Side-by-side screenshots\n\nExport: ${exportSeconds ? exportSeconds.toFixed(1) + " s" : "skipped"} (budget ${maxExport} s)\n\n| target | skin | size | file |\n|---|---|---|---|\n${rows.join("\n")}\n`);
if (scrollFailed.length) { console.error(`scroll probe over budget: ${scrollFailed.join(", ")}`); process.exit(1); }
if (exportSeconds > maxExport) { console.error(`web export took ${exportSeconds.toFixed(1)} s, over ${maxExport} s`); process.exit(1); }
console.log(`${rows.length} side-by-side images in ${out}`);

// Startup probe on the real app (budget startup). Skipped when a single target or no apps/app is asked for.
if (want === "all" && !args["skip-startup"] && !args["no-probes"] && fs.existsSync(path.join(REPO, "apps/app/app.json"))) {
  execSync("node scripts/shots/probes/startup.mjs", { cwd: REPO, stdio: "inherit" });
}
