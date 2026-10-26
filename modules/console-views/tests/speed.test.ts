// console.speed through the real handler (ARCH 9): spans rolled up per budget id, p50 and p95 against perf/budgets.json, worst trace linked.
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// contract tests for probes: every row of perf/budgets.json has a probe id present in generated/probes.json.
// @reads /perf/budgets.json
// @reads /generated/probes.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { loadBudgets, percentile, rollUp, setBudgetsProvider } from "../projections.ts";
import type { Budget } from "../projections.ts";
import { NOW, world } from "../fixtures/db.ts";

const trace = (n: number): string => n.toString(16).padStart(32, "0");
const span = (name: string, ms: number, n: number, at = NOW - 1000) => ({ traceId: trace(n), spanId: `sp${n}`, name, at, durUs: Math.round(ms * 1000) });

test("every row of perf/budgets.json has a probe id present in generated/probes.json", () => {
  setBudgetsProvider(null);
  const budgets = JSON.parse(readFileSync(new URL("../../../perf/budgets.json", import.meta.url), "utf8")) as { budgets: { id: string; probe?: string }[] };
  const probes = JSON.parse(readFileSync(new URL("../../../generated/probes.json", import.meta.url), "utf8")) as { probes: { id: string }[] };
  const have = new Set(probes.probes.map((p) => p.id));
  assert.ok(budgets.budgets.length >= 10);
  const missing = budgets.budgets.filter((b) => !b.probe || !have.has(b.probe)).map((b) => `${b.id} -> ${b.probe ?? "(no probe)"}`);
  assert.deepEqual(missing, [], "every budget names a probe that exists");
  // and the module reads exactly those rows, including console_speed itself
  const loaded = loadBudgets();
  assert.deepEqual(loaded.map((b) => b.id), budgets.budgets.map((b) => b.id));
  assert.ok(loaded.some((b) => b.id === "console_speed"));
});

test("percentiles are nearest rank", () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 5), 5);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 95), 0);
});

const nav: Budget = { id: "navigate", p50: 50, p95: 100, sense: "max", unit: "ms" };
const fps: Budget = { id: "scroll_fps", p50: 60, p95: 55, sense: "min", unit: "count" };

test("rows roll up per budget id with p50, p95, the budget and the worst trace; over only when p95 passes the budget", async () => {
  setBudgetsProvider(() => [nav, { ...nav, id: "search", p95: 50 }, { ...nav, id: "idle" }]);
  const w = world({
    "logs.spans": (i: Record<string, unknown>) => ({
      spans: i["name"] === "navigate"
        ? Array.from({ length: 20 }, (_, k) => span("navigate", 10 + k, k + 1)).concat([span("navigate", 400, 99)])
        : i["name"] === "search" ? [span("search", 20, 1), span("search", 30, 2)] : [],
    }),
  });
  const { rows } = await handlers["console.speed"](w.ctx, {});
  assert.deepEqual(rows.map((r) => r.budgetId), ["navigate", "search"], "a budget with no samples has no row");
  const n = rows[0]!;
  assert.equal(n.worstTraceId, trace(99));
  assert.equal(n.budgetP95, 100);
  assert.ok(n.p50 >= 10 && n.p50 <= 30);
  assert.equal(n.p95, 29, "20 of 21 samples are at or under 29 ms; the 400 ms outlier sits above the 95th rank");
  assert.equal(n.over, false);
  assert.deepEqual(rows[1], { budgetId: "search", p50: 20, p95: 30, budgetP95: 50, worstTraceId: trace(2), over: false });
  setBudgetsProvider(null);
});

test("a budget is over when p95 passes it, and a min budget is over when the low tail falls under it", () => {
  const slow = rollUp(nav, [20, 30, 150, 160, 170].map((ms, i) => ({ value: ms, traceId: trace(i + 1) })));
  assert.equal(slow?.over, true);
  assert.equal(slow?.worstTraceId, trace(5));
  const smooth = rollUp(fps, [60, 59, 58, 57, 56].map((v, i) => ({ value: v, traceId: trace(i + 1) })));
  assert.equal(smooth?.over, false);
  const janky = rollUp(fps, [60, 59, 58, 30, 20].map((v, i) => ({ value: v, traceId: trace(i + 1) })));
  assert.equal(janky?.over, true);
  assert.equal(janky?.p95, 20, "the bad end for min is the low tail");
  assert.equal(janky?.worstTraceId, trace(5));
  assert.equal(rollUp({ ...nav, sense: "exact", p95: 0 }, [{ value: 0 }, { value: 0 }])?.over, false);
  assert.equal(rollUp({ ...nav, sense: "exact", p95: 0 }, [{ value: 0 }, { value: 1 }])?.over, true);
  assert.equal(rollUp(nav, []), null);
});

test("the window drops older spans, non-ms budgets read the value attribute, and paging follows the cursor", async () => {
  setBudgetsProvider(() => [nav, fps]);
  let pages = 0;
  const w = world({
    "logs.spans": (i: Record<string, unknown>) => {
      if (i["name"] === "scroll_fps") return { spans: [{ ...span("scroll_fps", 0, 1), attrs: { value: 58 } }, { ...span("scroll_fps", 0, 2), attrs: { value: 41 } }, span("scroll_fps", 5, 3)] };
      pages++;
      return i["cursor"] === undefined
        ? { spans: [span("navigate", 500, 1, NOW - 120 * 60_000), span("navigate", 40, 2)], next: "2" }
        : { spans: [span("navigate", 60, 3)] };
    },
  });
  const { rows } = await handlers["console.speed"](w.ctx, { windowMinutes: 60 });
  assert.equal(pages, 2, "the second page is read through the cursor");
  const n = rows.find((r) => r.budgetId === "navigate")!;
  assert.equal(n.p95, 60, "the 500 ms span is two hours old and outside the 60 minute window");
  assert.equal(n.worstTraceId, trace(3));
  const f = rows.find((r) => r.budgetId === "scroll_fps")!;
  assert.equal(f.p95, 41);
  assert.equal(f.over, true);
  setBudgetsProvider(null);
});

test("a logs source that cannot be read leaves an empty page, not an error", async () => {
  setBudgetsProvider(() => [nav]);
  const w = world({ "logs.spans": new Error("auth.forbidden") });
  assert.deepEqual(await handlers["console.speed"](w.ctx, {}), { rows: [] });
  setBudgetsProvider(null);
});

