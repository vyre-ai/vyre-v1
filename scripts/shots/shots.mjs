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
import { parseArgs, SKINS, SIZES, MAX_EXPORT_S, protoHash, routeUrl, loadTargets, shardTargets, shardIndexName, sideBySideHtml } from "./lib.mjs";
import { serve } from "./serve.mjs";
import { measureScroll, withinBudget, SCROLL_P95_MS } from "./probes/scroll.mjs";
import { traceScroll } from "./probes/trace.mjs";
import { exportEnv } from "../lib/registry-hash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(REPO, args.app || "scripts/shots/app");
const out = path.resolve(REPO, args.out || "shots-out");
// --probes-only shoots nothing and runs the scroll probe; --no-probes shoots and skips it (ruling 46: speed is measured on the pinned v1-perf runners).
const skins = args["probes-only"] ? [] : (args.skins || SKINS.join(",")).split(",");
const sizes = (args.sizes || Object.keys(SIZES).join(",")).split(",").map((n) => [n, SIZES[n]]);
const maxExport = Number(args["max-export-s"] || MAX_EXPORT_S);
const want = args.target || "all";
const shardIndex = args["shard-index"] === undefined ? 0 : Number(args["shard-index"]);
const shardTotal = args["shard-total"] === undefined ? 1 : Number(args["shard-total"]);
const writeEmptyIndex = () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, shardIndexName(shardIndex, shardTotal)), "# Side-by-side screenshots\n\n0 side-by-side images.\n\n| target | skin | size | file |\n|---|---|---|---|\n");
};

// P-UI_14: the production app's startup and bundle report, on the perf runner (the target carries no screenshots). P-UI_14 ends there. On the perf job of any other branch (it runs only for a
// head commit with [perf], ruling 66) the report runs first and the scroll probe follows, so a packet that changes what the app loads (P-L9_17) gets its startup number from its own branch.
if ((want === "P-UI_14" || args["probes-only"]) && !args["skip-startup"]) {
  const { main } = await import("./startup.mjs");
  await main(["--enforce", ...(args["skip-export"] ? ["--skip-export"] : [])]);
}
if (want === "P-UI_14") {
  writeEmptyIndex();
  console.log("P-UI_14 carries startup evidence only: wrote an empty screenshot index");
  process.exit(process.exitCode ?? 0);
}

// A packet id (P-L9b_02) selects that packet's targets, whose ids start with it; "all" runs everything.
const selectedTargets = loadTargets(HERE).filter((t) => want === "all" || t.id === want || (want.startsWith("P-") && t.id.startsWith(want + "-")));
const targets = shardTargets(selectedTargets, shardIndex, shardTotal);
// A packet branch with no screenshot targets of its own (a backend packet that merged main) has nothing to shoot.
if (!targets.length && want.startsWith("P-")) {
  writeEmptyIndex();
  console.log(`no targets for ${want}: wrote an empty screenshot index`);
  process.exit(process.exitCode ?? 0);
}
if (!targets.length) { console.error(`no target ${want}`); process.exit(1); }

await ensureDeps(REPO);
ensureChromium(REPO);

const dist = path.join(appDir, "dist");
let exportSeconds = 0;
if (!args["skip-export"]) {
  fs.rmSync(dist, { recursive: true, force: true });
  const t0 = Date.now();
  execSync("npx expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
  exportSeconds = (Date.now() - t0) / 1000;
  console.log(`METRIC ${JSON.stringify({ name: "expo_web_export", seconds: exportSeconds, budget_seconds: maxExport })}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const real = await serve(dist, { spa: true });
const proto = await serve(path.join(HERE, "prototype"));
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox", "--js-flags=--expose-gc"] });
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
  // A probe that throws (a selector that never appears) is a failed probe of that target, not the end of the run: every target is measured, every METRIC prints, and the run fails at the end.
  for (const t of targets) if (t.scroll && !args["no-probes"]) {
    try {
      const ctx = await browser.newContext({ viewport: SIZES.desktop, deviceScaleFactor: 1, reducedMotion: "no-preference" });
      const page = await ctx.newPage();
      await page.goto(routeUrl(real.origin, t.route, "paper"), { waitUntil: "load", timeout: 60000 });
      // t.count: after the load, wait and count elements, so a probe run prints proof of a state (the idle face swap: how many faces are real against how many rows are on screen)
      if (t.count) {
        await page.waitForSelector(t.waitFor ?? t.scroll.selector, { timeout: 30000 });
        await page.waitForTimeout(t.count.waitMs ?? 400);
        const got = await page.evaluate(({ real, rows }) => ({ real: document.querySelectorAll(real).length, rows: document.querySelectorAll(rows).length }), t.count);
        console.log(`METRIC ${JSON.stringify({ name: t.count.name ?? "count", target: t.id, real: got.real, rows: got.rows, wait_ms: t.count.waitMs ?? 400 })}`);
      }
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
    } catch (e) {
      console.log(`METRIC ${JSON.stringify({ name: "scroll", target: t.id, error: String(e?.message ?? e).split("\n")[0] })}`);
      scrollFailed.push(t.id);
    }
  }
} finally { await browser.close(); real.close(); proto.close(); }
fs.writeFileSync(path.join(out, shardIndexName(shardIndex, shardTotal)), `# Side-by-side screenshots\n\nExport: ${exportSeconds ? exportSeconds.toFixed(1) + " s" : "skipped"} (budget ${maxExport} s)\n\n| target | skin | size | file |\n|---|---|---|---|\n${rows.join("\n")}\n`);
// Every gate is judged before the run ends, so one red never hides the next measure: the failures are collected and the process exits at the end.
let failedGate = false;
if (scrollFailed.length) { console.error(`scroll probe over budget: ${scrollFailed.join(", ")}`); failedGate = true; }
if (exportSeconds > maxExport) { console.error(`web export took ${exportSeconds.toFixed(1)} s, over ${maxExport} s`); failedGate = true; }
console.log(`${rows.length} side-by-side images in ${out}`);

// Startup probe on the real app (budget startup). Skipped when a single target or no apps/app is asked for.
if (want === "all" && !args["skip-startup"] && !args["no-probes"] && fs.existsSync(path.join(REPO, "apps/app/app.json"))) {
  try { execSync("node scripts/shots/probes/startup.mjs", { cwd: REPO, stdio: "inherit" }); } catch { failedGate = true; }
}
if (failedGate) process.exit(1);
