// @reads /modules/records/migrations/0001_init.sql
// @reads /modules/records/migrations/0002_query.sql
// records.bulk_upsert at the size of a real import (issue #905, round 2). The match lookup of each row used to ask for the exact count of the whole type (records.query's total), and every
// write invalidates the cached count, so an import of n rows into a type of m rows made n scans of m rows. It also scanned the type for the match itself. Pinned here: a batch runs no count
// at all, each lookup reads the match index, and a second batch into a bigger type costs the same number of statements per row as the first.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecords } from "../impl.ts";
import { createMergeHandlers } from "../handlers/merge.ts";
import type { MergeDeps } from "../handlers/merge.ts";

const SPACE = "spc_aaaaaaaaaaaa";
const PARTY = Object.freeze({ name: "party", label: "Party", fields: [
  { name: "name", kind: "text", label: "Name" }, { name: "email", kind: "text", label: "Email" }, { name: "city", kind: "text", label: "City" },
] });

async function kit() {
  const rec = openRecords({ space: SPACE, path: ":memory:" });
  await rec.store.define({ add_types: [PARTY] as never });
  const seen: string[] = [];
  const raw = rec.host.tx;
  // every statement the handler runs, as text
  const tx: MergeDeps["tx"] = {
    run: (sql, ...a) => { seen.push(sql); return raw.run(sql, ...a); },
    get: (sql, ...a) => { seen.push(sql); return raw.get(sql, ...a); },
    all: (sql, ...a) => { seen.push(sql); return raw.all(sql, ...a); },
    exec: (sql) => { seen.push(sql); raw.exec(sql); },
  } as MergeDeps["tx"];
  const deps: MergeDeps = { store: rec.store, tx, now: () => 1_800_000_000_000, putFile: async () => "file_1" };
  const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana", authorize: () => ({ effect: "allow" }) };
  return { rec, raw, seen, h: createMergeHandlers(deps), ctx: ctx as never };
}

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ email: `p${from + i}@example.test`, name: `P ${from + i}`, city: i % 2 ? "Oslo" : "Rome" }));

test("a bulk upsert asks for no count, and each match lookup reads the match index", async () => {
  const k = await kit();
  const out = await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(0, 200), match: ["email"] });
  assert.deepEqual(out, { created: 200, updated: 0, skipped: 0 });
  const counts = k.seen.filter((s) => /count\(\*\)/i.test(s));
  assert.equal(counts.length, 0, `no count over the type: ${counts.slice(0, 3).join(" | ")}`);
  const lookup = k.seen.find((s) => /FROM rt_party r/.test(s) && /json_extract\(r\.data, '\$\."email"'\) IS \?/.test(s));
  assert.ok(lookup, "the lookup statement");
  const plan = (k.raw.all(`EXPLAIN QUERY PLAN ${lookup}`, "party", "p1@example.test") as { detail: string }[]).map((r) => r.detail).join(" / ");
  assert.match(plan, /USING INDEX qx_party_/, plan);
  // a rerun of the same rows: all skipped, still no count
  k.seen.length = 0;
  assert.deepEqual(await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(0, 200), match: ["email"] }), { created: 0, updated: 0, skipped: 200 });
  assert.equal(k.seen.filter((s) => /count\(\*\)/i.test(s)).length, 0);
});

test("the statements per row do not grow with the type: a batch into 2,000 rows costs what a batch into 300 rows costs", async () => {
  const k = await kit();
  await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(0, 200), match: ["email"] });
  k.seen.length = 0;
  await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(200, 100), match: ["email"] });
  const small = k.seen.length;
  for (let from = 300; from < 2000; from += 200) await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(from, 200), match: ["email"] });
  k.seen.length = 0;
  await k.h["records.bulk_upsert"](k.ctx, { type: "party", rows: rows(5000, 100), match: ["email"] });
  assert.equal(k.seen.length, small, "the same statements for 100 new rows into 300 and into 2,100");
  assert.equal((k.raw.get("SELECT count(*) AS n FROM rt_party WHERE deleted_at IS NULL") as { n: number }).n, 2200);
});
