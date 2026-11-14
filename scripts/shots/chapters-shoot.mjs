// Lane chat-chapters, on the build box from the worktree: node scripts/shots/chapters-shoot.mjs <out-dir> [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--"));
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), {
    cwd: appDir,
    stdio: "inherit",
    env: exportEnv(),
  });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { w1440: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
for (const skin of ["paper", "graphite"])
  for (const [size, vp] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      colorScheme: skin === "graphite" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(routeUrl(real.origin, "/m/CHAPTERS_01", skin), { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("[data-testid='conversation-feed']", { timeout: 30000 });
    await page.waitForSelector("[data-testid='chapter-61']", { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `real-${skin}-${size}-bottom.png`) });
    if (size === "w1440") {
      await page.hover("[data-testid='chapter-dot-31']");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `real-${skin}-${size}-raildot.png`) });
      await page.click("[data-testid='chapter-31']");
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `real-${skin}-${size}-opened.png`) });
    }
    // up to the top: the folded chapters as lines
    await page.evaluate(() => {
      const f = document.querySelector("[data-testid='conversation-feed']");
      let n = f;
      while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
      if (n) n.scrollTop = 0;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `real-${skin}-${size}-top.png`) });
    console.log(skin, size, errs.length ? `errors: ${errs.join(" | ")}` : "no page errors");
    await ctx.close();
  }
{
  const ctx = await browser.newContext({ viewport: SIZES.w1440, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CHAPTERS_01", "paper"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='chapter-61']", { timeout: 30000 });
  await page.waitForTimeout(800);
  const before = await page.locator("text=zebra clause").count();
  await page.keyboard.press("Meta+f");
  await page.waitForSelector("[data-testid='find-input']", { timeout: 10000 });
  await page.fill("[data-testid='find-input']", "zebra");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const after = await page.locator("text=zebra clause").count();
  const headOpen = await page.getAttribute("[data-testid='chapter-31']", "aria-expanded");
  console.log("FIND", JSON.stringify({ before, after, headOpen }));
  await page.screenshot({ path: path.join(out, "real-paper-w1440-find-folded.png") });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: SIZES.w1440, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CHAPTERS_03", "paper"), { waitUntil: "load", timeout: 60000 });
  const t0 = Date.now();
  await page.waitForSelector("[data-testid='chapter-4901']", { timeout: 60000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(1500);
  const scroller = () =>
    page.evaluate(() => {
      const f = document.querySelector("[data-testid='conversation-feed']");
      let n = f;
      while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
      return n ? { top: n.scrollTop, height: n.scrollHeight } : null;
    });
  const dom = await page.locator("[data-testid^='msg-']").count();
  const heads = await page.locator("[data-testid^='chapter-']").count();
  await page.evaluate(() => {
    const f = document.querySelector("[data-testid='conversation-feed']");
    let n = f;
    while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
    if (n) n.scrollTop = Math.max(0, n.scrollTop - 300);
  });
  await page.waitForTimeout(400);
  const a = await scroller();
  await page.evaluate(() => document.querySelector("[data-testid='chapter-4801']")?.click());
  await page.waitForTimeout(600);
  const b = await scroller();
  await page.evaluate(() => document.querySelector("[data-testid='chapter-4701']")?.click());
  await page.waitForTimeout(600);
  const c = await scroller();
  console.log("BIG", JSON.stringify({ readyMs: ready, domMessages: dom, chapterHeads: heads, scroll: [a, b, c] }));
  await page.screenshot({ path: path.join(out, "real-paper-w1440-5000.png") });
  await ctx.close();
}
for (const skin of ["paper", "graphite"]) {
  const ctx = await browser.newContext({
    viewport: SIZES.w1440,
    deviceScaleFactor: 1,
    colorScheme: skin === "graphite" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CHAPTERS_02", skin), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='context-card']", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `real-${skin}-w1440-pieces.png`) });
  await page.click("[data-testid='context-open']");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `real-${skin}-w1440-pieces-open.png`) });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: SIZES.w1440, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(routeUrl(real.origin, "/m/CHAPTERS_04", "paper"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid='context-card']", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, "real-paper-w1440-pieces-two.png") });
  await ctx.close();
}
await browser.close();
real.close?.();
process.exit(0);
