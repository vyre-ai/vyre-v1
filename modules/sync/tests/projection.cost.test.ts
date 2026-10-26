// What the sync.changes projection adds to a record write (lead note on P-L1_LIVE): the same creates with and without the projection declared on the Space store, per create, in-process. It prints the numbers
// (METRIC lines) and asserts only that the projection did its work; a timing assertion would belong on the perf runners (ruling 55), not here.
// @reads /modules/sync/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import type { InlineProjection } from "../../../kernel/src/store/projection.ts";
import { loadCatalog } from "../../../sync/src/server/pull/index.ts";
import { syncChanges } from "../projections.ts";
import { CONTACT_TYPE } from "../fixtures/world.ts";

const N = 400;

async function perCreate(extra: InlineProjection[]): Promise<{ ms: number; rows: number }> {
  const o = openRecordStore({ path: ":memory:", space: "sp_bench", extra });
  await o.store.define({ add_types: [CONTACT_TYPE] });
  for (let i = 0; i < 50; i++) await o.store.create("contact", mintRecordId(), { name: `warm ${i}`, email: "w@example.com", phone: "+1", region: "eu", stage: "lead", owner: "usr_a" });
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await o.store.create("contact", mintRecordId(), { name: `N ${i}`, email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: "usr_a" });
  const ms = (performance.now() - t0) / N;
  const rows = extra.length ? (o.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sync_rows")?.n ?? 0) : 0;
  o.host.close();
  return { ms, rows };
}

test("the sync.changes projection's cost per records.create is measured and printed; it did write one row per record", async () => {
  const catalog = loadCatalog();
  const without = await perCreate([]);
  const withProjection = await perCreate([syncChanges((entity) => catalog.get(entity).ownerField)]);
  const added = withProjection.ms - without.ms;
  console.log(`METRIC ${JSON.stringify({ name: "sync_projection_cost", without_ms: Number(without.ms.toFixed(3)), with_ms: Number(withProjection.ms.toFixed(3)), added_ms: Number(added.toFixed(3)), creates: N })}`);
  assert.equal(withProjection.rows, N + 50, "one sync row per created record");
});
