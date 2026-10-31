// A new record type works at once (rc.7 owner bug): the type made by the Records sheet's exact calls (schema.diff then schema.apply on its preview) takes a record, which can be edited and listed.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./memory-live-kit.ts";
import { applyInput, createTypeOps } from "../apps/app/src/places/records/typeedit/model.ts";
import { makeRecord } from "../apps/app/src/places/records/table/make.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rt-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

for (const name of ["Deals", "Company", "People", "Matter", "Status"]) {
  test(`record types live: a type named "${name}" made from the sheet takes a record that can be edited and listed`, async () => {
    const d = await boot(seededDir());
    try {
      // the app has read records before a person makes a type (the table, the counts), so the records module has already looked at the types
      await ok(d, "records.query", { type: "contact" });
      const taken = ((await ok(d, "schema.types.list", {})).types as Array<{ key: string }>).map((t) => t.key);
      const made = createTypeOps({ name, plural: "", icon: "table", takenKeys: taken, starters: ["amount", "owner"] });
      const preview = await ok(d, "schema.diff", { ops: made.ops });
      assert.deepEqual(preview.problems, []);
      await ok(d, "schema.apply", applyInput(preview, made.ops));
      const listed = ((await ok(d, "schema.types.list", {})).types as Array<{ key: string; title: string; plural: string }>).find((t) => t.key === made.key);
      assert.ok(listed, `the type is listed under ${made.key}`);
      // the table's own path: the type as schema.describe gives it to the table, and the New button's call
      const described = ((await ok(d, "schema.describe", {})).types as Array<{ key: string; titleField: string; template?: string }>).find((t) => t.key === made.key);
      assert.ok(described, `schema.describe holds ${made.key}, the key the sheet made`);
      const viaNew = await makeRecord((cap, input) => ok(d, cap, input as Record<string, unknown>), described, `New ${name}`, `new-${made.key}`);
      assert.ok(viaNew, "New made a record and answered its id");
      const rec = (await ok(d, "records.create", { type: made.key, fields: { name: `First ${name}` } })).record;
      assert.ok(rec.id);
      await ok(d, "records.update", { type: made.key, recordId: rec.id, patch: { name: "Renamed" } });
      const rows = (await ok(d, "records.query", { type: made.key })).rows as Array<{ id: string; fields: Record<string, unknown> }>;
      assert.deepEqual(rows.map((r) => r.fields["name"]).sort(), [`New ${name}`, "Renamed"].sort());
      const found = ((await ok(d, "schema.types.list", {})).types as Array<{ key: string; title: string; plural: string }>).find((t) => t.key === made.key)!;
      assert.equal(found.plural, name === "Company" ? "Companies" : name === "Matter" ? "Matters" : name === "Status" ? "Statuses" : found.plural);
      assert.ok(!/ses$/.test(found.plural) || name === "Status", "no doubled plural");
    } finally { await d.stop(); }
  });
}
