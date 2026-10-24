// @reads /modules/schema/migrations/0001_schema.sql
// schema read side: describe matches the registry, lists page, the map follows relations, the sensitivity scan finds ID, card and health text without returning values.
import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid } from "../../../lib/ids.ts";
import { loadRegistry, openSchema } from "../impl.ts";

const NOW = 1_800_000_000_000;
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

function kit() {
  const s = openSchema({ now: () => NOW });
  const seen: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (name: string, subject: string, payload: Record<string, unknown>) => { seen.push({ name, subject, payload }); }, actor: "usr_dana" };
  return { s, h: s.handlers, ctx, seen };
}

test("describe: every type the manifests declare, field for field", async () => {
  const { h, ctx } = kit();
  const reg = loadRegistry();
  const out = await h["schema.describe"](ctx, {});
  assert.deepEqual(out.types.map((t) => t.key).sort(), reg.recordTypes.map((t) => t.key).sort());
  for (const r of reg.recordTypes) {
    const d = out.types.find((t) => t.key === r.key)!;
    assert.equal(d.title, r.title, r.key);
    assert.equal(d.plural, r.plural, r.key);
    assert.equal(d.icon, r.icon, r.key);
    assert.equal(d.titleField, r.titleField, r.key);
    assert.equal(d.system, r.system === true, r.key);
    assert.equal(d.label, r.label ?? "internal", r.key);
    assert.equal(d.version, 1);
    assert.deepEqual(d.fields.map((f) => [f.key, f.type, f.title]), r.fields.map((f) => [f.key, f.type, f.title]), r.key);
    assert.deepEqual(d.fields.map((f) => f.options ?? null), r.fields.map((f) => f.options ?? null), `${r.key} options`);
  }
  const one = await h["schema.describe"](ctx, { type: "contact" });
  assert.deepEqual(one.types.map((t) => t.key), ["contact"]);
  await assert.rejects(h["schema.describe"](ctx, { type: "nope" }), code("validation.not_found"));
  assert.equal((await h["schema.types.get"](ctx, { type: "contact" })).type.key, "contact");
  await assert.rejects(h["schema.types.get"](ctx, { type: "nope" }), code("validation.not_found"));
});

test("describe: a type made straight in the store is described in schema terms", async () => {
  const { s, h, ctx } = kit();
  await s.store.define({ add_types: [{ name: "legacy", label: "Legacy", fields: [{ name: "title", kind: "text", label: "Title" }, { name: "qty", kind: "number" }, { name: "state", kind: "choice", options: ["a", "b"] }] }] });
  const d = (await h["schema.types.get"](ctx, { type: "legacy" })).type;
  assert.equal(d.title, "Legacy");
  assert.equal(d.titleField, "title");
  assert.equal(d.version, 0);
  assert.deepEqual(d.fields.map((f) => [f.key, f.type]), [["title", "text"], ["qty", "number"], ["state", "choice"]]);
  assert.deepEqual(d.fields[2]!.options, { choices: [{ key: "a", title: "A" }, { key: "b", title: "B" }] });
});

test("types.list: sections, groups, paging and row counts", async () => {
  const { s, h, ctx } = kit();
  const reg = loadRegistry();
  await h["schema.describe"](ctx, {});
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await h["schema.types.list"](ctx, { limit: 4, ...(cursor ? { cursor } : {}) });
    assert.equal(page.total, reg.recordTypes.length);
    keys.push(...page.types.map((t) => t.key as string));
    cursor = page.next;
  } while (cursor);
  assert.deepEqual(keys.sort(), reg.recordTypes.map((t) => t.key).sort());

  const people = await h["schema.types.list"](ctx, { group: "People" });
  assert.deepEqual(people.types.map((t) => t.key).sort(), reg.recordTypes.filter((t) => t.group === "People").map((t) => t.key).sort());
  assert.deepEqual((await h["schema.types.list"](ctx, { section: "personal" })).types, []);
  assert.deepEqual((await h["schema.types.list"](ctx, { section: "shared" })).types, []);
  assert.deepEqual((await h["schema.types.list"](ctx, { folder: "fld_abc" })).types, []);

  await s.store.create("contact", mintUuid(), { name: "Ann" });
  await s.store.create("contact", mintUuid(), { name: "Bo" });
  const contact = (await h["schema.types.list"](ctx, {})).types.find((t) => t.key === "contact")!;
  assert.equal(contact.rowCount, 2);
  assert.equal(contact.fieldCount, reg.recordTypes.find((t) => t.key === "contact")!.fields.length);
});

test("field_types and view_kinds are the registry's", async () => {
  const { h, ctx } = kit();
  const reg = loadRegistry();
  const ft = (await h["schema.field_types"](ctx, {})).fieldTypes;
  assert.deepEqual(ft.map((f) => f.key), reg.fieldTypes.map((f) => f.key));
  for (const f of reg.fieldTypes) {
    const got = ft.find((x) => x.key === f.key)!;
    assert.deepEqual(got.filterOps, f.filterOps);
    assert.equal(got.sortable, f.sortable);
    assert.equal(got.groupable, f.groupable);
    assert.equal(got.sealed, f.sealed === true);
  }
  assert.equal(ft.find((f) => f.key === "sealed")?.sealed, true);
  const vk = (await h["schema.view_kinds"](ctx, {})).viewKinds;
  assert.deepEqual(vk.map((v) => v.key), reg.viewKinds.map((v) => v.key));
  assert.deepEqual(vk.find((v) => v.key === "board")?.needs, [{ fieldType: "choice", as: "group" }, { fieldType: "status", as: "group" }]);
});

test("map follows relations, two hops by default; the change log and Trash list start empty", async () => {
  const { h, ctx } = kit();
  assert.deepEqual((await h["schema.changes.list"](ctx, {})).changes, []);
  assert.deepEqual((await h["schema.trash.list"](ctx, {})).items, []);
  await h["schema.apply"](ctx, { ops: [{ op: "relation.add", type: "contact", field: "employer", def: { to: "company", inverse: "employees" } }] });
  const near = await h["schema.map"](ctx, { type: "contact", hops: 1 });
  const pair = near.edges.filter((e) => (e.from === "contact" && e.to === "company" && e.field === "employer" && e.inverse === "employees") || (e.from === "company" && e.to === "contact" && e.field === "employees" && e.inverse === "employer"));
  assert.equal(pair.length, 1, "a two-way relation is one edge");
  assert.ok(near.nodes.some((n) => n.type === "company"));
  const all = await h["schema.map"](ctx, {});
  assert.equal(all.nodes.length, loadRegistry().recordTypes.length);
  await assert.rejects(h["schema.map"](ctx, { type: "nope" }), code("validation.not_found"));

  const log = await h["schema.changes.list"](ctx, {});
  assert.equal(log.changes.length, 1);
  assert.equal(log.changes[0]!.by, "usr_dana");
  assert.equal(log.changes[0]!.at, NOW);
  assert.deepEqual([...log.changes[0]!.types].sort(), ["company", "contact"]);
  assert.equal((await h["schema.changes.list"](ctx, { type: "company" })).changes.length, 1);
  assert.equal((await h["schema.changes.list"](ctx, { type: "agent" })).changes.length, 0);
  assert.equal((await h["schema.changes.list"](ctx, { since: NOW + 1 })).changes.length, 0);
});

test("layout, gap rules and views start with defaults", async () => {
  const { h, ctx } = kit();
  const lay = (await h["schema.layout.get"](ctx, { type: "company" })).sections;
  assert.equal(lay.length, 1);
  assert.deepEqual(lay[0]!.fields, (await h["schema.types.get"](ctx, { type: "company" })).type.fields.map((f) => f.key));
  assert.deepEqual((await h["schema.gap_rules.list"](ctx, { type: "company" })).rules, []);
  assert.deepEqual((await h["views.list"](ctx, { type: "company" })).views, []);
  await assert.rejects(h["views.get"](ctx, { viewId: "viw_missing" }), code("validation.not_found"));
  await assert.rejects(h["schema.layout.get"](ctx, { type: "nope" }), code("validation.not_found"));
});

test("sensitivity scan: ID, card and health text are found, nothing is returned but field names and counts", async () => {
  const { s, h, ctx } = kit();
  await h["schema.apply"](ctx, {
    ops: [{
      op: "type.create", type: "patient",
      def: { title: "Patient", fields: [
        { key: "name", type: "text", title: "Name" }, { key: "ssn", type: "text", title: "SSN" }, { key: "card", type: "text", title: "Card" },
        { key: "note", type: "longtext", title: "Note" }, { key: "memo", type: "text", title: "Memo" }, { key: "tax_id", type: "sealed", title: "Tax id" },
      ] },
    }],
  });
  await s.store.create("patient", mintUuid(), { name: "A", ssn: "123-45-6789", card: "4111 1111 1111 1111", note: "Diagnosis: diabetes, prescribed metformin", memo: "hello" });
  await s.store.create("patient", mintUuid(), { name: "B", ssn: "not an id", memo: "world" });
  const out = await h["schema.sensitivity.scan"](ctx, { type: "patient" });
  const by = new Map(out.suggestions.map((x) => [x.field, x]));
  assert.deepEqual(by.get("ssn"), { field: "ssn", kind: "id_number", matches: 1, suggestedLabel: "restricted", seal: true });
  assert.deepEqual(by.get("card"), { field: "card", kind: "card", matches: 1, suggestedLabel: "restricted", seal: true });
  assert.deepEqual(by.get("note"), { field: "note", kind: "health", matches: 1, suggestedLabel: "confidential", seal: false });
  assert.ok(!by.has("memo") && !by.has("name"), "plain text is not flagged");
  assert.ok(!by.has("tax_id"), "a sealed field is already sealed");
  const text = JSON.stringify(out);
  assert.ok(!text.includes("123-45-6789") && !text.includes("4111") && !text.includes("metformin"), "no value leaves");
});
