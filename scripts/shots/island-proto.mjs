// The prototype's Island question: the default chat scene (q('size', "How large can an upload be?")) with the feed scrolled to the top, so the question has left the screen and the Island asks it.
// Run on the build box from the worktree: node scripts/shots/island-proto.mjs [out-dir]
import fs from "node:fs";
import path from "node:path";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const out = process.argv[2] || "/root/wt/tmp-l-island2/ui-shots";
fs.mkdirSync(out, { recursive: true });
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const proto = await serve(path.join(REPO, "scripts/shots/prototype"));
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const skin of ["paper", "graphite"]) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: skin === "graphite" ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${proto.origin}/vyre-v1.html#chat,${skin}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3500);
  let found = false;
  for (const fr of page.frames()) {
    const has = await fr.evaluate(() => { const f = document.getElementById("feed"); if (!f) return false; f.scrollTop = 0; f.dispatchEvent(new Event("scroll")); return true; }).catch(() => false);
    if (has) { found = true; break; }
  }
  await page.waitForTimeout(1200);
  const need = await Promise.all(page.frames().map((fr) => fr.locator(".isl.need").count().catch(() => 0)));
  await page.screenshot({ path: path.join(out, `proto-question-${skin}-${size}.png`) });
  console.log(`proto ${skin} ${size} feed=${found} needIsland=${need.reduce((a, b) => a + b, 0)}`);
  await ctx.close();
}
await browser.close(); proto.close();
process.exit(0);
