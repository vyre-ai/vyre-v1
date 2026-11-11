#!/usr/bin/env node
import { gotoSafe } from "../lib.mjs";
// Shared open-speed probe (ruling 43, P-CI_17). A target in scripts/shots/targets/*.json declares
//   "probe": { "kind": "open", "budgetMs": 200, "runs": 6 }
// and the probe mounts its route fresh `runs` times (a new browser context each), times each open from navigation start to the target's
// waitFor selector, discards the first run (warm-up), compares the median of the rest (5 with runs 6) to the budget, prints the worst, and exits 1
// on a breach so the shots job fails. One probe replaces the per-mount open, navigate and chat-open probes.
//   node scripts/shots/probes/open.mjs [--target <id|P-packet|all>] [--skin paper] [--app scripts/shots/app]
// It reads the Expo web export shots.mjs already built (scripts/shots/app/dist); with no export or no probe targets it says so and passes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_RUNS = 6;
export const MIN_RUNS = 3;

/** The probe a target declares, with defaults, or null when it declares none. Throws on a malformed one so a typo cannot silently skip a budget. */
export function parseProbe(target) {
  const p = target.probe;
  if (p === undefined || p === null) return null;
  if (p.kind !== "open") return null;
  if (typeof p.budgetMs !== "number" || !(p.budgetMs > 0)) throw new Error(`${target.id}: probe.budgetMs must be a positive number`);
  const runs = p.runs === undefined ? DEFAULT_RUNS : p.runs;
  if (!Number.isInteger(runs) || runs < MIN_RUNS) throw new Error(`${target.id}: probe.runs must be an integer of at least ${MIN_RUNS} (the first is a discarded warm-up)`);
  if (!target.waitFor) throw new Error(`${target.id}: an open probe needs the target's waitFor selector (what "open" means)`);
  return { budgetMs: p.budgetMs, runs };
}

/** Median of a list of numbers; NaN when empty. */
export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** From every run's time (first is the warm-up): the timed samples, their median and worst. A failed run is null and counts as a breach. */
export function summarizeOpen(times, budgetMs) {
  const timed = times.slice(1);
  const failed = timed.some((t) => t === null || !(t >= 0));
  const ok = timed.filter((t) => t !== null && t >= 0);
  const med = failed || !ok.length ? Infinity : Math.round(median(ok) * 10) / 10;
  const worst = ok.length ? Math.round(Math.max(...ok) * 10) / 10 : Infinity;
  return { warmup_ms: times[0] === null ? null : Math.round(times[0] * 10) / 10, samples: ok.map((t) => Math.round(t * 10) / 10), median_ms: med, worst_ms: worst, failed, ok: !failed && med <= budgetMs };
}

/** One fresh mount: a new context, navigate, and the time until the selector is visible, from navigation start. Null when it never appears. */
export async function timeOpen(browser, { url, selector, viewport, scheme = "light", timeoutMs = 30000 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce" });
  try {
    const page = await ctx.newPage();
    await gotoSafe(page, url, { waitUntil: "commit", timeout: timeoutMs });
    const ms = await page.evaluate(({ selector, timeoutMs }) => new Promise((resolve) => {
      const seen = () => { const el = document.querySelector(selector); return el !== null && (el.getClientRects().length > 0); };
      const done = () => resolve(performance.now());
      if (seen()) return done();
      const mo = new MutationObserver(() => { if (seen()) { mo.disconnect(); done(); } });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      setTimeout(() => { mo.disconnect(); resolve(null); }, timeoutMs);
    }), { selector, timeoutMs }).catch(() => null);
    return ms;
  } finally { await ctx.close(); }
}

/** Runs a target's probe: `runs` fresh mounts, summary against the budget. `time` is injectable so tests pass a fake mount. */
export async function runOpenProbe(target, { time }) {
  const probe = parseProbe(target);
  if (probe === null) return null;
  const times = [];
  for (let i = 0; i < probe.runs; i++) times.push(await time(target, i));
  return { target: target.id, budget_ms: probe.budgetMs, runs: probe.runs, ...summarizeOpen(times, probe.budgetMs) };
}

export function metricLine(r) {
  return `METRIC ${JSON.stringify({ name: "open", ...r, median_ms: Number.isFinite(r.median_ms) ? r.median_ms : null, worst_ms: Number.isFinite(r.worst_ms) ? r.worst_ms : null })}`;
}

async function main() {
  const { parseArgs, routeUrl, loadTargets, SIZES } = await import("../lib.mjs");
  const { serve } = await import("../serve.mjs");
  const { ensureDeps, ensureChromium } = await import("../ensure-deps.mjs");
  const HERE = path.dirname(fileURLToPath(import.meta.url)), SHOTS = path.resolve(HERE, ".."), REPO = path.resolve(SHOTS, "../..");
  const args = parseArgs(process.argv.slice(2));
  const want = args.target || "all";
  const skin = args.skin || "paper";
  const targets = loadTargets(SHOTS).filter((t) => t.probe && t.probe.kind === "open" && (want === "all" || t.id === want || (want.startsWith("P-") && t.id.startsWith(want + "-"))));
  if (!targets.length) { console.log(`open probe: skipped, no target of ${want} declares probe.kind "open"`); return 0; }
  const dist = path.join(path.resolve(REPO, args.app || "scripts/shots/app"), "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) { console.log("open probe: skipped, no web export (shots.mjs exports it first)"); return 0; }
  await ensureDeps(REPO);
  ensureChromium(REPO);
  const server = await serve(dist, { spa: true });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const failed = [];
  try {
    for (const t of targets) {
      const r = await runOpenProbe(t, { time: (tg) => timeOpen(browser, { url: routeUrl(server.origin, tg.route, skin), selector: tg.waitFor, viewport: SIZES.desktop }) });
      console.log(metricLine(r));
      console.log(`open ${r.ok ? "ok" : "OVER BUDGET"} ${t.id}: median ${r.median_ms}ms of ${r.samples.length} (budget ${r.budget_ms}ms), worst ${r.worst_ms}ms, warm-up ${r.warmup_ms}ms discarded`);
      if (!r.ok) failed.push(t.id);
    }
  } finally { await browser.close(); server.close(); }
  if (failed.length) { console.error(`open probe over budget: ${failed.join(", ")}`); return 1; }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
