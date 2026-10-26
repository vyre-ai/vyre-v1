// The speed half of cmdk.test.tsx (a separate file so only this one is a perf file, ruling 46): local rows under 50 ms for 20,000 replica items; server hits merged under 300 ms.
import test from "node:test";
import assert from "node:assert/strict";
import { CmdKController } from "./controller.ts";
import type { Hit } from "./model.ts";
import { createSampleData } from "./sample.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("perf search: local rows under 50 ms for 20,000 replica items; server hits merged under 300 ms", async () => {
  const big: Hit[] = Array.from({ length: 20000 }, (_, i) => ({ kind: (["file", "record", "chat", "person"] as const)[i % 4] as Hit["kind"], id: `x${i}`, title: `Item ${i} ${i % 97 === 0 ? "referral" : "misc"}`, link: `vyre://x/${i}`, score: 1 }));
  const { data } = createSampleData({ local: big, serverDelayMs: 150 });
  const timings: Record<string, number> = {};
  const c = new CmdKController(data, { onTiming: (n, ms) => { timings[n] = ms; } });
  c.setRaw("referral");
  assert.ok(timings["local"] !== undefined && timings["local"] < 50, `local ${timings["local"]} ms`);
  await wait(300);
  assert.ok(timings["merged"] !== undefined && timings["merged"] < 300, `merged ${timings["merged"]} ms`);
  console.log(`METRIC ${JSON.stringify({ name: "search", local_ms: +(timings["local"] ?? 0).toFixed(2), local_budget_ms: 50, merged_ms: +(timings["merged"] ?? 0).toFixed(1), merged_budget_ms: 300, replica_items: big.length })}`);
  c.dispose();
});
