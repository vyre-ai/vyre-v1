// l-editor: the composer at each width and state, both skins, with the controls' vertical centres measured. Run on the build box from the worktree:
//   node scripts/shots/l-editor-composer.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-editor/composer";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/wt/base/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
// [window width, pane width]: the window widths of the brief, and the 700 px chat column beside a task pane in a wide window
const SIZES = [[1440, 0], [1100, 0], [800, 0], [700, 0], [560, 0], [390, 0], [1440, 700], [1440, 600]];
const STATES = ["empty", "long", "chips", "reply", "strip", "off"];
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const bad = [];
for (const skin of ["paper", "graphite"]) for (const [w, pane] of SIZES) for (const state of STATES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, `/m/EDITOR_07?pane=${pane || ""}&state=${state}`, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=composer]", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const box = (id) => { const e = document.querySelector(`[data-testid=${id}]`); if (!e) return null; const r = e.getBoundingClientRect(); return { cy: r.top + r.height / 2, h: r.height, left: r.left, w: r.width }; };
    const field = document.querySelector("[data-testid=composer-field]");
    const ph = field?.querySelector?.("p.is-empty, [data-placeholder]") ?? field;
    const fr = field ? field.getBoundingClientRect() : null;
    const c = box("composer"), at = box("composer-attach");
    const phc = field ? getComputedStyle(field, "::before").content : "none";
    return { ph: phc, controls: Object.fromEntries(["composer-attach", "composer-strip", "memory-switch", "composer-send"].map((k) => [k, box(k)])), composer: c, field: fr ? { left: fr.left, top: fr.top, h: fr.height } : null, plusLeft: at?.left ?? null };
  });
  const cs = Object.entries(m.controls).filter(([, v]) => v !== null);
  const centres = cs.map(([, v]) => v.cy);
  const spread = centres.length ? Math.max(...centres) - Math.min(...centres) : 0;
  console.log(`${skin} ${w}${pane ? "/pane" + pane : ""} ${state}: height=${Math.round(m.composer?.h ?? 0)} spread=${spread.toFixed(1)} fieldLeft=${Math.round(m.field?.left ?? 0)} plusLeft=${Math.round(m.plusLeft ?? 0)}`);
  if (state === "empty" && !/Message Assistant/.test(m.ph)) bad.push(`${skin} ${w} placeholder not drawn (${m.ph})`);
  if (spread > 1) bad.push(`${skin} ${w} ${state} spread ${spread.toFixed(1)}`);
  await page.screenshot({ path: path.join(out, `composer-${skin}-${w}${pane ? "p" + pane : ""}-${state}.png`) });
  await ctx.close();
}
console.log("OFF", JSON.stringify(bad));
await browser.close(); real.close();
process.exit(bad.length ? 1 : 0);
