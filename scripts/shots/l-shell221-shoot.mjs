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
const SIZES = { w2000: { width: 2000, height: 1000 }, w1440: { width: 1440, height: 900 }, w1100: { width: 1100, height: 800 }, w900: { width: 900, height: 800 }, phone: { width: 390, height: 844 } };
const PLACES = (only.length ? only : ["chats", "records", "files", "vault", "settings", "console", "automations"]);
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;
/** Every rect that matters, then every gap between neighbours. */
const measure = (page) => page.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return null; return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top * 10) / 10, b: Math.round(b.bottom * 10) / 10, w: Math.round(b.width) }; };
  return { phone: window.innerWidth < 768, hscroll: document.documentElement.scrollWidth - innerWidth, win: { w: innerWidth, h: innerHeight }, rail: box("[data-testid=shell-rail]"), side: box("[data-testid=place-sidebar]"), main: box("[data-testid=sheet-main]"), pane: box("[data-testid=side-pane]"), band: document.querySelector("[data-testid=sheets]")?.getAttribute("data-band") ?? null, sidebarMode: document.querySelector("[data-testid=sheets]")?.getAttribute("data-sidebar") ?? null, paneMode: document.querySelector("[data-testid=sheets]")?.getAttribute("data-pane") ?? null, reading: box("[data-testid=reading]") };
});
function check(label, m) {
  const errs = [];
  const eq = (name, got, want = 8) => { if (got === null || Math.abs(got - want) > 0.6) errs.push(`${name}=${got}`); };
  if (m.phone) return m.hscroll ? [`horizontal scroll ${m.hscroll}`] : errs;
  if (!m.rail || !m.main) return [`missing rail/main ${JSON.stringify({ rail: !!m.rail, main: !!m.main })}`];
  eq("edge-left", m.rail.l);
  eq("bottom-edge", m.win.h - m.rail.b);
  const first = m.sidebarMode === "docked" && m.side ? m.side : m.main;
  eq("rail-to-next", first.l - m.rail.r);
  if (m.sidebarMode === "docked" && m.side) eq("sidebar-to-main", m.main.l - m.side.r);
  const docked = m.paneMode === "docked" && m.pane;
  if (docked) { eq("main-to-pane", m.pane.l - m.main.r); eq("pane-to-edge", m.win.w - m.pane.r); } else if (m.paneMode !== "overlay") eq("main-to-edge", m.win.w - m.main.r);
  const tops = [m.rail.t, m.main.t, ...(m.sidebarMode === "docked" && m.side ? [m.side.t] : []), ...(docked ? [m.pane.t] : [])];
  const bottoms = [m.rail.b, m.main.b, ...(m.sidebarMode === "docked" && m.side ? [m.side.b] : []), ...(docked ? [m.pane.b] : [])];
  if (Math.max(...tops) - Math.min(...tops) > 0.6) errs.push(`tops ${tops}`);
  if (Math.max(...bottoms) - Math.min(...bottoms) > 0.6) errs.push(`bottoms ${bottoms}`);
  if (m.main.w < 480 && (m.band === "wide" || m.band === "mid")) errs.push(`main ${m.main.w} under 480`);
  if (m.reading && m.reading.w > 720.5) errs.push(`reading ${m.reading.w}`);
  return errs;
}
for (const skin of ["graphite", "paper"]) for (const [size, vp] of Object.entries(SIZES)) for (const place of PLACES) for (const pane of [0, 1]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, `/m/SHELL221_01?place=${place}&pane=${pane}`, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=shell-rail], [data-testid=shell-rail-bottom]", { timeout: 15000 }).catch(() => errs.push("no rail"));
  await page.waitForTimeout(700);
  const m = await measure(page);
  const e = check(`${skin} ${size} ${place} pane${pane}`, m);
  if (e.length || errs.length) bad++;
  const name = `${place}-${skin}-${size}-pane${pane}`;
  if (place === "chats" || skin === "graphite" && (size === "w1440" || size === "w2000")) await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`${e.length || errs.length ? "FAIL" : "ok  "} ${name} band=${m.band} sb=${m.sidebarMode} pane=${m.paneMode} rail=${JSON.stringify(m.rail)} side=${m.side && m.side.w} main=${m.main && m.main.w} pane=${m.pane && m.pane.w} ${e.join("; ")} ${errs.join(" | ").slice(0, 300)}`);
  await ctx.close();
}
console.log(bad === 0 ? "ALL GAPS 8" : `${bad} FAILED`);
await browser.close(); real.close();
process.exit(bad === 0 ? 0 : 1);
