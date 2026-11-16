// One schema change that makes several record types (a sync apply makes all of its tables in one change): on a booted daemon every one of them must be something its maker can open,
// read and share at once. Before 17 Nov 2026 only the first type of the change was announced, so the others existed in the list and answered "We could not find that" to everyone.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, scriptedModel, seededDir } from "./support/live.ts";

const type = (key: string, title: string) => ({
  op: "type.create",
  type: key,
  def: {
    title,
    plural: `${title}s`,
    icon: "users",
    titleField: "name",
    fields: [{ key: "name", type: "text", title: "Name" }],
  },
});

test("three record types made by one schema change can each be opened, read and shared by their maker", async () => {
  const d = await boot(
    seededDir(),
    scriptedModel(async function* () {
      yield { type: "text", text: "ok" };
    }),
  );
  try {
    const keys = ["nw_company", "nw_person", "nw_link"];
    const made = await call(d, "schema.apply", {
      idempotencyKey: "many-types-1",
      ops: [
        type("nw_company", "Northwind company"),
        type("nw_person", "Northwind person"),
        type("nw_link", "Northwind link"),
        {
          op: "relation.add",
          type: "nw_link",
          field: "person",
          def: { to: "nw_person", inverse: "links", title: "Person", inverseTitle: "Links" },
        },
      ],
      reason: "three types in one change",
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    for (const k of keys) {
      const got = await call(d, "schema.types.get", { type: k });
      assert.equal(got.status, 200, `${k}: ${JSON.stringify(got.data)}`);
      const rows = await call(d, "records.query", { type: k, limit: 1 });
      assert.equal(rows.status, 200, `${k}: ${JSON.stringify(rows.data)}`);
      const open = await call(d, "access.audience_set", {
        idempotencyKey: `many-types-aud-${k}`,
        resource: { type: "record_type", id: k },
        audience: "added",
      });
      assert.equal(open.status, 200, `${k}: ${JSON.stringify(open.data)}`);
    }
  } finally {
    await d.stop();
  }
});
