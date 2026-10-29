// Signed-in cold start of the production web export (apps/app/dist), the number the signed-out probe (startup.mjs) cannot see: a seeded Space booted as a real daemon, the owner's
// stored session in the browser, app.start to app.usable at /home on a phone at 4x CPU, seven cold runs, median. Reported, not gated: the budget is the signed-out cold start.
//   node scripts/shots/startup-signed-in.ts [--dist apps/app/dist] [--runs 7]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootSpace, edge, ownerSession } from "../../apps/app/tests/real-app-harness.test.ts";
import { createCapCaller } from "../../apps/app/src/shell/session/caps.ts";
import { parseArgs } from "./lib.mjs";

// self-contained (no shared helpers) so the same file measures a base branch too
const median = (v: (number | null)[]): number | null => { const s = v.filter((x): x is number => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : null; };
const cpuSteal = (): { steal: number; total: number } | null => {
  try { const f = fs.readFileSync("/proc/stat", "utf8").split("\n")[0]!.trim().split(/\s+/).slice(1).map(Number); return { steal: f[7] ?? 0, total: f.reduce((a, b) => a + b, 0) }; } catch { return null; }
};
const stealPct = (a: { steal: number; total: number } | null, b: { steal: number; total: number } | null): number | null => (a && b && b.total > a.total ? +((100 * (b.steal - a.steal)) / (b.total - a.total)).toFixed(2) : null);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2)) as { dist?: string; runs?: string };
const dist = path.resolve(REPO, args.dist ?? "apps/app/dist");
const runs = Number(args.runs ?? 7);
const { chromium } = await import("playwright-core");

const space = await bootSpace();
const web = await edge(dist, space.url);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const cold: (number | null)[] = [];
let shell = 0;
const steal0 = cpuSteal();
try {
  const marker = ((await createCapCaller({ baseUrl: space.url, token: () => space.token })("spaces.get", {})) as { space: { fingerprint: string } }).space.fingerprint;
  const saved = JSON.stringify({ sessions: { [web.origin]: { ...ownerSession(space, web.origin), marker } } });
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((v: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", v); } catch { /* blocked storage */ } }, saved);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(web.origin + "/home", { waitUntil: "load" });
    await page.waitForFunction(() => performance.getEntriesByName("app.usable").length > 0, null, { timeout: 30000 }).catch(() => {});
    cold.push(await page.evaluate(() => { const a = performance.getEntriesByName("app.start")[0], b = performance.getEntriesByName("app.usable")[0]; return a && b ? Math.round(b.startTime - a.startTime) : null; }));
    // proof the run was signed in: the phone shell draws (a sign-in screen would also mark usable)
    if (await page.waitForSelector('[data-testid="mobile-shell"]', { timeout: 30000 }).then(() => true, () => false)) shell++;
    await ctx.close();
  }
} finally { await browser.close(); web.close(); await space.stop(); }
console.log(`METRIC ${JSON.stringify({ name: "startup_prod_signed_in", size: "phone", kind: "cold", cpu_rate: 4, ms: median(cold), samples: cold.length, runs: cold, signed_in_runs: shell, cpu_steal_pct: stealPct(steal0, cpuSteal()) })}`);
if (shell !== runs) { console.error(`signed-in startup: only ${shell} of ${runs} runs reached the shell`); process.exitCode = 1; }
