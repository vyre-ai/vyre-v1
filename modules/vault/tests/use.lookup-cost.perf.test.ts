// The speed half of use.lookup-cost.test.ts (a perf file, ruling 46): a handle lookup in a Vault of a thousand items. r38 profile on the firm's server: 5,133 ms of 90 s in connector fills that checked access on every item.
// Measured on box D with a 10 microsecond check: 13,270 ms before, 230 ms after.
// @reads /modules/vault/handlers/use.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { ROB, harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;

/** The budget for 300 lookups by handle in a Vault of 1,000 items, in ms (the best of three runs). */
export const LOOKUP_300_BUDGET_MS = 600;

test("lookup300: three hundred handle lookups in a Vault of a thousand items are inside the speed budget", async () => {
  const h = harness();
  const folder = String(
    out(out(await v.foldersCreate(h.ctx, { name: "Shared", scope: "shared", idempotencyKey: "pf" })).folder).id,
  );
  const ids: string[] = [];
  for (let i = 0; i < 1000; i++)
    ids.push(
      String(
        out(
          out(
            await v.itemPut(h.ctx, {
              folderId: folder,
              name: `Service ${i}`,
              kind: "api_key",
              fields: [{ key: "api_key", value: `k-${i}` }],
              idempotencyKey: `pi-${i}`,
            } as Parameters<typeof v.itemPut>[1]),
          ).item,
        ).id,
      ),
    );
  // a person who holds Use on every seventh item and nothing on the rest (the owner's own items are never checked)
  for (let i = 0; i < 1000; i += 7) h.grant(ROB, ids[i]!, "use");
  h.actAs("person", ROB);
  // the kernel's authorize costs microseconds an item on the firm's server: a check here costs 10 microseconds too
  const base = h.ctx.authorize.bind(h.ctx);
  h.ctx.authorize = (action, resource) => {
    const end = performance.now() + 0.01;
    while (performance.now() < end) {
      /* the cost of a real check */
    }
    return base(action, resource);
  };
  const runs: number[] = [];
  for (let r = 0; r < 3; r++) {
    const t = performance.now();
    for (let i = 0; i < 300; i++) await u.use(h.ctx, { item: `#Service_${(i % 143) * 7}` });
    runs.push(performance.now() - t);
  }
  const best = Math.min(...runs);
  console.log(`lookup300 best ${best.toFixed(0)} ms (runs ${runs.map((x) => x.toFixed(0)).join(", ")})`);
  assert.ok(best <= LOOKUP_300_BUDGET_MS, `300 lookups took ${best.toFixed(0)} ms, budget ${LOOKUP_300_BUDGET_MS}`);
  h.cleanup();
});
