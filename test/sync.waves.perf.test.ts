// A firm's synced types start their passes together (18 Nov 2026, the live firm: a 1.3 s stall every ten minutes). Five types of one connection, about 3,000 records: the first pulls start at once, then
// every type is due at once. The loop is never held longer than the budget. A speed number counts only on the v1-perf runners (ruling 46); the counts (refusals, Vault reads) are asserted in every run
// by test/sync.waves.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { BUDGET_MS, waves } from "./support/sync-waves.ts";

test("five types of one connection start together: the loop is not held over the budget", async () => {
  const r = await waves(600);
  process.stderr.write(
    `[waves] first pulls: ${JSON.stringify(r.pull)}\n[waves] all types due at once: ${JSON.stringify(r.due)}\n`,
  );
  assert.ok(
    r.pull.maxMs <= BUDGET_MS && r.due.maxMs <= BUDGET_MS,
    `loop held ${r.pull.maxMs} / ${r.due.maxMs} ms (budget ${BUDGET_MS})`,
  );
});
