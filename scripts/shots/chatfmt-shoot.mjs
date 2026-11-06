// Lane l-chatfmt, run on the build box from the worktree (no ensureDeps, the shared node_modules is never reinstalled):
//   node scripts/shots/chatfmt-shoot.mjs --shots [out-dir] [--skip-export]   one reply with every format, paper and graphite, wide and phone
//   node scripts/shots/chatfmt-shoot.mjs --perf [--skip-export]              a 2,000-message chat: open it, show every earlier message, scroll bottom to top and back, type in the box
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/l-chatfmt-shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox", "--js-flags=--expose-gc"] });
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] : 0; };

if (args.includes("--shots")) {
  const SIZES = { wide: { width: 1100, height: 2300 }, phone: { width: 390, height: 3000 } };
  for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(routeUrl(real.origin, "/m/CHATFMT_01", skin), { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("[data-testid='reply']", { timeout: 20000 });
    await page.waitForTimeout(1500);
    const file = path.join(out, `chatfmt-${skin}-${size}.png`);
    await page.screenshot({ path: file });
    // press a choice and open a closed section: the pressed states
    const closed = await page.$("[data-testid^='details-']:not([aria-expanded='true'])");
    if (closed) await closed.click();
    const choice = await page.$("[data-testid^='choice-']");
    if (choice) await choice.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `chatfmt-${skin}-${size}-pressed.png`) });
    console.log(file, errs.length ? `errors: ${errs.join(" | ")}` : "no page errors");
    await ctx.close();
  }
}

if (args.includes("--perf")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const t0 = Date.now();
  await page.goto(routeUrl(real.origin, "/m/CHATFMT_02", "paper"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
  await page.waitForSelector("[data-testid^='msg-']", { timeout: 30000 });
  const open = Date.now() - t0;
  let clicks = 0;
  const showAllStart = Date.now();
  for (; clicks < 60; clicks++) {
    const b = await page.$("[data-testid='earlier-button']");
    if (!b) break;
    await b.click();
    await page.waitForTimeout(80);
  }
  const showAll = Date.now() - showAllStart;
  await page.waitForTimeout(1000);
  const rows = await page.evaluate(() => document.querySelectorAll("[data-testid^='msg-']").length);
  const feed = "[data-testid='conversation-feed']";
  await page.evaluate(() => { if (globalThis.gc) globalThis.gc(); });
  const scroll = await page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    const longs = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }).observe({ type: "longtask", buffered: false });
    let shift = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) shift += e.value; }).observe({ type: "layout-shift", buffered: false });
    const frames = [];
    const run = (from, to, px) => new Promise((resolve) => {
      el.scrollTop = from;
      let last = performance.now();
      const step = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        const dir = to > from ? 1 : -1;
        el.scrollTop += dir * px;
        if ((dir > 0 && el.scrollTop >= to - 1) || (dir < 0 && el.scrollTop <= to + 1)) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const max = el.scrollHeight - el.clientHeight;
    await run(max, 0, 400);
    await run(0, el.scrollHeight - el.clientHeight, 400);
    await new Promise((r) => setTimeout(r, 300));
    return { frames, longs, shift, scrollHeight: el.scrollHeight };
  }, feed);
  // typing: time from a key to the next frame, 25 keys
  const box = await page.$("textarea, [contenteditable='true'], [data-testid='composer-input'] input, input[type='text']");
  const keys = [];
  if (box) {
    await box.click();
    for (let i = 0; i < 25; i++) {
      const t = await page.evaluate(() => performance.now());
      await page.keyboard.type("a");
      const dt = await page.evaluate((t1) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t1)))), t);
      keys.push(dt);
    }
  }
  const res = {
    messages: 2000, rowsInDom: rows, earlierClicks: clicks, openMs: open, showAllMs: showAll, scrollHeight: scroll.scrollHeight,
    scroll: { frames: scroll.frames.length, p50: +pct(scroll.frames, 0.5).toFixed(1), p95: +pct(scroll.frames, 0.95).toFixed(1), p99: +pct(scroll.frames, 0.99).toFixed(1), max: +Math.max(...scroll.frames).toFixed(1), over50ms: scroll.frames.filter((f) => f > 50).length },
    longTasks: { count: scroll.longs.length, totalMs: Math.round(scroll.longs.reduce((a, b) => a + b, 0)), worstMs: Math.round(Math.max(0, ...scroll.longs)) },
    layoutShift: +scroll.shift.toFixed(4),
    typing: keys.length ? { keys: keys.length, p50: +pct(keys, 0.5).toFixed(1), p95: +pct(keys, 0.95).toFixed(1), max: +Math.max(...keys).toFixed(1) } : "no input found",
    pageErrors: errs.length,
  };
  fs.writeFileSync(path.join(out, "perf.json"), JSON.stringify(res, null, 2));
  console.log("PERF " + JSON.stringify(res));
}
await browser.close();
real.close?.();
process.exit(0);
