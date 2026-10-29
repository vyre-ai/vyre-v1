// Timing samples a device uploads become the spans console.speed rolls up.
// @reads /perf/budgets.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness, NOW } from "../fixtures/db.ts";
import { BUDGET_UNITS, MAX_SAMPLES, spanOf } from "../handlers/samples.ts";
import { clientUpload, spans } from "../handlers/index.ts";

test("the budget ids a device may sample are exactly perf/budgets.json, with the same units", () => {
  const budgets = (JSON.parse(readFileSync(new URL("../../../perf/budgets.json", import.meta.url), "utf8")) as { budgets: { id: string; unit: string }[] }).budgets;
  assert.deepEqual(Object.fromEntries(budgets.map((b) => [b.id, b.unit])), BUDGET_UNITS);
});

test("a sample becomes a span named by its budget: ms in the duration, other units in attrs.value; anything else is dropped", () => {
  const ok = spanOf({ budgetId: "startup", value: 812.4, at: NOW - 5 }, "dev_a1b2c3", NOW)!;
  assert.deepEqual([ok["name"], ok["durUs"], ok["at"]], ["startup", 812_400, NOW - 5]);
  assert.equal((ok["attrs"] as Record<string, unknown>)["value"], 812.4);
  assert.equal((ok["attrs"] as Record<string, unknown>)["source"], "device");
  const cls = spanOf({ budgetId: "layout_shift", value: 0.04, at: NOW }, "dev_a1b2c3", NOW)!;
  assert.equal(cls["durUs"], undefined); assert.equal((cls["attrs"] as Record<string, unknown>)["value"], 0.04);
  for (const bad of [{ budgetId: "not_a_budget", value: 1 }, { budgetId: "startup", value: -1 }, { budgetId: "startup", value: NaN }, { budgetId: "startup", value: 4_000_000 }]) assert.equal(spanOf({ ...bad, at: NOW }, "dev_a1b2c3", NOW), null, JSON.stringify(bad));
  assert.equal(spanOf({ budgetId: "startup", value: 1, at: NOW + 99_999 }, "d", NOW)!["at"], NOW, "a sample cannot be dated in the future");
});

test("an upload with samples writes spans the Speed page reads, and counts only the ones it kept", async () => {
  const h = harness();
  const out = await clientUpload(h.ctx, { device: "dev_a1b2c3", entries: [], samples: [{ budgetId: "startup", value: 900, at: NOW }, { budgetId: "search", value: 30, at: NOW }, { budgetId: "nope", value: 1, at: NOW }] });
  assert.deepEqual(out, { accepted: 0, sampled: 2 });
  const got = await spans(h.ctx, { name: "startup" }) as { spans: { name: string; durUs: number; attrs?: { value: number; source: string } }[] };
  assert.deepEqual(got.spans.map((s) => [s.name, s.durUs, s.attrs?.source]), [["startup", 900_000, "device"]]);
  const many = await clientUpload(h.ctx, { device: "dev_a1b2c3", entries: [], samples: Array.from({ length: MAX_SAMPLES + 20 }, () => ({ budgetId: "edit", value: 5, at: NOW })) });
  assert.equal(many.sampled, MAX_SAMPLES, "an upload takes at most MAX_SAMPLES");
  assert.deepEqual(await clientUpload(h.ctx, { device: "dev_a1b2c3", entries: [] }), { accepted: 0 }, "an upload without samples answers as before");
});
