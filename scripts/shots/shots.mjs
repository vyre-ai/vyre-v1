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

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = parseArgs(process.argv.slice(2));
const appDir = path.resolve(REPO, args.app || "scripts/shots/app");
const out = path.resolve(REPO, args.out || "shots-out");
const skins = (args.skins || SKINS.join(",")).split(",");
const sizes = (args.sizes || Object.keys(SIZES).join(",")).split(",").map((n) => [n, SIZES[n]]);
const maxExport = Number(args["max-export-s"] || MAX_EXPORT_S);
const want = args.target || "all";

const targets = loadTargets(HERE).filter((t) => want === "all" || t.id === want);
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
try {
  for (const t of targets) for (const skin of skins) for (const [sizeName, vp] of sizes) {
    const dir = path.join(out, t.id); fs.mkdirSync(dir, { recursive: true });
    const stem = `${skin}-${sizeName}`;
    const shoot = async (url, file, settleMs, scheme) => {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      if (t.waitFor) await page.waitForSelector(t.waitFor, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(settleMs);
      await page.screenshot({ path: file });
      await ctx.close();
    };
    const scheme = skin === "graphite" ? "dark" : "light";
    await shoot(routeUrl(real.origin, t.route, skin), path.join(dir, `${stem}-real.png`), 800, scheme);
    await shoot(`${proto.origin}/vyre-v1.html#${protoHash(t.proto, skin)}`, path.join(dir, `${stem}-proto.png`), t.protoSettleMs ?? 3000, scheme);
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
} finally { await browser.close(); real.close(); proto.close(); }
fs.writeFileSync(path.join(out, "index.md"), `# Side-by-side screenshots\n\nExport: ${exportSeconds ? exportSeconds.toFixed(1) + " s" : "skipped"} (budget ${maxExport} s)\n\n| target | skin | size | file |\n|---|---|---|---|\n${rows.join("\n")}\n`);
if (exportSeconds > maxExport) { console.error(`web export took ${exportSeconds.toFixed(1)} s, over ${maxExport} s`); process.exit(1); }
console.log(`${rows.length} side-by-side images in ${out}`);
