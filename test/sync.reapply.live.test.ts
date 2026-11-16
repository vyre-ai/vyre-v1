// A sync spec applied a second time with more in it (two more tables, a new field and a new link on a table that is already synced): the second apply changes a binding that exists,
// and must answer 200 with every table pulling. Before 17 Nov 2026 it answered "Something went wrong": the change to the existing binding says sync.type_updated, an event the
// apply had not declared. Found bringing a firm's CRM in, in two steps.
import test from "node:test";
import assert from "node:assert/strict";
import { call } from "./support/eco-live.ts";
import { pulled, rowsOf, spec, world } from "./support/sync-live.ts";

const pick = (remotes: string[], extra?: (s: ReturnType<typeof spec>) => void) => {
  const s = spec();
  s.objects = s.objects.filter((o) => remotes.includes(o.remote));
  s.mapping = s.mapping.filter((m) => remotes.includes(m.remote));
  extra?.(s);
  return s;
};
test("a re-apply that adds types and a field under a new key answers 200 and everything pulls", async () => {
  const w = await world(true);
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const one = pick(["matters", "contacts"]);
    const a1 = await call(w.d, "sync_specs.apply", { spec: one, idempotencyKey: "reapply-1" });
    assert.equal(a1.status, 200, "step 1: " + JSON.stringify(a1.data));
    await pulled(w.d, ["matter", "contact"]);
    const two = pick(["matters", "contacts", "companies", "notes"], (s) => {
      const m = s.objects.find((o) => o.remote === "matters")!;
      (m.fields as unknown[]).push(
        { path: "/extra", label: "Extra", type: "text" },
        { path: "/contact_id", label: "Primary contact", type: "relation", relationTo: "contacts" },
      );
      const mm = s.mapping.find((x) => x.remote === "matters")!;
      (mm.fields as unknown[]).push(
        { path: "/extra", field: "extra", direction: "pull" },
        { path: "/contact_id", field: "contact", direction: "pull" },
      );
    });
    const a2 = await call(w.d, "sync_specs.apply", { spec: two, idempotencyKey: "reapply-2" });
    assert.equal(a2.status, 200, "step 2: " + JSON.stringify(a2.data));
    await pulled(w.d, ["matter", "contact", "company", "note"]);
    for (const t of ["matter", "contact", "company", "note"]) assert.ok((await rowsOf(w.d, t)).length > 0, t);
    const types = await call(w.d, "sync_types.list", {});
    assert.equal(types.status, 200);
    assert.deepEqual((types.data.syncedTypes ?? []).map((x: { type: string }) => x.type).sort(), [
      "company",
      "contact",
      "matter",
      "note",
    ]);
  } finally {
    await w.close();
  }
});
