// l-composer: the app's composer next to the prototype's: empty, multi-line, the menu and its Model list, the question island, the typing row. Run on the box:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/ci-run/ms-playwright node scripts/shots/l-composer-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-composer/app";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync((await import(path.join(REPO, "scripts/shots/expo-cmd.mjs"))).exportCmd(REPO), { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const SIZES = { wide: [1440, 900], phone: [390, 844] };
const TEXT1 = "Thanks for the comparison. Please book Thursday at 14:00 with Harbor and send the vendor a calendar invite.";
const TEXT2 = "Before you do, check the retainer in the engagement letter still reads 2,500.";
for (const skin of ["graphite", "paper"]) for (const [size, [w, h]] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const go = async (route, sel) => { const url = routeUrl(real.origin, route, skin); await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 })); await page.waitForSelector(sel, { timeout: 15000 }).catch(() => console.log("missing", sel, route)); await page.waitForTimeout(1200); };
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}-${skin}-${size}.png`) }); const c = await page.$("[data-testid=composer]"); if (c) await c.screenshot({ path: path.join(out, `${name}-dock-${skin}-${size}.png`) }).catch(() => undefined); };
  const geo = (tag) => page.evaluate((t) => { const c = document.querySelector("[data-testid=composer]"); const f = document.querySelector("[data-testid=composer-field]"); const b = c.getBoundingClientRect(); const e = f.getBoundingClientRect(); const cs = getComputedStyle(c); return `${t}: box ${Math.round(b.width)}x${Math.round(b.height)} radius ${cs.borderTopLeftRadius} field ${Math.round(e.width)}x${Math.round(e.height)}`; }, tag).then((x) => console.log(skin, size, x));
  await go("/m/P-L9b_04?v=idle", "[data-testid=composer-field]");
  await shot("empty"); await geo("empty");
  await page.locator("[data-testid=composer-field]").first().click();
  await page.keyboard.type(TEXT1); await page.keyboard.press("Shift+Enter"); await page.keyboard.type(TEXT2); await page.waitForTimeout(500);
  await shot("multi"); await geo("multi");
  await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); await page.waitForTimeout(300);
  await page.locator("[data-testid=composer-strip]").first().click(); await page.waitForTimeout(500);
  await shot("menu");
  await page.locator("[data-testid=model-model]").click().catch(() => undefined); await page.waitForTimeout(400);
  await shot("menu-sub");
  await go("/m/P-L9b_04?v=plan", "[data-testid=question-island]");
  await shot("island");
  console.log(skin, size, "island", JSON.stringify(await page.evaluate(() => { const i = document.querySelector("[data-testid=question-island]"); const c = document.querySelector("[data-testid=composer]"); if (!i || !c) return null; const a = i.getBoundingClientRect(), b = c.getBoundingClientRect(); return { island: [Math.round(a.left), Math.round(a.top), Math.round(a.width), Math.round(a.height)], composer: [Math.round(b.left), Math.round(b.top), Math.round(b.width)], gap: Math.round(b.top - a.bottom) }; })));
  if (size === "wide") { await go("/m/UI221_01?part=main&name=amicuspro&dex=1&typing=Omar", "[data-testid=typing-row]"); await shot("channel"); }
  await ctx.close();
}
await browser.close(); real.close();
