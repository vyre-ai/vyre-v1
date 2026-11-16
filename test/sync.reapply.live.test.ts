// A sync spec applied a second time with more in it (two more tables, a new field and a new link on a table that is already synced): the second apply changes a binding that exists,
// and must answer 200 with every table pulling. Before 17 Nov 2026 it answered "Something went wrong": the change to the existing binding says sync.type_updated, an event the
// apply had not declared. Found bringing a firm's CRM in, in two steps.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import { pulled, pump, rowsOf, spec, world } from "./support/sync-live.ts";

const pick = (remotes: string[], extra?: (s: ReturnType<typeof spec>) => void) => {
  const s = spec();
  s.objects = s.objects.filter((o) => remotes.includes(o.remote));
  s.mapping = s.mapping.filter((m) => remotes.includes(m.remote));
  extra?.(s);
  return s;
};
test("a re-apply that adds a type, a field and a link to a synced type answers 200 and everything pulls", async () => {
  const w = await world(true);
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    // step 1: one object. Step 2 adds one more, and a new field and a link on the first: that changes a binding that exists.
    const a1 = await call(w.d, "sync_specs.apply", { spec: pick(["matters"]), idempotencyKey: "reapply-1" });
    assert.equal(a1.status, 200, "step 1: " + JSON.stringify(a1.data));
    await pulled(w.d, ["matter"]);
    const two = pick(["matters", "contacts"], (s) => {
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
    await pulled(w.d, ["contact"]);
    // the first type read again with its new field and link: values are in, and the link points at a contact
    const matter = await waitFor(
      async () => {
        await pump(w.d);
        const rows = await rowsOf(w.d, "matter");
        return rows.length > 0 && rows.every((r) => typeof r.fields["extra"] === "string" && r.fields["contact"])
          ? rows
          : null;
      },
      115_000,
      () => hostLog(w.d),
    );
    assert.deepEqual(matter.map((r) => r.fields["extra"]).sort(), ["extra Matter 1", "extra Matter 2"]);
    const types = await call(w.d, "sync_types.list", {});
    assert.equal(types.status, 200);
    assert.deepEqual((types.data.syncedTypes ?? []).map((x: { type: string }) => x.type).sort(), ["contact", "matter"]);
  } finally {
    await w.close();
  }
});
