// @reads /modules/sync/migrations/0001_pull.sql
// A Space of tens of thousands of rows (r34-appspeed, 17 Nov 2026): what a pull does per row must not read the whole schema, and a rescan of every row must not commit once per row.
import test from "node:test";
import assert from "node:assert/strict";
import { LABEL_RANKS, classifiedCatalog, loadCatalog } from "../../../sync/src/server/pull/index.ts";
import type { TypeDef } from "../../../kernel/src/store/types.ts";
import { openSync } from "../impl.ts";
import { CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const def = (name: string, sensitivity?: string): TypeDef => ({
  name,
  fields: [
    { name: "name", kind: "text" },
    { name: "tax", kind: "text", ...(sensitivity ? { sensitivity } : {}) },
  ],
});

test("a catalog over a types source that answers the same list keeps each type's labels until the list changes", () => {
  let list: readonly TypeDef[] = [def("matter", "restricted")];
  let reads = 0;
  const cat = classifiedCatalog(loadCatalog(), () => {
    reads++;
    return list;
  });
  const first = cat.get("matter");
  assert.equal(first.fieldLabels["tax"], LABEL_RANKS.restricted);
  for (let i = 0; i < 1_000; i++) assert.equal(cat.get("matter"), first, "one entry, not one per row");
  assert.equal(cat.classificationStamp(), cat.classificationStamp());
  assert.ok(reads >= 1_000, "the source is still asked each time (it is a cheap list read)");
  list = [def("matter", "confidential")];
  const next = cat.get("matter");
  assert.notEqual(next, first);
  assert.equal(next.fieldLabels["tax"], LABEL_RANKS.confidential, "a changed schema shows at once");
  assert.deepEqual(cat.classified(), ["matter"]);
});

test("the record store hands back one parsed list of types until the schema changes", async () => {
  const s = openSync({ access: () => buildAccess(), clock: () => NOW });
  const snap = s.store.typesSnapshot!;
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const a = snap.call(s.store);
  assert.equal(snap.call(s.store), a, "the same list on the next read");
  assert.ok(a.some((t) => t.name === "contact"));
  await s.store.define({ add_types: [{ name: "matter", fields: [{ name: "name", kind: "text" }] }] });
  const b = snap.call(s.store);
  assert.notEqual(b, a);
  assert.ok(b.some((t) => t.name === "matter") && b.some((t) => t.name === "contact"));
});

test("appendMany writes every event, in order, a commit per group", () => {
  const s = openSync({ access: () => buildAccess(), clock: () => NOW });
  const before = s.host.store.read({ after: 0, limit: 100_000 }).length;
  const evs = Array.from({ length: 2_300 }, (_, i) => ({
    type: "sync.row_rescan",
    sv: 1,
    trace_id: "0123456789abcdef0123456789abcdef",
    actor: "svc_host",
    vis: "private" as const,
    payload: { entity: "contact", id: `rec_${String(i).padStart(32, "0")}` },
  }));
  s.host.appendMany(evs, 1_000);
  const after = s.host.store.read({ after: 0, limit: 100_000 });
  assert.equal(after.length - before, 2_300);
  const mine = after.filter((e) => e.type === "sync.row_rescan");
  assert.equal(mine.length, 2_300);
  assert.deepEqual(
    mine.map((e) => e.seq),
    [...mine.map((e) => e.seq)].sort((x, y) => x - y),
    "in the order given",
  );
});
