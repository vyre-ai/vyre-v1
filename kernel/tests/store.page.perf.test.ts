// Reading a big type page by page costs the pages, not the type (a firm's sync pass listed a type of 100,000 records 500 at a time and decoded every record once per page: 14 s of every 90 s, the server
// held for seconds). 50,000 records of 30 fields are listed in pages of 500 inside the budget. A speed number counts only on the v1-perf runners (ruling 46).
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore } from "../src/store/records.ts";
import { mintRecordId } from "../../lib/ids.ts";

const TOTAL = 50_000;
const BUDGET_MS = 2_000;

test("a type of 50,000 records is listed in pages of 500 within the budget, in order and without a repeat", async () => {
  const { host, store } = openRecordStore({ path: ":memory:", space: "sp_page_perf" });
  await store.define({
    add_types: [
      {
        name: "matter",
        label: "Matter",
        fields: Array.from({ length: 30 }, (_, f) => ({ name: `f${f}`, kind: "text" })),
      },
    ],
  });
  const data = JSON.stringify(
    Object.fromEntries(Array.from({ length: 30 }, (_, f) => [`f${f}`, `value ${f} lorem ipsum dolor sit amet`])),
  );
  host.tx.exec("BEGIN");
  const ids: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const id = mintRecordId();
    ids.push(id);
    host.tx.run(
      "INSERT INTO rt_matter (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)",
      id,
      i,
      i,
      data,
    );
  }
  host.tx.exec("COMMIT");
  const started = performance.now();
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const p = await store.query("matter", { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
    for (const r of p.rows) seen.push(r.id);
    cursor = p.next_cursor;
  } while (cursor);
  const tookMs = Math.round(performance.now() - started);
  process.stderr.write(`[page-perf] ${TOTAL} records listed in ${tookMs} ms\n`);
  assert.equal(seen.length, TOTAL);
  assert.deepEqual(seen, [...ids].sort());
  assert.ok(tookMs <= BUDGET_MS, `listing took ${tookMs} ms (budget ${BUDGET_MS} ms)`);
});
