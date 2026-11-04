// l-editor shots: the composer's long draft with three mentions, paper and graphite, wide and phone, at rest and scrolled. Also measures each wash box against the same word laid out in a plain div.
// Run on the build box from the worktree: node scripts/shots/l-editor-shoot.mjs [out-dir] [--skip-export]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl, loadTargets } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "/root/wt/tmp-l-editor/shots";
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/wt/base/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const targets = loadTargets(path.join(REPO, "scripts/shots")).filter((t) => t.id.startsWith("EDITOR_") && (process.env.ONLY ? t.id.includes(process.env.ONLY) : true));
for (const t of targets) for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const url = routeUrl(real.origin, t.route, skin);
  await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }));
  await page.waitForSelector(t.waitFor, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(900);
  if (!t.id.startsWith("EDITOR_01")) {
    // the editor page: TipTap mounts after the page, so give it time, then shoot
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(out, `${t.id.toLowerCase()}-${skin}-${size}.png`) });
    if (errs.length) console.log("errors", errs.join(" | ").slice(0, 300));
    await ctx.close();
    continue;
  }
  for (const [phase, top] of [["rest", 0], ["scrolled", 120]]) {
    await page.evaluate((y) => { const ta = document.querySelector("[data-testid=composer-field]"); ta.scrollTop = y; ta.dispatchEvent(new Event("scroll", { bubbles: true })); }, top);
    await page.waitForTimeout(250);
    // each box against the word: lay the same text out in a div with the textarea's computed metrics, take the range of the name, and compare the rect with the box
    const report = await page.evaluate(() => {
      const ta = document.querySelector("[data-testid=composer-field]");
      const cs = getComputedStyle(ta), r = ta.getBoundingClientRect();
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;left:${r.left}px;top:${r.top - ta.scrollTop}px;width:${r.width}px;font:${cs.font};letter-spacing:${cs.letterSpacing};white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;visibility:hidden;padding:0;margin:0`;
      d.textContent = ta.value; document.body.appendChild(d);
      const out = [];
      for (const b of document.querySelectorAll("[data-testid=composer-token-mention]")) {
        const name = b.textContent, at = ta.value.indexOf(name), tn = d.firstChild, rg = document.createRange();
        rg.setStart(tn, at); rg.setEnd(tn, at + name.length);
        const w = rg.getBoundingClientRect(), br = b.getBoundingClientRect();
        out.push({ name, dx: Math.round(br.left - w.left), dy: Math.round(br.top - w.top) });
      }
      d.remove();
      return { out, scrollTop: ta.scrollTop, scrollable: ta.scrollHeight > ta.clientHeight, w: r.width };
    });
    console.log(`${skin}-${size}-${phase}`, JSON.stringify(report));
    await page.screenshot({ path: path.join(out, `composer-mentions-${skin}-${size}-${phase}.png`) });
  }
  if (errs.length) console.log("errors", errs.join(" | ").slice(0, 300));
  await ctx.close();
}
await browser.close(); real.close();
process.exit(0);
