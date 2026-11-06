// l-ui221 round 3: the Thread pane composer with a long multi-line draft, the composer cap, Jump to latest, the pane balance (sidebar + channel + Thread pane at 1440 and 2000). Run on the box:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-ui221-r3.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-ui221/r3";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { w1440: [1440, 900], w2000: [2000, 1000], w1280: [1280, 800], phone: [390, 844] };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const LONG = ["Thanks for the comparison. Please book Thursday at 14:00 with Harbor and send the vendor a calendar invite.", "Before you do, check that the retainer in the engagement letter still reads $2,500 and not $2,800 as in the older template.", "Also ask Tess whether the second quote includes the setup fee, because Pine's page lists it separately.", "If anything is unclear, stop and ask me instead of guessing.", "One more thing: copy Maya on the invite and keep the vendor call to thirty minutes.", "Last line so this goes well past a handful of lines in the composer and has to scroll inside.", "Another line.", "And another line after that one.", "Final line."];
for (const skin of ["paper", "graphite"]) for (const [size, [w, h]] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/UI221_01?part=thread", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=thread-side]", { timeout: 15000 }).catch(() => console.log("no thread-side"));
  await page.waitForTimeout(1500);
  const geo = () => page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const fields = [...document.querySelectorAll("[data-testid=composer-field]")];
    const last = fields[fields.length - 1];
    const cb = last ? last.closest("[data-testid=composer]") : null;
    const b = cb ? cb.getBoundingClientRect() : null;
    return { side: r("[data-testid=thread-side]"), conv: r("[data-testid=conversation]"), title: r("[data-testid=conversation-title]"), titleTrunc: (() => { const t = document.querySelector("[data-testid=conversation-title]"); return t ? t.scrollWidth > t.clientWidth : null; })(), field: last ? (() => { const f = last.getBoundingClientRect(); return [Math.round(f.left), Math.round(f.width), Math.round(f.height)]; })() : null, composer: b ? [Math.round(b.left), Math.round(b.width), Math.round(b.height)] : null };
  });
  await page.screenshot({ path: path.join(out, `pane-${skin}-${size}.png`) });
  console.log(skin, size, "empty", JSON.stringify(await geo()));
  // type into the Thread pane's composer (the last one on the page)
  const field = page.locator("[data-testid=composer-field]").last();
  await field.click().catch(() => undefined);
  for (const [i, line] of LONG.entries()) { await page.keyboard.type(line, { delay: 0 }); if (i < LONG.length - 1) await page.keyboard.press("Shift+Enter"); }
  await page.waitForTimeout(800);
  console.log(skin, size, "long", JSON.stringify(await geo()));
  await page.screenshot({ path: path.join(out, `long-${skin}-${size}.png`) });
  await ctx.close();
}
// the main composer (a row at this width) with a draft of three lines
for (const skin of ["paper", "graphite"]) for (const [size, [w, h]] of Object.entries({ w2000: SIZES.w2000, w1440: SIZES.w1440 })) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/UI221_01?part=main", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=composer-field]", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const f = page.locator("[data-testid=composer-field]").first();
  await f.click().catch(() => undefined);
  await page.screenshot({ path: path.join(out, `main-one-${skin}-${size}.png`) });
  const row = await page.evaluate(() => { const c = document.querySelector("[data-testid=composer]").getBoundingClientRect(); const e = document.querySelector("[data-testid=composer-field]").getBoundingClientRect(); return [Math.round(c.width), Math.round(e.width), Math.round(c.height)]; });
  for (const t of LONG.slice(0, 3)) { await page.keyboard.type(t, { delay: 0 }); await page.keyboard.press("Shift+Enter"); }
  await page.waitForTimeout(800);
  const many = await page.evaluate(() => { const c = document.querySelector("[data-testid=composer]").getBoundingClientRect(); const e = document.querySelector("[data-testid=composer-field]").getBoundingClientRect(); return [Math.round(c.width), Math.round(e.width), Math.round(c.height)]; });
  console.log(skin, size, "main composer [box w, field w, box h] one line", JSON.stringify(row), "many lines", JSON.stringify(many));
  await page.screenshot({ path: path.join(out, `main-long-${skin}-${size}.png`) });
  await ctx.close();
}
// Jump to latest: the long thread scrolled up
for (const skin of ["paper", "graphite"]) for (const [size, [w, h]] of Object.entries({ w1440: SIZES.w1440, phone: SIZES.phone })) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/UI221_01?part=long", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=thread-side]", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const fs = [...document.querySelectorAll("[data-testid=conversation-feed]")]; const f = fs[fs.length - 1]; if (f) f.scrollTop = Math.max(0, f.scrollTop - 600); });
  await page.waitForTimeout(800);
  const pill = await page.evaluate(() => { const e = document.querySelector("[data-testid=to-latest]"); if (!e) return null; const b = e.getBoundingClientRect(); const fs = [...document.querySelectorAll("[data-testid=conversation-feed]")]; const f = fs[fs.length - 1].getBoundingClientRect(); return { pill: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], feedBottom: Math.round(f.bottom), overlapsFeed: b.top < f.bottom - 1 }; });
  console.log(skin, size, "pill", JSON.stringify(pill));
  await page.screenshot({ path: path.join(out, `pill-${skin}-${size}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
