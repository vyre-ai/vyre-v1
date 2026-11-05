// l-ui221: the model menu opened from the composer of the Thread pane (and a phone sheet), then the error card with the account notice. Run on the box from the worktree:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-ui221-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-ui221/thread";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { w1440: { width: 1440, height: 900 }, w1280: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const t = loadTargets(path.join(REPO, "scripts/shots")).find((x) => x.id === "THREADREPLIES_01-thread");
for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=thread-side]", { timeout: 15000 }).catch(() => console.log("no thread-side"));
  await page.waitForTimeout(1500);
  const strips = await page.$$("[data-testid=composer-strip]");
  console.log(skin, size, "strips", strips.length);
  const strip = strips[strips.length - 1];
  if (strip) { await strip.click().catch((e) => console.log("click", String(e).slice(0, 100))); await page.waitForTimeout(900); }
  const m = await page.evaluate(() => {
    const r = (id) => { const e = document.querySelector(`[data-testid=${id}]`); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { side: r("thread-side"), panel: r("composer-panel"), conv: r("conversation") };
  });
  console.log(JSON.stringify(m));
  await page.screenshot({ path: path.join(out, `thread-menu-${skin}-${size}.png`) });
  for (const label of ["Model", "Runs on", "Compact"]) {
    const row = page.locator("[data-testid=composer-panel]").getByText(label, { exact: true }).first();
    if (await row.count()) { await row.click().catch(() => undefined); await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, `thread-menu-${label.replace(" ", "")}-${skin}-${size}.png`) }); await row.click().catch(() => undefined); }
  }
  // the notice line: pick a model, then check the list still ends at its last row (a cut-off card shows as a gap between the scroll position and the end)
  await page.keyboard.press("Escape").catch(() => undefined);
  await strip?.click().catch(() => undefined); await page.waitForTimeout(500);
  const model = page.locator("[data-testid=composer-panel]").getByText("Model", { exact: true }).first();
  if (await model.count()) { await model.click().catch(() => undefined); await page.waitForTimeout(400); await page.locator("[data-testid=composer-panel]").getByText("Sonnet", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1200); }
  await page.keyboard.press("Escape").catch(() => undefined); await page.waitForTimeout(500);
  const gap = await page.evaluate(() => [...document.querySelectorAll("[data-testid=conversation-feed]")].map((f) => Math.round(f.scrollHeight - f.scrollTop - f.clientHeight)));
  console.log(skin, size, "notice", await page.locator("[data-testid=conversation-line]").allTextContents(), "gap-to-end", JSON.stringify(gap));
  await page.screenshot({ path: path.join(out, `thread-notice-${skin}-${size}.png`) });
  await ctx.close();
}
// the error card (Docs: restricted file, with Retry, Details and Report) as the last message, with the account notice showing under it
for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries({ w1440: SIZES.w1440, phone: SIZES.phone })) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const url = routeUrl(real.origin, "/m/P-L9b_04?v=errors", skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector("[data-testid=err-retry]", { timeout: 15000 }).catch(() => console.log("no error card"));
  await page.waitForTimeout(1200);
  const measure = () => page.evaluate(() => {
    const f = document.querySelector("[data-testid=conversation-feed]").getBoundingClientRect();
    const out = {};
    for (const id of ["err-retry", "err-what", "err-report"]) { const e = document.querySelector(`[data-testid=${id}]`); out[id] = e ? Math.round(f.bottom - e.getBoundingClientRect().bottom) : null; }
    return out;
  });
  const before = await measure();
  await page.screenshot({ path: path.join(out, `error-before-${skin}-${size}.png`) });
  await page.locator("[data-testid=composer-strip]").first().click().catch((e) => console.log("strip", String(e).slice(0, 80)));
  await page.waitForTimeout(600);
  const model = page.locator("[data-testid=composer-panel]").getByText("Model", { exact: true }).first();
  if (await model.count()) { await model.click().catch(() => undefined); await page.waitForTimeout(400); await page.locator("[data-testid=composer-panel]").getByText("Sonnet", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1200); }
  await page.keyboard.press("Escape").catch(() => undefined); await page.waitForTimeout(600);
  const after = await measure();
  console.log(skin, size, "notice", await page.locator("[data-testid=conversation-line]").allTextContents(), "space under buttons before", JSON.stringify(before), "after", JSON.stringify(after));
  await page.screenshot({ path: path.join(out, `error-notice-${skin}-${size}.png`) });
  await ctx.close();
}
await browser.close(); real.close();
