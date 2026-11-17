// The full text index of a type exists once the type is written to, so the first search does not build it (17 Nov 2026: that build held a server for about four seconds on 9,400 rows of 100 fields).
import test from "node:test";
import assert from "node:assert/strict";
import { openRecords } from "../impl.ts";
import { createMergeHandlers } from "../handlers/merge.ts";
import { runSearch } from "../handlers/query.ts";
import type { MergeDeps } from "../handlers/merge.ts";

test("a bulk upsert leaves the type's index in place, and the first search builds nothing", async () => {
  const rec = openRecords({ space: "spc_aaaaaaaaaaaa", path: ":memory:" });
  await rec.store.define({
    add_types: [{ name: "party", label: "Party", fields: [{ name: "name", kind: "text", label: "Name" }] }] as never,
  });
  const raw = rec.host.tx;
  const seen: string[] = [];
  const tx = {
    run: (sql: string, ...a: unknown[]) => (seen.push(sql), raw.run(sql, ...a)),
    get: (sql: string, ...a: unknown[]) => (seen.push(sql), raw.get(sql, ...a)),
    all: (sql: string, ...a: unknown[]) => (seen.push(sql), raw.all(sql, ...a)),
    exec: (sql: string) => (seen.push(sql), raw.exec(sql)),
  } as MergeDeps["tx"];
  const h = createMergeHandlers({ store: rec.store, tx, now: () => 1_800_000_000_000, putFile: async () => "f" });
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => undefined,
    actor: "usr_dana",
    authorize: () => ({ effect: "allow" }),
  };
  const rows = Array.from({ length: 50 }, (_, i) => ({ name: `Party ${i} alpha` }));
  await h["records.bulk_upsert"](ctx as never, { type: "party", rows, match: ["name"] });
  assert.ok(
    raw.get("SELECT 1 AS x FROM sqlite_master WHERE name = ?", "qx_party_fts"),
    "the index exists after the write",
  );
  seen.length = 0;
  const found = runSearch(tx, "party", "Party 7", {});
  assert.ok(found.rows.length >= 1, "and it finds the row");
  assert.equal(seen.filter((s) => /INSERT INTO "qx_party_fts"/.test(s)).length, 0, "the search built no index");
});
