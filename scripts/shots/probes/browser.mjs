#!/usr/bin/env node
// Browser perf probe runner (ruling 43, P-L11_02). Mounts write their measurements to window.__probes:
//   window.__probes = { startup: ms, navigate: ms, scroll: p95 frame ms, space_switch: ms, layout_shift: score, prefetch: percent, chat_open: ms, ready: true }
// A value is a number, or a function/promise-free plain number set once the measure finished; `ready: true` marks the object complete.
// A target in scripts/shots/targets/*.json declares what to judge:
//   "probes": { "navigate": {}, "prefetch": {}, "chat_open": { "budget": 100 } }   (optional "runs", default 6; optional "budget" never above perf/budgets.json)
// Per kind the runner mounts the route fresh `runs` times, discards the first (warm-up), takes the median of the other 5, compares it to the budget
// (max kinds must be at or under, prefetch must be at or over), prints the worst, and exits 1 on any breach so the shots job fails.
//   node scripts/shots/probes/browser.mjs [--target <id|P-packet|all>] [--skin paper] [--size desktop|phone] [--throttle 4]
// Phone runs default to 4x CPU throttle (CDP), desktop to 1x. Path mapping: P-L11_02 owns perf/browser/**; the runner lives next to the other shots probes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { median } from "./open.mjs";
import { traceEnabled, startMountTrace, finishMountTrace } from "./mount-trace.mjs";

export const DEFAULT_RUNS = 6;
export const MIN_RUNS = 3;
export const KINDS = ["startup", "navigate", "scroll", "space_switch", "layout_shift", "prefetch", "chat_open"];
const MIN_SENSE = new Set(["prefetch"]);

/** Budget rows by id from perf/budgets.json ({ budgets: [...] }). */
export function budgetTable(json) {
  const out = {};
  for (const b of json.budgets ?? []) out[b.id] = b;
  return out;
}

/** Ruling 43: the median is judged against the p50 row of perf/budgets.json (limit), the worst timed run against the p95 row (worstLimit). A row without p50 falls back to its p95. */
export function budgetFor(kind, table, size = "desktop") {
  const row = table[kind];
  if (!row || typeof row.p95 !== "number") throw new Error(`perf/budgets.json has no p95 row for ${kind}`);
  // The phone row of a budget (the "also" entry on a mid phone) is the limit for the phone size: startup is 1 s on desktop and 1.5 s on a phone (V1-SPEC).
  const phone = size === "phone" ? (row.also ?? []).find((a) => /phone/.test(a.machine ?? "") && typeof a.p95 === "number") : undefined;
  // ruling 94: a phone row is the desktop row times the CPU throttle (navigate at 4x: p50 200, p95 400); a phone row with only a p95 (startup) uses it for both
  if (phone) return { limit: typeof phone.p50 === "number" ? phone.p50 : phone.p95, worstLimit: phone.p95, sense: MIN_SENSE.has(kind) ? "min" : "max", unit: row.unit };
  return { limit: typeof row.p50 === "number" ? row.p50 : row.p95, worstLimit: row.p95, sense: MIN_SENSE.has(kind) ? "min" : "max", unit: row.unit };
}

/** The probes a target declares, resolved against the budgets. A declared budget may tighten but never loosen (no splitting or loosening, ruling 43). */
export function parseProbes(target, table, size = "desktop") {
  const decl = target.probes;
  if (decl === undefined || decl === null) return [];
  if (typeof decl !== "object" || Array.isArray(decl)) throw new Error(`${target.id}: probes must be an object keyed by kind`);
  if (!target.waitFor) throw new Error(`${target.id}: probes need the target's waitFor selector (the mount is ready when it shows)`);
  return Object.entries(decl).map(([kind, p]) => {
    if (!KINDS.includes(kind)) throw new Error(`${target.id}: unknown probe kind ${kind} (${KINDS.join(", ")})`);
    const b = budgetFor(kind, table, size);
    const runs = p?.runs === undefined ? DEFAULT_RUNS : p.runs;
    if (!Number.isInteger(runs) || runs < MIN_RUNS) throw new Error(`${target.id}: ${kind}.runs must be an integer of at least ${MIN_RUNS} (the first is a discarded warm-up)`);
    let limit = b.limit;
    if (p?.budget !== undefined) {
      const loose = b.sense === "max" ? p.budget > b.limit : p.budget < b.limit;
      if (typeof p.budget !== "number" || loose) throw new Error(`${target.id}: ${kind}.budget ${p.budget} loosens the unchanged budget ${b.limit}`);
      limit = p.budget;
    }
    return { kind, runs, limit, worstLimit: b.worstLimit, sense: b.sense, unit: b.unit };
  });
}

const r1 = (n) => Math.round(n * 100) / 100;

/** From every run's value (first is the warm-up): the timed samples, median, worst, and pass. A missing value is a breach. */
export function summarize(values, { limit, worstLimit, sense }) {
  const timed = values.slice(1);
  const failed = timed.some((v) => typeof v !== "number" || !Number.isFinite(v));
  const ok = timed.filter((v) => typeof v === "number" && Number.isFinite(v));
  const med = failed || !ok.length ? NaN : r1(median(ok));
  const worst = ok.length ? r1(sense === "min" ? Math.min(...ok) : Math.max(...ok)) : NaN;
  const within = (v, lim) => (sense === "min" ? v >= lim : v <= lim);
  const pass = !failed && within(med, limit) && (worstLimit === undefined || within(worst, worstLimit));
  const w = values[0];
  return { warmup: typeof w === "number" ? r1(w) : null, samples: ok.map(r1), median: med, worst, failed, ok: pass };
}

/** Runs every declared probe of a target. `measure(target, run)` returns the window.__probes object of one fresh mount. */
export async function runTarget(target, table, { measure, size = "desktop" }) {
  const probes = parseProbes(target, table, size);
  if (!probes.length) return [];
  const runs = Math.max(...probes.map((p) => p.runs));
  const mounts = [];
  for (let i = 0; i < runs; i++) mounts.push(await measure(target, i));
  return probes.map((p) => ({ target: target.id, kind: p.kind, limit: p.limit, worstLimit: p.worstLimit, sense: p.sense, unit: p.unit, runs: p.runs, ...summarize(mounts.slice(0, p.runs).map((m) => m?.[p.kind]), p) }));
}

export function metricLine(r) {
  const n = (x) => (Number.isFinite(x) ? x : null);
  return `METRIC ${JSON.stringify({ name: `probe_${r.kind}`, ...r, median: n(r.median), worst: n(r.worst) })}`;
}

export function verdictLine(r) {
  const cmp = r.sense === "min" ? "floor" : "budget";
  return `${r.kind} ${r.ok ? "ok" : "OVER BUDGET"} ${r.target}: median ${r.median}${r.unit === "percent" ? "%" : r.unit === "cls" ? "" : "ms"} of ${r.samples.length} (${cmp} p50 ${r.limit}), worst ${r.worst} (p95 ${r.worstLimit ?? r.limit}), warm-up ${r.warmup} discarded`;
}

/** One fresh mount in a new context; waits for the target's selector and for window.__probes.ready, then returns the object. */
export async function readMount(browser, { url, selector, viewport, scheme, throttle, kinds, timeoutMs = 30000 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce" });
  try {
    const page = await ctx.newPage();
    if (throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
    if (traceEnabled()) await startMountTrace(browser, page);
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForSelector(selector, { timeout: timeoutMs });
    await page.waitForFunction((ks) => { const p = window.__probes; return !!p && (p.ready === true || ks.every((k) => typeof p[k] === "number")); }, kinds, { timeout: timeoutMs });
    const got = await page.evaluate(() => ({ ...window.__probes }));
    if (traceEnabled()) await finishMountTrace(browser, url);
    return got;
  } catch { return null; } finally { await ctx.close(); }
}

async function main() {
  const { parseArgs, routeUrl, loadTargets, SIZES } = await import("../lib.mjs");
  const { serve } = await import("../serve.mjs");
  const { ensureDeps, ensureChromium } = await import("../ensure-deps.mjs");
  const HERE = path.dirname(fileURLToPath(import.meta.url)), SHOTS = path.resolve(HERE, ".."), REPO = path.resolve(SHOTS, "../..");
  const args = parseArgs(process.argv.slice(2));
  const want = args.target || "all";
  const skin = args.skin || "paper";
  const size = args.size || "desktop";
  const throttle = Number(args.throttle || (size === "phone" ? 4 : 1));
  const table = budgetTable(JSON.parse(fs.readFileSync(path.join(REPO, "perf/budgets.json"), "utf8")));
  const targets = loadTargets(SHOTS).filter((t) => t.probes && (want === "all" || t.id === want || (want.startsWith("P-") && t.id.startsWith(want + "-"))));
  if (!targets.length) { console.log(`browser probes: skipped, no target of ${want} declares probes`); return 0; }
  const dist = path.join(path.resolve(REPO, args.app || "scripts/shots/app"), "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) { console.log("browser probes: skipped, no web export (shots.mjs exports it first)"); return 0; }
  await ensureDeps(REPO);
  ensureChromium(REPO);
  const server = await serve(dist, { spa: true });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const failed = [];
  try {
    for (const t of targets) {
      const kinds = Object.keys(t.probes);
      const rs = await runTarget(t, table, { size, measure: (tg) => readMount(browser, { url: routeUrl(server.origin, tg.route, skin), selector: tg.waitFor, viewport: SIZES[size], scheme: skin === "graphite" ? "dark" : "light", throttle, kinds }) });
      for (const r of rs) { console.log(metricLine(r)); console.log(`${size} x${throttle} ${verdictLine(r)}`); if (!r.ok) failed.push(`${r.target}:${r.kind}`); }
    }
  } finally { await browser.close(); server.close(); }
  if (failed.length) { console.error(`browser probes over budget: ${failed.join(", ")}`); return 1; }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
