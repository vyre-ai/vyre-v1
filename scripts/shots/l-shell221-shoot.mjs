// l-shell221: every place at 1440, 2000, 1100, 900 and a phone, graphite and paper, with and without a side pane. Measures every gap by script and asserts the 8 px gutter. Run on the box from the worktree:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-shell221-shoot.mjs [out-dir] [--skip-export] [--places=chats,vault]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-shell221/shots";
const only = (args.find((a) => a.startsWith("--places=")) ?? "").slice(9).split(",").filter(Boolean);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { w2000: { width: 2000, height: 1000 }, w1440: { width: 1440, height: 900 }, w1100: { width: 1100, height: 800 }, w900: { width: 900, height: 800 }, phone: { width: 400, height: 844 } };
const sizeOnly = (args.find((a) => a.startsWith("--sizes=")) ?? "").slice(8).split(",").filter(Boolean);
if (sizeOnly.length) for (const k of Object.keys(SIZES)) if (!sizeOnly.includes(k)) delete SIZES[k];
const PLACES = (only.length ? only : ["chats", "records", "files", "vault", "settings", "console", "automations"]);
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;
/** Every rect that matters: the rail, every left panel in order, main, every right panel in order. */
const measure = (page) => page.evaluate(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const rect = (e) => { const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return null; return { l: r1(b.left), r: r1(b.right), t: r1(b.top), b: r1(b.bottom), w: Math.round(b.width) }; };
  const one = (sel) => { const e = document.querySelector(sel); return e ? rect(e) : null; };
  const many = (sel) => [...document.querySelectorAll(sel)].map(rect).filter(Boolean).sort((x, y) => x.l - y.l);
  const sheets = document.querySelector("[data-testid=sheets]");
  return {
    phone: window.innerWidth < 768, hscroll: document.documentElement.scrollWidth - innerWidth, win: { w: innerWidth, h: innerHeight },
    rail: one("[data-testid=shell-rail]"), main: one("[data-testid=sheet-main]"),
    lefts: many("[data-testid=sheet-left-wrap] > [data-testid=place-sidebar], [data-testid=sheet-left] > *"),
    rights: many("[data-testid=sheet-right] > *"),
    band: sheets?.getAttribute("data-band") ?? null, sidebarMode: sheets?.getAttribute("data-sidebar") ?? null, paneMode: sheets?.getAttribute("data-pane") ?? null, reading: one("[data-testid=reading]"),
  };
});
function check(label, m) {
  const errs = [];
  const eq = (name, got, want = 8) => { if (got === null || Math.abs(got - want) > 0.6) errs.push(`${name}=${got}`); };
  if (m.phone) return m.hscroll ? [`horizontal scroll ${m.hscroll}`] : errs;
  if (!m.rail || !m.main) return [`missing rail/main ${JSON.stringify({ rail: !!m.rail, main: !!m.main })}`];
  const lefts = m.sidebarMode === "docked" ? m.lefts : [];
  const rights = m.paneMode === "docked" ? m.rights : [];
  const row = [m.rail, ...lefts, m.main, ...rights];
  eq("edge-left", m.rail.l);
  eq("bottom-edge", m.win.h - m.rail.b);
  for (let i = 0; i + 1 < row.length; i++) eq(`gap${i}`, row[i + 1].l - row[i].r);
  const last = row[row.length - 1];
  if (m.paneMode !== "overlay") eq("edge-right", m.win.w - last.r);
  const tops = row.map((x) => x.t), bottoms = row.map((x) => x.b);
  if (Math.max(...tops) - Math.min(...tops) > 0.6) errs.push(`tops ${tops}`);
  if (Math.max(...bottoms) - Math.min(...bottoms) > 0.6) errs.push(`bottoms ${bottoms}`);
  if (m.main.w < 480 && (m.band === "wide" || m.band === "mid")) errs.push(`main ${m.main.w} under 480`);
  if (m.reading && m.reading.w > 720.5) errs.push(`reading ${m.reading.w}`);
  return errs;
}
const CASES = [];
for (const place of PLACES) for (const pane of [0, 1]) CASES.push({ place, pane, real: 0 });
for (const place of ["vault", "settings", "console"]) if (!only.length || only.includes(place)) CASES.push({ place, pane: 0, real: 1 });
for (const skin of ["graphite", "paper"]) for (const [size, vp] of Object.entries(SIZES)) for (const { place, pane, real: realOn } of CASES) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, `/m/SHELL221_01?place=${place}&pane=${pane}${realOn ? "&real=1" : ""}`, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=shell-rail], [data-testid=shell-rail-bottom]", { timeout: 15000 }).catch(() => errs.push("no rail"));
  await page.waitForTimeout(700);
  const m = await measure(page);
  const e = check(`${skin} ${size} ${place} pane${pane}`, m);
  if (e.length || errs.length) bad++;
  const name = `${place}${realOn ? "-real" : ""}-${skin}-${size}-pane${pane}`;
  if ((place === "chats" && !realOn) || realOn || skin === "graphite" && (size === "w1440" || size === "w2000")) await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`${e.length || errs.length ? "FAIL" : "ok  "} ${name} band=${m.band} sb=${m.sidebarMode} pane=${m.paneMode} lefts=${m.lefts.map((x) => x.w)} main=${m.main && m.main.w} rights=${m.rights.map((x) => x.w)} ${e.join("; ")} ${errs.join(" | ").slice(0, 300)}`);
  await ctx.close();
}
console.log(bad === 0 ? "ALL GAPS 8" : `${bad} FAILED`);
await browser.close(); real.close();
process.exit(bad === 0 ? 0 : 1);
