// l-perf221 probe: where the all-day chips land for a viewer at ?tzoff (needs the dist from l-perf221-shoot.mjs).
import path from "node:path";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const real = await serve(path.join(REPO, "scripts/shots/app/dist"), { spa: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const tz of [0, 300, -480]) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(routeUrl(real.origin, `/m/CALWEEK_01?view=week&tzoff=${tz}`, "paper"), { waitUntil: "load" });
  await page.waitForSelector("[data-testid='cal-allday']", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const out = await page.evaluate(() => [...document.querySelectorAll("[data-testid^='allday:']")].map((n) => { const r = n.getBoundingClientRect(); return `${n.textContent} x=${Math.round(r.left)}-${Math.round(r.right)}`; }));
  console.log(tz, JSON.stringify(out));
}
await browser.close(); real.close(); process.exit(0);
