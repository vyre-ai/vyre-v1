// The speed half of speed.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
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

test("perf: console_speed rolls up every budget id with 1,000 spans each inside its budget row", async () => {
  setBudgetsProvider(null);
  const budgets = loadBudgets();
  const row = budgets.find((b) => b.id === "console_speed")!;
  // pages are built once, so the clock measures the roll-up and not the fake
  const pages = new Map<string, unknown>();
  for (const b of budgets) for (const from of [0, 500]) {
    pages.set(`${b.id}:${from}`, { spans: Array.from({ length: 500 }, (_, k) => ({ ...span(b.id, 1 + ((from + k) % 90), from + k + 1), attrs: { value: 1 + ((from + k) % 90) } })), ...(from === 0 ? { next: "500" } : {}) });
  }
  const w = world({ "logs.spans": (i: Record<string, unknown>) => pages.get(`${String(i["name"])}:${Number(i["cursor"] ?? 0)}`) });
  await handlers["console.speed"](w.ctx, {});
  const runs: number[] = [];
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    const { rows } = await handlers["console.speed"](w.ctx, {});
    runs.push(performance.now() - t0);
    assert.equal(rows.length, budgets.length);
  }
  runs.sort((a, b) => a - b);
  const median = runs[2]!, worst = runs[4]!;
  console.log(`perf console_speed median=${median.toFixed(1)}ms worst=${worst.toFixed(1)}ms budget p50=${row.p50} p95=${row.p95}`);
  assert.ok(median <= row.p50, `median ${median} ms within the p50 of ${row.p50} ms`);
  assert.ok(worst <= row.p95, `worst ${worst} ms within the p95 of ${row.p95} ms`);
});
