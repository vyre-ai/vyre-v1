// @reads /modules/records/migrations/0002_query.sql
// Budget table100k (spec 2.9, speed): a 100,000-row table opens under 100 ms and a search answers under 50 ms (p95).
// Rows go straight into the rt_ projection table: the budget is about reading, and 100,000 event appends would only measure the log.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { openRecords } from "../impl.ts";
import { createQueryHandlers, runQuery } from "../handlers/query.ts";
import { ITEM } from "../fixtures/seed.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" } };
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];

test("table100k: opens a 100,000-row table under 100 ms and searches under 50 ms", async () => {
  const N = 100_000;
  const rec = openRecords({ space: "sp_t100k" });
  await rec.store.define({ add_types: [ITEM] });
  const tx = rec.host.tx;
  tx.exec("BEGIN");
  const ins = "INSERT INTO rt_item (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)";
  for (let i = 0; i < N; i++) {
    const id = `00000000-0000-7000-8000-${i.toString(16).padStart(12, "0")}`;
    const name = `${WORDS[i % 12]} ${WORDS[(i * 7) % 12]} ${i}`;
    tx.run(ins, id, 1_700_000_000_000 + i, 1_700_000_000_000 + i, JSON.stringify({ name, qty: (i * 31) % 1000, status: ["open", "closed", "done"][i % 3] }));
  }
  tx.exec("COMMIT");
  const q = createQueryHandlers({ tx });

  const spec = { sort: [{ field: "qty", dir: "desc" as const }], limit: 200 };
  const built0 = performance.now();
  runQuery(tx, "item", spec); // builds the sort index, the count and the search index once; saveView does this ahead of time
  await q["records.search"](ctx, { type: "item", q: "alpha" });
  console.log(`first open (builds sort index, count, FTS): ${(performance.now() - built0).toFixed(0)} ms`);

  const open: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    const r = await q["records.query"](ctx, { type: "item", ...spec });
    open.push(performance.now() - t);
    assert.equal(r.rows.length, 200);
    assert.equal(r.total, N);
  }
  const filtered: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    const r = await q["records.query"](ctx, { type: "item", ...spec, filter: { field: "status", op: "eq", value: "open" } });
    filtered.push(performance.now() - t);
    assert.equal(r.rows.length, 200);
  }
  const search: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t = performance.now();
    const r = await q["records.search"](ctx, { type: "item", q: `${WORDS[i % 12]} ${WORDS[(i * 5) % 12]}`, limit: 50 });
    search.push(performance.now() - t);
    assert.ok(r.rows.length > 0);
  }
  const o = pct(open, 0.95), f = pct(filtered, 0.95), s = pct(search, 0.95);
  console.log(`table100k: open p95 ${o.toFixed(2)} ms (budget 100), filtered open p95 ${f.toFixed(2)} ms, search p95 ${s.toFixed(2)} ms (budget 50)`);
  assert.ok(o < 100, `open p95 ${o.toFixed(2)} ms`);
  assert.ok(f < 100, `filtered open p95 ${f.toFixed(2)} ms`);
  assert.ok(s < 50, `search p95 ${s.toFixed(2)} ms`);
});
