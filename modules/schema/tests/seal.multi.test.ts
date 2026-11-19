// @reads /modules/schema/migrations/0001_schema.sql
// r40 (a real firm's setup through the API): relations made inside type.create get both ends, two fields of one type seal in one call, and a retype to sealed keeps the field's label.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { openSchema } from "../impl.ts";
import { finishJobs, setSchemaVault } from "../handlers/seal.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana" };
const field = (key: string, type = "text", title = key, extra: Record<string, unknown> = {}) => ({
  key,
  type,
  title,
  ...extra,
});

async function made() {
  const s = openSchema({ path: ":memory:" });
  await s.handlers["schema.apply"](ctx, {
    ops: [
      {
        op: "type.create",
        type: "party",
        def: {
          title: "Party",
          plural: "Parties",
          titleField: "name",
          fields: [field("name", "text", "Name"), field("dob", "text", "Born"), field("ssn", "text", "SSN")],
        },
      },
    ],
  });
  return s;
}

test("a relation made inside type.create has both ends, as relation.add makes them", async () => {
  const s = await made();
  await s.handlers["schema.apply"](ctx, {
    ops: [
      {
        op: "type.create",
        type: "matter",
        def: {
          title: "Matter",
          plural: "Matters",
          titleField: "name",
          fields: [field("name"), field("client", "relation", "Client", { options: { target: "party" } })],
        },
      },
    ],
  });
  const matter = (await s.handlers["schema.types.get"](ctx, { type: "matter" })).type;
  const party = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type;
  const near = matter.fields.find((f) => f.key === "client")!;
  const inv = near.options?.["inverse"] as string;
  assert.equal(typeof inv, "string", "the near end names its inverse");
  const far = party.fields.find((f) => f.key === inv)!;
  assert.ok(far, "the other type has the other end");
  assert.equal(far.type, "relation");
  assert.equal(far.options?.["target"], "matter");
  assert.equal(far.options?.["inverse"], "client");
});

test("a relation made with a named inverse in type.create uses that name; a self relation gets a distinct end", async () => {
  const s = await made();
  await s.handlers["schema.apply"](ctx, {
    ops: [
      {
        op: "type.create",
        type: "matter",
        def: {
          title: "Matter",
          plural: "Matters",
          titleField: "name",
          fields: [
            field("name"),
            field("client", "relation", "Client", { options: { target: "party", inverse: "matters" } }),
            field("related", "relation", "Related", { options: { target: "matter" } }),
          ],
        },
      },
    ],
  });
  const matter = (await s.handlers["schema.types.get"](ctx, { type: "matter" })).type;
  const party = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type;
  assert.equal(party.fields.find((f) => f.key === "matters")?.options?.["target"], "matter");
  const rel = matter.fields.find((f) => f.key === "related")!;
  const back = matter.fields.find((f) => f.key === (rel.options?.["inverse"] as string))!;
  assert.notEqual(back.key, "related");
  assert.equal(back.options?.["inverse"], "related");
});

test("two fields of one type seal in one call", async () => {
  const s = await made();
  const ids = [mintRecordId(), mintRecordId()];
  for (const [i, id] of ids.entries())
    await s.store.create("party", id, { name: `P${i}`, dob: `19${i}0-01-01`, ssn: `111-22-333${i}` });
  const kept = new Map<string, string>();
  setSchemaVault({
    put: async (o) => {
      kept.set(`${o.field}.${o.recordId}`, o.value);
      return `vit_${o.field}_${o.recordId}`;
    },
  });
  try {
    const ops = [
      { op: "field.retype" as const, type: "party", field: "dob", toType: "sealed" },
      { op: "field.retype" as const, type: "party", field: "ssn", toType: "sealed" },
    ];
    const d = await s.handlers["schema.diff"](ctx, { ops });
    assert.deepEqual(d.problems, []);
    await s.handlers["schema.apply"](ctx, {
      ops,
      previewToken: d.previewToken,
      confirm: d.items.map((i) => i.itemKey),
    });
    assert.equal(kept.size, 4);
    assert.equal(await finishJobs(s.deps), 2);
    const row = (await s.store.get("party", ids[0]!))!;
    for (const f of ["dob", "ssn"])
      assert.equal((row.data[f] as { sealed: string }).sealed, f, `${f} holds a reference`);
    const t = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type;
    assert.equal(t.fields.find((f) => f.key === "dob")!.type, "sealed");
    assert.equal(t.fields.find((f) => f.key === "ssn")!.type, "sealed");
  } finally {
    setSchemaVault(null);
  }
});

test("a retype to sealed keeps the field's label", async () => {
  const s = await made();
  await s.handlers["schema.set_label"](ctx, { type: "party", field: "ssn", label: "restricted" });
  setSchemaVault({ put: async (o) => `vit_${o.recordId}` });
  try {
    const ops = [{ op: "field.retype" as const, type: "party", field: "ssn", toType: "sealed" }];
    const d = await s.handlers["schema.diff"](ctx, { ops });
    await s.handlers["schema.apply"](ctx, {
      ops,
      previewToken: d.previewToken,
      confirm: d.items.map((i) => i.itemKey),
    });
    const f = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type.fields.find((x) => x.key === "ssn")!;
    assert.equal(f.type, "sealed");
    assert.equal(f.label, "restricted");
    const stored = (await s.store.types()).find((t) => t.name === "party")!.fields.find((x) => x.name === "ssn")!;
    assert.equal(stored["sensitivity"], "restricted");
  } finally {
    setSchemaVault(null);
  }
});

test("a retype that names a label in its def sets it, and a plain retype of an unlabelled field stays unlabelled", async () => {
  const s = await made();
  setSchemaVault({ put: async (o) => `vit_${o.recordId}` });
  try {
    const ops = [
      { op: "field.retype" as const, type: "party", field: "dob", toType: "sealed", def: { label: "restricted" } },
      { op: "field.retype" as const, type: "party", field: "ssn", toType: "sealed" },
    ];
    const d = await s.handlers["schema.diff"](ctx, { ops });
    await s.handlers["schema.apply"](ctx, {
      ops,
      previewToken: d.previewToken,
      confirm: d.items.map((i) => i.itemKey),
    });
    const fields = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type.fields;
    assert.equal(fields.find((f) => f.key === "dob")!.label, "restricted");
    assert.equal(fields.find((f) => f.key === "ssn")!.label, undefined);
    const stored = (await s.store.types()).find((t) => t.name === "party")!.fields;
    assert.equal(stored.find((x) => x.name === "dob")!["sensitivity"], "restricted");
  } finally {
    setSchemaVault(null);
  }
});

test("relation.add after a relation made with its type is a no-op that succeeds; a real clash still refuses", async () => {
  const s = await made();
  await s.handlers["schema.apply"](ctx, {
    ops: [
      {
        op: "type.create",
        type: "matter",
        def: {
          title: "Matter",
          plural: "Matters",
          titleField: "name",
          fields: [
            field("name"),
            field("client", "relation", "Client", { options: { target: "party", inverse: "matters" } }),
          ],
        },
      },
    ],
  });
  const same = [
    { op: "relation.add" as const, type: "matter", field: "client", def: { to: "party", inverse: "matters" } },
  ];
  await s.handlers["schema.apply"](ctx, { ops: same });
  const party = (await s.handlers["schema.types.get"](ctx, { type: "party" })).type;
  assert.equal(party.fields.filter((f) => f.key === "matters").length, 1);
  const clash = [
    { op: "relation.add" as const, type: "matter", field: "client", def: { to: "party", inverse: "name" } },
  ];
  assert.equal((await s.handlers["schema.diff"](ctx, { ops: clash })).problems.length, 1);
});
