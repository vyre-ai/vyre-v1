// What differs between the exported (pre-rendered) HTML of a mount and the page after it hydrates: the text of each, at one size. Run from the worktree after an export:
//   MOUNT=P-L9f_04 node scripts/shots/l-backup-hydrate-probe.mjs
import path from "node:path";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const real = await serve(path.join(REPO, "scripts/shots/app/dist"), { spa: true });
const mount = process.env.MOUNT || "P-L9f_04";
const width = Number(process.env.WIDTH || 1440);
const html = await (await fetch(`${real.origin}/m/${mount}`)).text();
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
const server = text(html.slice(html.indexOf("<body")));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 80)));
await page.goto(`${real.origin}/m/${mount}`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const client = text(await page.evaluate(() => document.body.innerHTML));
const a = new Set(server), b = new Set(client);
console.log("errors", errs);
console.log("only in the pre-rendered HTML:", server.filter((x) => !b.has(x)).slice(0, 15));
console.log("only after hydration:", client.filter((x) => !a.has(x)).slice(0, 15));
await browser.close(); real.close(); process.exit(0);
