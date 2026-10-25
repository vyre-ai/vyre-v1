// @reads /modules/schema/migrations/0001_schema.sql
// schema write side: a diff separates additive from destructive changes, apply runs exactly that plan, destructive items need their key in confirm,
// dropped and retyped values wait in Trash for 30 days, labels are checked, views / layout / gap rules / infer behave.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mintRecordId } from "../../../lib/ids.ts";
import { applyScoped, handlers as loaderHandlers, openSchema } from "../impl.ts";
import { convertValue, parseCsv } from "../handlers/apply.ts";
import { COMPANY, PERSON } from "../fixtures/seed.ts";
import type { SchemaOp } from "../handlers/index.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

function kit(actor = "usr_dana") {
  const clock = { t: NOW };
  const s = openSchema({ now: () => clock.t, publicBase: "https://acme.vyre.run", readFile: async (id) => (id === "fil_csv" ? "a,b\n1,2\n" : "") });
  const seen: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  const mk = (who: string) => ({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (name: string, subject: string, payload: Record<string, unknown>) => { seen.push({ name, subject, payload }); }, actor: who });
  return { s, h: s.handlers, ctx: mk(actor), as: mk, seen, clock };
}
type Kit = ReturnType<typeof kit>;

async function base(k: Kit): Promise<void> {
  await k.h["schema.apply"](k.ctx, { ops: [COMPANY, PERSON] });
}
const person = (k: Kit, data: Record<string, unknown>) => {
  const id = mintRecordId();
  return k.s.store.create("acme_person", id, { name: "N", ...data }).then(() => id);
};

test("every capability of the manifest has a handler", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; module: string }[] };
  const names = raw.capabilities.filter((c) => c.module === "schema").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(loaderHandlers).sort(), names);
  const k = kit();
  assert.deepEqual(Object.keys(k.h).sort(), names);
});

test("diff: additive and destructive items, a stable preview token, problems named by item", async () => {
  const k = kit();
  const d = await k.h["schema.diff"](k.ctx, { ops: [COMPANY, PERSON] });
  assert.equal(d.additive, 2);
  assert.equal(d.destructive, 0);
  assert.deepEqual(d.problems, []);
  assert.deepEqual(d.items.map((i) => i.itemKey), ["type.create:acme_company", "type.create:acme_person"]);
  assert.match(d.previewToken, /^[0-9a-f]{32}$/);
  assert.equal((await k.h["schema.diff"](k.ctx, { ops: [COMPANY, PERSON] })).previewToken, d.previewToken);

  const applied = await k.h["schema.apply"](k.ctx, { ops: [COMPANY, PERSON], previewToken: d.previewToken });
  assert.equal(applied.applied, 2);
  assert.match(applied.changeId, /^sch_[a-z0-9]+$/);

  const again = await k.h["schema.diff"](k.ctx, { ops: [COMPANY] });
  assert.equal(again.problems[0]?.itemKey, "type.create:acme_company");
  assert.match(again.problems[0]!.message, /already exists/);
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: [COMPANY] }), code("validation.duplicate"));

  const drop = await k.h["schema.diff"](k.ctx, { ops: [{ op: "field.drop", type: "acme_person", field: "notes" }] });
  assert.equal(drop.destructive, 1);
  assert.equal(drop.items[0]!.destructive, true);
  assert.equal(drop.items[0]!.copiedToTrash, true);
  assert.equal(drop.items[0]!.itemKey, "field.drop:acme_person.notes");
});

test("apply: additions go straight through, rows use the new fields, events and the change log follow", async () => {
  const k = kit();
  await base(k);
  const d = (await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type;
  assert.equal(d.version, 1);
  assert.deepEqual(d.fields.map((f) => f.key), ["name", "email", "age", "stage", "notes"]);
  const ev = k.seen.find((e) => e.name === "schema.changed")!;
  assert.deepEqual([...(ev.payload.types as string[])].sort(), ["acme_company", "acme_person"]);
  assert.equal(ev.payload.destructive, false);

  const id = await person(k, { email: "a@x.com", stage: "new" });
  assert.equal((await k.s.store.get("acme_person", id))?.data.stage, "new");
  await assert.rejects(person(k, { stage: "zzz" }), (e: unknown) => (e as { code?: string }).code === "invalid");

  const added = await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.add", type: "acme_person", field: "phone", def: { type: "phone", title: "Phone" } }] });
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.version, 2);
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.at(-1)!.key, "phone");
  const rec = await k.s.store.get("acme_person", id);
  await k.s.store.update("acme_person", id, { phone: "555" }, rec!.version);
  assert.equal((await k.s.store.get("acme_person", id))?.data.phone, "555");
  const log = await k.h["schema.changes.list"](k.ctx, {});
  assert.equal(log.changes[0]!.changeId, added.changeId, "newest first");
  assert.match(log.changes[0]!.summary, /Add field Phone/);

  await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.reorder", type: "acme_person", order: ["phone", "name", "email", "age", "stage", "notes"] }] });
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields[0]!.key, "phone");
  const diff = await k.h["schema.diff"](k.ctx, { ops: [{ op: "field.reorder", type: "acme_person", order: ["name"] }] });
  assert.match(diff.problems[0]!.message, /every field/);
});

test("destructive: field.drop needs its itemKey in confirm, copies values to Trash for 30 days, and restore brings them back", async () => {
  const k = kit();
  await base(k);
  const a = await person(k, { age: "12" });
  const b = await person(k, { age: "x" });
  const c = await person(k, {});
  const ops: SchemaOp[] = [{ op: "field.drop", type: "acme_person", field: "age" }];
  const diff = await k.h["schema.diff"](k.ctx, { ops });
  assert.equal(diff.items[0]!.affectedRows, 2);

  await assert.rejects(k.h["schema.apply"](k.ctx, { ops }), code("validation.precondition_failed"));
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops, confirm: ["field.drop:acme_person.other"] }), code("validation.precondition_failed"));
  assert.equal((await k.s.store.get("acme_person", a))?.data.age, "12", "nothing changed without the confirm");

  k.seen.length = 0;
  await k.h["schema.apply"](k.ctx, { ops, confirm: ["field.drop:acme_person.age"], reason: "tidy" });
  assert.equal((await k.s.store.get("acme_person", a))?.data.age, undefined);
  assert.equal((await k.s.store.get("acme_person", c))?.data.name, "N");
  assert.ok(!(await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.some((f) => f.key === "age"));
  assert.equal(k.seen.find((e) => e.name === "schema.changed")?.payload.destructive, true);
  const trash = (await k.h["schema.trash.list"](k.ctx, {})).items;
  assert.deepEqual(trash, [{ type: "acme_person", field: "age", droppedAt: NOW, expiresAt: NOW + 30 * DAY, rows: 2 }]);

  k.seen.length = 0;
  await k.h["schema.restore_field"](k.ctx, { type: "acme_person", field: "age" });
  assert.equal((await k.s.store.get("acme_person", a))?.data.age, "12");
  assert.equal((await k.s.store.get("acme_person", b))?.data.age, "x");
  assert.ok((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.some((f) => f.key === "age"));
  assert.ok(k.seen.some((e) => e.name === "schema.field_restored" && e.payload.field === "age"));
  assert.deepEqual((await k.h["schema.trash.list"](k.ctx, {})).items, []);
  await assert.rejects(k.h["schema.restore_field"](k.ctx, { type: "acme_person", field: "age" }), code("validation.not_found"));

  await k.h["schema.apply"](k.ctx, { ops, confirm: ["field.drop:acme_person.age"] });
  k.clock.t += 31 * DAY;
  assert.deepEqual((await k.h["schema.trash.list"](k.ctx, {})).items, [], "after 30 days it is gone");
  await assert.rejects(k.h["schema.restore_field"](k.ctx, { type: "acme_person", field: "age" }), code("validation.not_found"));
});

test("retype converts what it can, clears the rest, and keeps the old values; rename moves the data", async () => {
  const k = kit();
  await base(k);
  const a = await person(k, { age: "12", email: "a@x.com" });
  const b = await person(k, { age: "x" });
  const c = await person(k, { age: "7.5" });
  const ops: SchemaOp[] = [{ op: "field.retype", type: "acme_person", field: "age", toType: "number" }];
  const diff = await k.h["schema.diff"](k.ctx, { ops });
  assert.equal(diff.items[0]!.destructive, true);
  assert.equal(diff.items[0]!.affectedRows, 3);
  assert.match(diff.items[0]!.summary, /1 value cannot convert/);
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops }), code("validation.precondition_failed"));
  await k.h["schema.apply"](k.ctx, { ops, confirm: ["field.retype:acme_person.age"] });
  assert.equal((await k.s.store.get("acme_person", a))?.data.age, 12);
  assert.equal((await k.s.store.get("acme_person", b))?.data.age, undefined);
  assert.equal((await k.s.store.get("acme_person", c))?.data.age, 7.5);
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.find((f) => f.key === "age")!.type, "number");

  // The old text comes back by restoring the field.
  await k.h["schema.restore_field"](k.ctx, { type: "acme_person", field: "age" });
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.find((f) => f.key === "age")!.type, "text");
  assert.equal((await k.s.store.get("acme_person", b))?.data.age, "x");
  assert.equal((await k.s.store.get("acme_person", c))?.data.age, "7.5");

  await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.rename", type: "acme_person", field: "email", newKey: "mail" }, { op: "field.rename", type: "acme_person", field: "name", newKey: "full_name" }] });
  const d = (await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type;
  assert.ok(d.fields.some((f) => f.key === "mail") && !d.fields.some((f) => f.key === "email"));
  assert.equal(d.titleField, "full_name");
  assert.equal((await k.s.store.get("acme_person", a))?.data.mail, "a@x.com");
  assert.equal((await k.s.store.get("acme_person", a))?.data.email, undefined);
  assert.equal((await k.s.store.get("acme_person", a))?.data.full_name, "N");
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: [{ op: "field.rename", type: "acme_person", field: "mail", newKey: "age" }] }), code("validation.duplicate"));
  const bad = await k.h["schema.diff"](k.ctx, { ops: [{ op: "field.retype", type: "acme_person", field: "mail", toType: "relation" }] });
  assert.match(bad.problems[0]!.message, /cannot be retyped to relation/);
});

test("relations are made and dropped as pairs; dropping a type needs its relations gone first", async () => {
  const k = kit();
  await base(k);
  await k.h["schema.apply"](k.ctx, { ops: [{ op: "relation.add", type: "acme_person", field: "employer", def: { to: "acme_company", inverse: "staff" } }] });
  const person0 = (await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.find((f) => f.key === "employer")!;
  assert.deepEqual(person0.options, { target: "acme_company", inverse: "staff" });
  assert.deepEqual((await k.h["schema.types.get"](k.ctx, { type: "acme_company" })).type.fields.find((f) => f.key === "staff")!.options, { target: "acme_person", inverse: "employer" });

  const co = mintRecordId();
  await k.s.store.create("acme_company", co, { name: "Acme" });
  const p = mintRecordId();
  await k.s.store.create("acme_person", p, { name: "Ann", employer: [{ urn: `vyre://sp_schema/acme_company/${co}` }] });

  const blocked = await k.h["schema.diff"](k.ctx, { ops: [{ op: "type.drop", type: "acme_company" }] });
  assert.match(blocked.problems[0]!.message, /relation to acme_company/);
  const fieldDrop = await k.h["schema.diff"](k.ctx, { ops: [{ op: "field.drop", type: "acme_person", field: "employer" }] });
  assert.match(fieldDrop.problems[0]!.message, /relation\.drop/);

  const rel: SchemaOp[] = [{ op: "relation.drop", type: "acme_person", field: "employer" }];
  const diff = await k.h["schema.diff"](k.ctx, { ops: rel });
  assert.equal(diff.items[0]!.destructive, true);
  assert.equal(diff.items[0]!.affectedRows, 1);
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: rel }), code("validation.precondition_failed"));
  await k.h["schema.apply"](k.ctx, { ops: rel, confirm: ["relation.drop:acme_person.employer"] });
  assert.ok(!(await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.some((f) => f.key === "employer"));
  assert.ok(!(await k.h["schema.types.get"](k.ctx, { type: "acme_company" })).type.fields.some((f) => f.key === "staff"));
  assert.equal((await k.s.store.get("acme_person", p))?.data.employer, undefined);

  k.seen.length = 0;
  const drop: SchemaOp[] = [{ op: "type.drop", type: "acme_company" }];
  const dd = await k.h["schema.diff"](k.ctx, { ops: drop });
  assert.equal(dd.items[0]!.affectedRows, 1);
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: drop }), code("validation.precondition_failed"));
  await k.h["schema.apply"](k.ctx, { ops: drop, confirm: ["type.drop:acme_company"] });
  assert.ok(!(await k.s.store.types()).some((t) => t.name === "acme_company"));
  await assert.rejects(k.h["schema.types.get"](k.ctx, { type: "acme_company" }), code("validation.not_found"));
  assert.ok(k.seen.some((e) => e.name === "schema.type_dropped" && e.payload.type === "acme_company"));
  assert.ok((await k.h["schema.trash.list"](k.ctx, {})).items.some((t) => t.type === "acme_company" && t.field === undefined && t.rows === 1));
});

test("a record on hold stops a drop and nothing changes", async () => {
  const k = kit();
  await base(k);
  const p = await person(k, { age: "5" });
  k.s.tx.exec("CREATE TABLE IF NOT EXISTS records_row_meta (type TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, label INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (type, id))");
  k.s.tx.run("INSERT INTO records_row_meta (type, id, holds) VALUES (?, ?, 1)", "acme_person", p);
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: [{ op: "field.drop", type: "acme_person", field: "age" }], confirm: ["field.drop:acme_person.age"] }), code("permission.on_hold"));
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops: [{ op: "type.drop", type: "acme_person" }], confirm: ["type.drop:acme_person"] }), code("permission.on_hold"));
  assert.equal((await k.s.store.get("acme_person", p))?.data.age, "5");
  assert.ok((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.some((f) => f.key === "age"));
});

test("labels per type and per field are checked, stored, and announced", async () => {
  const k = kit();
  await base(k);
  k.seen.length = 0;
  await k.h["schema.set_label"](k.ctx, { type: "acme_person", label: "confidential" });
  await k.h["schema.set_label"](k.ctx, { type: "acme_person", field: "email", label: "restricted" });
  const d = (await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type;
  assert.equal(d.label, "confidential");
  assert.equal(d.fields.find((f) => f.key === "email")!.label, "restricted");
  const labels = k.seen.filter((e) => e.name === "schema.label_changed").map((e) => e.payload);
  assert.deepEqual(labels, [{ type: "acme_person", from: "internal", to: "confidential" }, { type: "acme_person", field: "email", from: "confidential", to: "restricted" }]);
  const stored = (await k.s.store.types()).find((t) => t.name === "acme_person")!.fields.find((f) => f.name === "email")!;
  assert.equal(stored["sensitivity"], "restricted");
  assert.equal(d.version, 3);

  await assert.rejects(k.h["schema.set_label"](k.ctx, { type: "acme_person", label: "secret" as never }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.set_label"](k.ctx, { type: "acme_person", field: "nope", label: "public" }), code("validation.precondition_failed"));
  await assert.rejects(k.h["schema.set_label"](k.ctx, { type: "nope", label: "public" }), code("validation.not_found"));
  const diff = await k.h["schema.diff"](k.ctx, { ops: [
    { op: "type.create", type: "bad_label", def: { label: "secret" } },
    { op: "field.add", type: "acme_person", field: "x", def: { type: "text", title: "X", label: "top" } },
  ] });
  assert.equal(diff.problems.length, 2);
  assert.match(diff.problems[0]!.message, /not a sensitivity label/);
  assert.match(diff.problems[1]!.message, /not a sensitivity label/);
});

test("a preview token goes stale when the schema moved", async () => {
  const k = kit();
  await base(k);
  const ops: SchemaOp[] = [{ op: "field.add", type: "acme_person", field: "n1", def: { type: "number", title: "N1" } }];
  const { previewToken } = await k.h["schema.diff"](k.ctx, { ops });
  await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.add", type: "acme_person", field: "n2", def: { type: "number", title: "N2" } }] });
  await assert.rejects(k.h["schema.apply"](k.ctx, { ops, previewToken }), code("validation.precondition_failed"));
  const fresh = await k.h["schema.diff"](k.ctx, { ops });
  await k.h["schema.apply"](k.ctx, { ops, previewToken: fresh.previewToken });
  assert.ok((await k.h["schema.types.get"](k.ctx, { type: "acme_person" })).type.fields.some((f) => f.key === "n1"));
});

test("field rules: types, options, formulas, lookups, rollups, uniqueness and dependents", async () => {
  const k = kit();
  await base(k);
  await k.h["schema.apply"](k.ctx, { ops: [
    { op: "type.create", type: "line", def: { title: "Line", fields: [{ key: "name", type: "text", title: "Name" }, { key: "price", type: "number", title: "Price" }, { key: "qty", type: "number", title: "Qty" }] } },
    { op: "relation.add", type: "acme_person", field: "employer", def: { to: "acme_company", inverse: "staff" } },
  ] });
  const diff = (ops: SchemaOp[]) => k.h["schema.diff"](k.ctx, { ops });
  const one = async (op: SchemaOp) => (await diff([op])).problems.map((p) => p.message).join("|");
  const add = (field: string, def: Record<string, unknown>, type = "line"): SchemaOp => ({ op: "field.add", type, field, def });

  assert.equal(await one(add("total", { type: "formula", title: "Total", options: { expr: "price * qty" } })), "");
  assert.match(await one(add("total", { type: "formula", title: "Total", options: { expr: "price * nope" } })), /reads nope/);
  assert.match(await one(add("total", { type: "formula", title: "Total", options: { expr: "price *" } })), /does not parse/);
  assert.match(await one(add("total", { type: "formula", title: "Total" })), /options/);
  assert.match(await one(add("x", { type: "nope", title: "X" })), /not a field type/);
  assert.match(await one(add("Bad Key", { type: "text", title: "X" })), /not a field key/);
  assert.match(await one(add("c", { type: "choice", title: "C", options: { choices: [{ key: "a", title: "A" }, { key: "a", title: "B" }] } })), /distinct keys/);
  assert.match(await one(add("c", { type: "choice", title: "C", default: "z", options: { choices: [{ key: "a", title: "A" }] } })), /default/);
  assert.match(await one(add("r", { type: "relation", title: "R", options: { target: "line" } })), /relation\.add/);
  assert.match(await one(add("t", { type: "formula", title: "T", required: true, options: { expr: "price" } })), /computed/);
  assert.match(await one(add("s", { type: "sealed", title: "S", unique: true })), /sealed field cannot be unique/);
  assert.match(await one(add("price", { type: "number", title: "Again" })), /already has a field price/);

  assert.equal(await one(add("industry", { type: "lookup", title: "Industry", options: { via: "employer", field: "industry" } }, "acme_person")), "");
  assert.match(await one(add("industry", { type: "lookup", title: "Industry", options: { via: "name", field: "industry" } }, "acme_person")), /must name a relation/);
  assert.match(await one(add("industry", { type: "lookup", title: "Industry", options: { via: "employer", field: "nope" } }, "acme_person")), /not a field of acme_company/);
  assert.equal(await one(add("heads", { type: "rollup", title: "Heads", options: { via: "staff", field: "name", fn: "count" } }, "acme_company")), "");
  assert.match(await one(add("heads", { type: "rollup", title: "Heads", options: { via: "staff", field: "name", fn: "median" } }, "acme_company")), /fn/);

  await k.h["schema.apply"](k.ctx, { ops: [add("total", { type: "formula", title: "Total", options: { expr: "price * qty" } })] });
  assert.match(await one({ op: "field.drop", type: "line", field: "price" }), /used by line\.total/);
  assert.match(await one({ op: "field.rename", type: "line", field: "qty", newKey: "count" }), /used by line\.total/);
  assert.match(await one({ op: "field.drop", type: "line", field: "name" }), /title, summary, status or owner/);

  await k.s.store.create("line", mintRecordId(), { name: "a", price: 1 });
  await k.s.store.create("line", mintRecordId(), { name: "b", price: 1 });
  assert.match(await one({ op: "field.update", type: "line", field: "price", def: { unique: true } }), /duplicate values/);
  assert.equal(await one({ op: "field.update", type: "line", field: "qty", def: { unique: true } }), "");
  assert.match(await one({ op: "field.update", type: "line", field: "qty", def: { type: "text" } }), /cannot be changed with field\.update/);
  assert.match(await one({ op: "field.update", type: "line", field: "nope", def: {} }), /no field nope/);
  assert.match(await one({ op: "type.update", type: "line", def: { titleField: "nope" } }), /title field nope/);
  assert.match(await one({ op: "type.update", type: "line", def: { key: "x" } }), /cannot be changed/);
});

test("system types keep their manifest fields", async () => {
  const k = kit();
  await k.h["schema.describe"](k.ctx, {});
  const one = async (op: SchemaOp) => (await k.h["schema.diff"](k.ctx, { ops: [op] })).problems.map((p) => p.message).join("|");
  assert.match(await one({ op: "type.drop", type: "agent" }), /system type/);
  assert.match(await one({ op: "field.drop", type: "agent", field: "model" }), /system type/);
  assert.match(await one({ op: "field.rename", type: "agent", field: "model", newKey: "engine" }), /system type/);
  assert.match(await one({ op: "field.retype", type: "agent", field: "model", toType: "longtext" }), /system type/);
  assert.match(await one({ op: "type.update", type: "agent", def: { titleField: "role" } }), /system type/);
  assert.equal(await one({ op: "field.add", type: "agent", field: "nickname", def: { type: "text", title: "Nickname" } }), "");
  assert.equal(await one({ op: "field.update", type: "agent", field: "model", def: { title: "Model name" } }), "");
});

test("site tables: the sites module changes only its own site's tables without schema.manage", async () => {
  const k = kit();
  await base(k);
  const site = "sit_abc";
  const r = await applyScoped(k.s.deps, k.ctx, site, [{ op: "type.create", type: "site_leads", def: { title: "Leads", scope: "sit_other", fields: [{ key: "name", type: "text", title: "Name" }] } }]);
  assert.match(r.changeId, /^sch_/);
  assert.equal((await k.h["schema.types.get"](k.ctx, { type: "site_leads" })).type.scope, site, "the scope is forced to the site");
  assert.equal((await k.h["schema.types.list"](k.ctx, {})).types.find((t) => t.key === "site_leads")!.scope, site);
  await applyScoped(k.s.deps, k.ctx, site, [{ op: "field.add", type: "site_leads", field: "email", def: { type: "email", title: "Email" } }]);
  await assert.rejects(applyScoped(k.s.deps, k.ctx, site, [{ op: "field.add", type: "acme_person", field: "x", def: { type: "text", title: "X" } }]), code("permission.no_grant"));
  await assert.rejects(applyScoped(k.s.deps, k.ctx, "sit_other", [{ op: "field.add", type: "site_leads", field: "y", def: { type: "text", title: "Y" } }]), code("permission.no_grant"));
  await assert.rejects(applyScoped(k.s.deps, k.ctx, site, [{ op: "relation.add", type: "site_leads", field: "who", def: { to: "acme_person", inverse: "leads" } }]), code("permission.no_grant"));
  await assert.rejects(applyScoped(k.s.deps, k.ctx, site, [{ op: "type.drop", type: "site_leads" }]), code("validation.precondition_failed"));
  await applyScoped(k.s.deps, k.ctx, site, [{ op: "type.drop", type: "site_leads" }], { confirm: ["type.drop:site_leads"] });
  await assert.rejects(k.h["schema.types.get"](k.ctx, { type: "site_leads" }), code("validation.not_found"));
});

test("views: personal until published, kind needs checked, only the owner changes or deletes, external links expire", async () => {
  const k = kit("usr_dana");
  await base(k);
  const bo = k.as("usr_bo");
  const board = { type: "acme_person", kind: "board", title: "Pipeline" };
  await assert.rejects(k.h["views.save"](k.ctx, { ...board }), code("validation.bad_input"));
  await assert.rejects(k.h["views.save"](k.ctx, { ...board, config: { group: "name" } }), code("validation.bad_input"));
  await assert.rejects(k.h["views.save"](k.ctx, { ...board, kind: "nope" }), code("validation.bad_input"));
  await assert.rejects(k.h["views.save"](k.ctx, { type: "acme_person", kind: "table", title: "T", hidden: ["nope"] }), code("validation.bad_input"));
  await assert.rejects(k.h["views.save"](k.ctx, { type: "acme_person", kind: "table", title: "T", sort: [{ field: "nope", dir: "asc" }] }), code("validation.bad_input"));
  await assert.rejects(k.h["views.save"](k.ctx, { type: "acme_person", kind: "table", title: " " }), code("validation.bad_input"));

  k.seen.length = 0;
  const v = (await k.h["views.save"](k.ctx, { ...board, config: { group: "stage" }, filter: { field: "stage", op: "eq", value: "new" }, hidden: ["notes"] })).view;
  assert.match(v.viewId, /^viw_[a-z0-9]+$/);
  assert.equal(v.shared, false);
  assert.equal(v.ownerId, "usr_dana");
  assert.deepEqual(v.hidden, ["notes"]);
  assert.deepEqual(v.config, { group: "stage" });
  assert.equal(v.updatedAt, NOW);
  assert.ok(k.seen.some((e) => e.name === "view.saved"));

  assert.equal((await k.h["views.list"](k.ctx, { type: "acme_person" })).views.length, 1);
  assert.equal((await k.h["views.list"](bo, { type: "acme_person" })).views.length, 0, "personal");
  await assert.rejects(k.h["views.get"](bo, { viewId: v.viewId }), code("validation.not_found"));

  const renamed = (await k.h["views.save"](k.ctx, { ...board, viewId: v.viewId, title: "Pipeline 2", config: { group: "stage" } })).view;
  assert.equal(renamed.title, "Pipeline 2");
  assert.equal(renamed.viewId, v.viewId);

  const pub = (await k.h["views.publish"](k.ctx, { viewId: v.viewId, shared: true })).view;
  assert.equal(pub.shared, true);
  assert.ok(k.seen.some((e) => e.name === "view.published" && e.payload.shared === true));
  assert.equal((await k.h["views.list"](bo, { type: "acme_person" })).views.length, 1, "shared");
  assert.equal((await k.h["views.list"](bo, { type: "acme_person", kind: "table" })).views.length, 0);
  await assert.rejects(k.h["views.save"](bo, { ...board, viewId: v.viewId, config: { group: "stage" } }), code("permission.no_grant"));
  await assert.rejects(k.h["views.delete"](bo, { viewId: v.viewId }), code("permission.no_grant"));

  const link = await k.h["views.share_external"](k.ctx, { viewId: v.viewId, expiresAt: NOW + DAY });
  assert.match(link.url, /^https:\/\/acme\.vyre\.run\/views\/[0-9a-f]{48}$/);
  assert.equal(link.expiresAt, NOW + DAY);
  await assert.rejects(k.h["views.share_external"](k.ctx, { viewId: v.viewId, expiresAt: NOW - 1 }), code("validation.bad_input"));

  assert.deepEqual(await k.h["views.delete"](k.ctx, { viewId: v.viewId }), { deleted: true });
  assert.equal((await k.h["views.list"](k.ctx, { type: "acme_person" })).views.length, 0);
  assert.ok(k.seen.some((e) => e.name === "view.deleted"));
});

test("layout and gap rules are validated, and follow a renamed or dropped field", async () => {
  const k = kit();
  await base(k);
  const sections = [{ key: "main", title: "Main", fields: ["name", "email"] }, { key: "more", title: "More", fields: ["age", "notes"], folded: true }];
  assert.deepEqual((await k.h["schema.layout.set"](k.ctx, { type: "acme_person", sections })).sections, sections);
  assert.deepEqual((await k.h["schema.layout.get"](k.ctx, { type: "acme_person" })).sections, sections);
  await assert.rejects(k.h["schema.layout.set"](k.ctx, { type: "acme_person", sections: [{ key: "a", title: "A", fields: ["nope"] }] }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.layout.set"](k.ctx, { type: "acme_person", sections: [{ key: "a", title: "A", fields: ["name"] }, { key: "b", title: "B", fields: ["name"] }] }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.layout.set"](k.ctx, { type: "acme_person", sections: [{ key: "a", title: "A", fields: [] }, { key: "a", title: "B", fields: [] }] }), code("validation.bad_input"));

  const rule = { ruleId: "gap_email", field: "email", when: "missing" as const, route: "task" as const, enabled: true };
  assert.deepEqual((await k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule })).rule, rule);
  assert.deepEqual((await k.h["schema.gap_rules.list"](k.ctx, { type: "acme_person" })).rules, [rule]);
  await k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule: { ...rule, enabled: false } });
  assert.equal((await k.h["schema.gap_rules.list"](k.ctx, { type: "acme_person" })).rules[0]!.enabled, false);
  await assert.rejects(k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule: { ...rule, ruleId: "s", when: "stale" } }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule: { ...rule, ruleId: "a", route: "agent_lookup" } }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule: { ...rule, ruleId: "i", route: "ai_field" } }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.gap_rules.set"](k.ctx, { type: "acme_person", rule: { ...rule, ruleId: "f", field: "nope" } }), code("validation.bad_input"));

  await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.rename", type: "acme_person", field: "email", newKey: "mail" }] });
  assert.equal((await k.h["schema.layout.get"](k.ctx, { type: "acme_person" })).sections[0]!.fields[1], "mail");
  assert.equal((await k.h["schema.gap_rules.list"](k.ctx, { type: "acme_person" })).rules[0]!.field, "mail");
  await k.h["schema.apply"](k.ctx, { ops: [{ op: "field.drop", type: "acme_person", field: "notes" }], confirm: ["field.drop:acme_person.notes"] });
  assert.deepEqual((await k.h["schema.layout.get"](k.ctx, { type: "acme_person" })).sections[1]!.fields, ["age"]);
});

test("infer: columns become typed fields, a title field is picked, the ops apply and rows fit", async () => {
  const k = kit();
  const csv = [
    "Full Name,Email,Age,Joined,Active,Plan,Phone,Bio",
    'Ann Lee,ann@x.com,31,2024-01-05,yes,Gold,+1 555 123 4567,"Likes, commas"',
    "Bo Chan,bo@x.com,42,2024-02-11,no,Silver,+1 555 123 4568,short",
    "Cy Dun,cy@x.com,27,2024-03-02,yes,Gold,+1 555 123 4569,short",
    "Di Eve,di@x.com,55,2024-04-19,no,Gold,+1 555 123 4570,short",
    `Ed Fox,ed@x.com,38,2024-05-23,yes,Silver,+1 555 123 4571,${"long ".repeat(40)}`,
  ].join("\r\n");
  const out = await k.h["schema.infer"](k.ctx, { text: csv, name: "Members" });
  assert.equal(out.rowCount, 5);
  assert.deepEqual(out.columns.map((c) => [c.field, c.type]), [
    ["full_name", "text"], ["email", "email"], ["age", "number"], ["joined", "datetime"], ["active", "checkbox"], ["plan", "choice"], ["phone", "phone"], ["bio", "longtext"],
  ]);
  assert.deepEqual(out.columns[0]!.sample, ["Ann Lee", "Bo Chan", "Cy Dun"]);
  assert.equal(out.columns[7]!.sample[0], "Likes, commas");
  const op = out.ops[0]!;
  assert.equal(op.op, "type.create");
  assert.equal(op.type, "members");
  assert.equal(op.def!["titleField"], "full_name");
  const plan = await k.h["schema.diff"](k.ctx, { ops: out.ops });
  assert.deepEqual(plan.problems, []);
  await k.h["schema.apply"](k.ctx, { ops: out.ops, previewToken: plan.previewToken });
  const id = mintRecordId();
  await k.s.store.create("members", id, { full_name: "Ann Lee", email: "ann@x.com", age: 31, joined: "2024-01-05", active: true, plan: "gold", phone: "+1 555 123 4567", bio: "x" });
  assert.equal((await k.s.store.get("members", id))?.data.plan, "gold");

  const semi = await k.h["schema.infer"](k.ctx, { text: "name;qty\nA;1\nB;2\n" });
  assert.deepEqual(semi.columns.map((c) => [c.field, c.type]), [["name", "text"], ["qty", "number"]]);
  assert.equal(semi.ops[0]!.type, "imported");
  const numFirst = await k.h["schema.infer"](k.ctx, { text: "qty,price\n1,2\n3,4\n" });
  assert.equal(numFirst.ops[0]!.def!["titleField"], "qty", "no text column: the first becomes the title and is text");
  assert.equal(numFirst.columns[0]!.type, "text");
  const viaFile = await k.h["schema.infer"](k.ctx, { fileId: "fil_csv" });
  assert.equal(viaFile.rowCount, 1);
  await assert.rejects(k.h["schema.infer"](k.ctx, { text: "  " }), code("validation.bad_input"));
  await assert.rejects(k.h["schema.infer"](k.ctx, {}), code("validation.bad_input"));
  const bare = openSchema();
  await assert.rejects(bare.handlers["schema.infer"](k.ctx, { fileId: "fil_x" }), code("validation.unsupported"));

  assert.deepEqual(parseCsv('a,b\n"x ""y"" z",2\n\n3,4'), [["a", "b"], ['x "y" z', "2"], ["3", "4"]]);
});

test("convertValue: what carries over and what does not", () => {
  const f = (type: string, options?: Record<string, unknown>) => ({ key: "k", type, title: "K", ...(options ? { options } : {}) });
  assert.deepEqual(convertValue(f("number"), f("text"), 12), { ok: true, value: "12" });
  assert.deepEqual(convertValue(f("text"), f("number"), "1,200.5"), { ok: true, value: 1200.5 });
  assert.equal(convertValue(f("text"), f("number"), "abc").ok, false);
  assert.deepEqual(convertValue(f("text"), f("checkbox"), "Yes"), { ok: true, value: true });
  assert.equal(convertValue(f("text"), f("checkbox"), "maybe").ok, false);
  assert.deepEqual(convertValue(f("number"), f("money", { currency: "EUR" }), 5), { ok: true, value: { amount: 5, currency: "EUR" } });
  assert.deepEqual(convertValue(f("money"), f("number"), { amount: 7, currency: "USD" }), { ok: true, value: 7 });
  assert.deepEqual(convertValue(f("text"), f("choice", { choices: [{ key: "gold", title: "Gold" }] }), "GOLD"), { ok: true, value: "gold" });
  assert.equal(convertValue(f("text"), f("choice", { choices: [{ key: "gold", title: "Gold" }] }), "tin").ok, false);
  assert.deepEqual(convertValue(f("text"), f("multichoice", { choices: [{ key: "a", title: "A" }, { key: "b", title: "B" }] }), "a, B"), { ok: true, value: ["a", "b"] });
  assert.deepEqual(convertValue(f("number"), f("datetime"), 0), { ok: true, value: "1970-01-01T00:00:00.000Z" });
  assert.equal(convertValue(f("text"), f("url"), "ftp://x").ok, false);
  assert.equal(convertValue(f("text"), f("rating"), "6").ok, false);
  assert.deepEqual(convertValue(f("text"), f("address"), "1 Main St"), { ok: true, value: { line1: "1 Main St" } });
  assert.deepEqual(convertValue(f("text"), f("text"), null), { ok: true, value: null });
});
