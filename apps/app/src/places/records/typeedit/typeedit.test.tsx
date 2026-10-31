// Records > editing record types and fields in place: names make keys, every change is schema.diff then schema.apply on that exact preview, a destructive one says its row count once,
// a built in type cannot be deleted (the item is off, with its reason), and without the permission the controls are not drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { FieldsPanel, TypeSheet, addFieldOps, addableTypes, commitChange, confirmLine, createTypeOps, dropFieldOps, dropTypeOps, fieldMenuEntries, freeKey, moveFieldOps, pluralOf, renameFieldOps, retypeBlocked, retypeFieldOps, retypeTarget, slugOf, stageChange, fieldLine, sectionOf, typeSections, typeDeleteBlocked, typeRowMenu } from "./index.ts";
import type { DiffOut, FieldTypeInfo, PanelType, SchemaOp } from "./index.ts";
import { typeGroups, worthShowing } from "../sidebar/model.ts";
import type { TypeRow } from "../sidebar/model.ts";
import { RecordTypesList, SchemaDataProvider } from "../schemamap/index.ts";
import { createSampleSchema, northwind } from "../schemamap/sample.ts";
import type { SampleSchema } from "../schemamap/sample.ts";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { createSampleRecords } from "../table/sample.ts";
import { northwind as tableSpace } from "../table/sample.ts";
import type { SchemaData } from "../schemamap/index.ts";

const has = (s: string, needle: string): boolean => s.includes(needle);
const clean = (s: string): string => s.replaceAll("<!-- -->", "");

/** A call door that answers schema.diff from a canned preview and records every call. */
function door(items: Array<{ destructive: boolean; affectedRows: number; summary?: string }> = [{ destructive: false, affectedRows: 0 }], problems: string[] = []): { call(cap: string, input: unknown): Promise<unknown>; calls: { cap: string; input: unknown }[] } {
  const calls: { cap: string; input: unknown }[] = [];
  return {
    calls,
    async call(cap, input) {
      calls.push({ cap, input });
      if (cap === "schema.diff") {
        const out: DiffOut = {
          previewToken: "tok_1", additive: items.filter((i) => !i.destructive).length, destructive: items.filter((i) => i.destructive).length,
          items: items.map((i, n) => ({ itemKey: `k${n}`, op: "x", type: "client", summary: i.summary ?? "change", destructive: i.destructive, affectedRows: i.affectedRows, copiedToTrash: i.destructive })),
          problems: problems.map((message) => ({ itemKey: "k0", message })),
        };
        return out;
      }
      if (cap === "schema.apply") return { changeId: "chg_1", applied: 1, items: [] };
      throw new Error(`no answer for ${cap}`);
    },
  };
}

test("a name makes the key; a taken key gets the next free one; the plural is derived", () => {
  assert.equal(slugOf("Client"), "client");
  assert.equal(slugOf("Case file"), "case_file");
  assert.equal(slugOf("  Café  Order! "), "cafe_order");
  assert.equal(slugOf("2024 Filings"), "t_2024_filings");
  assert.equal(slugOf("!!!"), "");
  assert.equal(freeKey("client", ["client", "client_2"]), "client_3");
  assert.equal(freeKey("client", ["project"]), "client");
  assert.equal(pluralOf("Client"), "Clients");
  assert.equal(pluralOf("Matter"), "Matters");
  assert.equal(pluralOf("Company"), "Companies");
  assert.equal(pluralOf("Box"), "Boxes");
  assert.equal(pluralOf("Day"), "Days");
  assert.equal(pluralOf(" "), "");
});

test("create type: schema.diff first, then schema.apply on that exact preview, with the slug as the key", async () => {
  const made = createTypeOps({ name: "Case file", plural: "", icon: "folder", takenKeys: ["client"] });
  assert.equal(made.key, "case_file");
  const op = made.ops[0] as SchemaOp;
  assert.equal(op.op, "type.create");
  assert.equal(op.type, "case_file");
  assert.equal((op.def as { title: string }).title, "Case file");
  assert.equal((op.def as { plural: string }).plural, "Case files");
  assert.equal((op.def as { icon: string }).icon, "folder");
  const d = door();
  const staged = await stageChange(d.call, made.ops);
  assert.ok(staged.ok);
  if (!staged.ok) return;
  assert.equal(staged.staged.destructive, false);
  const done = await commitChange(d.call, staged.staged);
  assert.equal(done.ok, true);
  assert.deepEqual(d.calls.map((c) => c.cap), ["schema.diff", "schema.apply"]);
  const apply = d.calls[1]!.input as { ops: SchemaOp[]; previewToken: string; confirm: string[]; idempotencyKey: string };
  assert.equal(apply.previewToken, "tok_1");
  assert.equal(apply.ops[0]!.type, "case_file");
  assert.deepEqual(apply.confirm, []);
  assert.ok(apply.idempotencyKey.length > 0);
  assert.equal(createTypeOps({ name: "Client", plural: "Clients", icon: "table", takenKeys: ["client"] }).key, "client_2");
});

test("a refused preview stops before apply and carries the backend's reason", async () => {
  const d = door([{ destructive: false, affectedRows: 0 }], ["client already exists"]);
  const out = await stageChange(d.call, createTypeOps({ name: "Client", plural: "", icon: "table", takenKeys: [] }).ops);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error, "client already exists");
  assert.deepEqual(d.calls.map((c) => c.cap), ["schema.diff"]);
});

test("add field: field.add with the slug key, the chosen type and required; choice fields start with two options", () => {
  const a = addFieldOps({ type: "client", name: "Budget", fieldType: "money", required: true, takenKeys: ["name", "email"] });
  assert.equal(a.key, "budget");
  assert.deepEqual(a.ops[0], { op: "field.add", type: "client", field: "budget", def: { title: "Budget", type: "money", required: true } });
  const dup = addFieldOps({ type: "client", name: "Email", fieldType: "email", required: false, takenKeys: ["name", "email"] });
  assert.equal(dup.key, "email_2");
  const c = addFieldOps({ type: "client", name: "Stage", fieldType: "status", required: false, takenKeys: [] }).ops[0] as SchemaOp;
  assert.ok(Array.isArray((c.def as { options: { stages: unknown[] } }).options.stages));
});

test("rename changes the title and keeps the key; retype and reorder are their own ops", () => {
  assert.deepEqual(renameFieldOps("client", "email", " Work email ")[0], { op: "field.update", type: "client", field: "email", def: { title: "Work email" } });
  assert.deepEqual(retypeFieldOps("client", "phone", "text")[0], { op: "field.retype", type: "client", field: "phone", toType: "text" });
  assert.deepEqual(moveFieldOps("client", ["name", "email", "phone"], "phone", -1)?.[0], { op: "field.reorder", type: "client", order: ["name", "phone", "email"] });
  assert.equal(moveFieldOps("client", ["name", "email"], "name", -1), null);
  assert.equal(moveFieldOps("client", ["name", "email"], "email", 1), null);
});

test("delete field: the diff's row count is said once, then apply confirms exactly the destructive items", async () => {
  const d = door([{ destructive: true, affectedRows: 12, summary: "Drop field Budget" }]);
  const staged = await stageChange(d.call, dropFieldOps("client", "budget"));
  assert.ok(staged.ok);
  if (!staged.ok) return;
  assert.equal(staged.staged.destructive, true);
  assert.equal(staged.staged.rows, 12);
  const line = confirmLine("field.drop", "Budget", staged.staged.rows);
  assert.ok(has(line, "12 values") && has(line, "Trash") && has(line, "30 days"), line);
  assert.deepEqual(d.calls.map((c) => c.cap), ["schema.diff"], "nothing is applied before the yes");
  await commitChange(d.call, staged.staged);
  assert.deepEqual(d.calls.map((c) => c.cap), ["schema.diff", "schema.apply"]);
  assert.deepEqual((d.calls[1]!.input as { confirm: string[] }).confirm, ["k0"]);
  assert.deepEqual((d.calls[1]!.input as { ops: SchemaOp[] }).ops, dropFieldOps("client", "budget"));
  assert.ok(has(confirmLine("field.drop", "Budget", 1), "1 value go") || has(confirmLine("field.drop", "Budget", 1), "1 value "), "singular reads right");
  assert.ok(has(confirmLine("type.drop", "Client", 19), "19 records go to Trash"));
  assert.ok(has(confirmLine("type.drop", "Client", 1), "1 record goes to Trash"));
});

test("delete type: type.drop is previewed and confirmed with the record count", async () => {
  const d = door([{ destructive: true, affectedRows: 19 }]);
  const out = await stageChange(d.call, dropTypeOps("client"));
  assert.ok(out.ok);
  if (out.ok) assert.equal(out.staged.rows, 19);
});

test("a system type cannot be deleted: the menu item is off and says why; a custom type can", () => {
  assert.equal(typeDeleteBlocked({ system: true }), "Built in record types cannot be deleted");
  assert.ok(typeDeleteBlocked({ system: false, syncedFrom: "hubspot" }));
  assert.equal(typeDeleteBlocked({ system: false }), null);
  let renamed = 0, removed = 0;
  const sys = typeRowMenu({ system: true }, { rename: () => renamed++, fields: () => undefined, remove: () => removed++ });
  const del = sys.find((e) => "label" in e && e.label === "Delete record type");
  assert.ok(del && "disabled" in del && del.disabled === true);
  assert.equal(del && "reason" in del ? del.reason : "", "Built in record types cannot be deleted");
  assert.equal(del && "onSelect" in del ? del.onSelect : undefined, undefined, "an off item has nothing to run");
  const own = typeRowMenu({ system: false }, { rename: () => renamed++, fields: () => undefined, remove: () => removed++ });
  const del2 = own.find((e) => "label" in e && e.label === "Delete record type");
  assert.ok(del2 && "onSelect" in del2 && del2.onSelect);
  if (del2 && "onSelect" in del2) del2.onSelect?.();
  const ren = own[0];
  if (ren && "onSelect" in ren) ren.onSelect?.();
  assert.equal(removed, 1);
  assert.equal(renamed, 1);
});

test("change type is off, with a reason, for built in, title, computed fields, and for types the backend refuses", () => {
  const custom = { system: false };
  assert.equal(retypeBlocked(custom, { type: "text" }, "name", "notes"), null);
  assert.ok(retypeBlocked({ system: true }, { type: "text" }, "name", "notes"));
  assert.ok(retypeBlocked(custom, { type: "text" }, "name", "name"));
  assert.ok(retypeBlocked(custom, { type: "formula" }, "name", "total"));
  assert.ok(retypeBlocked(custom, { type: "relation" }, "name", "project"));
  assert.equal(retypeTarget("text", "number"), null);
  assert.ok(retypeTarget("text", "text"));
  assert.ok(retypeTarget("text", "relation"));
  assert.ok(retypeTarget("text", "ai"));
});

const fieldTypes: FieldTypeInfo[] = ["text", "number", "relation", "formula", "email", "status"].map((key) => ({ key, title: key[0]!.toUpperCase() + key.slice(1), filterOps: [], sortable: true, groupable: false, sealed: false }));

test("only simple field types can start a new field", () => {
  assert.deepEqual(addableTypes(fieldTypes).map((t) => t.key), ["text", "number", "email", "status"]);
});

test("a column header offers Rename, Change type and Delete only with permission; a built in field shows them off", () => {
  const custom = { system: false, titleField: "name" };
  assert.deepEqual(fieldMenuEntries(false, custom, { key: "notes", type: "text" }, () => undefined), []);
  const opened: string[] = [];
  const on = fieldMenuEntries(true, custom, { key: "notes", type: "text" }, (m) => opened.push(m));
  const labels = on.flatMap((e) => ("label" in e ? [e.label] : []));
  assert.deepEqual(labels, ["Rename field", "Change type", "Delete field"]);
  for (const e of on) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(opened, ["rename", "type", "delete"]);
  const title = fieldMenuEntries(true, custom, { key: "name", type: "text" }, () => undefined).find((e) => "label" in e && e.label === "Delete field");
  assert.ok(title && "disabled" in title && title.disabled === true && "reason" in title && title.reason);
  const sys = fieldMenuEntries(true, { system: true, titleField: "name" }, { key: "notes", type: "text" }, () => undefined).find((e) => "label" in e && e.label === "Change type");
  assert.ok(sys && "disabled" in sys && sys.disabled === true);
});

// ---------------------------------------------------------------- screens

const withTypes = (s: SampleSchema, canEdit: boolean | undefined, el: ReactElement): string => {
  const data: SchemaData = { ...s.data, ...(canEdit !== undefined ? { canEdit } : {}) };
  return clean(renderToStaticMarkup(<SchemaDataProvider value={data}>{el}</SchemaDataProvider>));
};

test("Record types: with permission, New record type and a more button per row; no line about the console", () => {
  const s = createSampleSchema(northwind);
  const out = withTypes(s, true, <RecordTypesList />);
  assert.ok(has(out, 'data-testid="record-types-new"') && has(out, "New record type"));
  assert.ok(has(out, 'data-testid="type-more-clients"'));
  assert.ok(!has(out, "managed in the console") && !has(out, 'data-testid="record-types-console"'));
});

test("Record types: without permission the editing controls are not drawn, and rows still open the type", () => {
  const s = createSampleSchema(northwind);
  for (const can of [false, undefined]) {
    const out = withTypes(s, can, <RecordTypesList />);
    assert.ok(!has(out, 'data-testid="record-types-new"'));
    assert.ok(!has(out, 'data-testid="type-more-'));
    assert.ok(has(out, 'data-testid="row-type:clients"'));
    assert.ok(!has(out, "managed in the console"));
  }
});

const side = (canEdit: boolean | undefined): string => {
  const s = createSampleRecords(tableSpace);
  const data = { ...s.data, ...(canEdit !== undefined ? { canEditSchema: canEdit } : {}) };
  return clean(renderToStaticMarkup(<RecordsDataProvider value={data}><RecordsStateProvider><RecordsSidebar /></RecordsStateProvider></RecordsDataProvider>));
};

test("sidebar: a plus by the type list and New record type under Manage, only with permission", () => {
  const on = side(true);
  assert.ok(has(on, 'data-testid="sidebar-new-type"'));
  assert.ok(has(on, 'data-testid="row-nav:manage:new"') && has(on, "New record type"));
  for (const can of [false, undefined]) {
    const off = side(can);
    assert.ok(!has(off, 'data-testid="sidebar-new-type"'));
    assert.ok(!has(off, "New record type"));
    assert.ok(has(off, 'data-testid="row-nav:manage:types"'), "Record types stays");
  }
});

test("the New record type sheet asks for a name, a plural and an icon, never a key", () => {
  const out = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} onClose={() => undefined} onDone={() => undefined} />));
  assert.ok(has(out, "New record type") && has(out, 'data-testid="type-sheet-name"') && has(out, 'data-testid="type-sheet-plural"') && has(out, 'data-testid="type-icon-folder"'));
  assert.ok(has(out, 'data-testid="type-sheet-save"') && has(out, "Create"));
  assert.ok(!/(aria-label|placeholder)="[^"]*key/i.test(out) && !/>\s*Key\s*</.test(out), "no key field");
  const rename = clean(renderToStaticMarkup(<TypeSheet call={async () => ({})} takenKeys={[]} rename={{ key: "client", title: "Client", plural: "Clients", icon: "table" }} onClose={() => undefined} onDone={() => undefined} />));
  assert.ok(has(rename, "Rename record type") && has(rename, 'value="Client"') && !has(rename, 'data-testid="type-icon-folder"'));
});

const person: PanelType = {
  key: "client", title: "Client", system: false, titleField: "name",
  fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "email", title: "Email" }, { key: "budget", type: "money", title: "Budget" }],
};

test("Fields panel: every field with show or hide, Add field, and a field's actions when opened", () => {
  const out = clean(renderToStaticMarkup(<FieldsPanel call={async () => ({})} type={person} hidden={["budget"]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={fieldTypes} trash={[]} initial={{ field: "email", mode: "rename" }} />));
  for (const k of ["name", "email", "budget"]) assert.ok(has(out, `data-testid="panel-show-${k}"`), k);
  assert.ok(has(out, 'data-testid="panel-add"'));
  assert.ok(has(out, 'data-testid="panel-rename-input-email"') && has(out, 'data-testid="panel-rename-save"'));
  const plain = clean(renderToStaticMarkup(<FieldsPanel call={async () => ({})} type={person} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={fieldTypes} trash={[]} initial={{ field: "budget", mode: "type" }} />));
  assert.ok(has(plain, 'data-testid="panel-to-text"') && has(plain, 'data-testid="panel-to-number"'));
  const menuOpen = clean(renderToStaticMarkup(<FieldsPanel call={async () => ({})} type={{ ...person, system: true }} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={fieldTypes} trash={[]} initial={{ field: "email", mode: "rename" }} />));
  assert.ok(has(menuOpen, 'data-testid="panel-rename-input-email"'));
});

test("Fields panel lists deleted fields of this type with Restore", () => {
  const out = clean(renderToStaticMarkup(<FieldsPanel call={async () => ({})} type={person} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={fieldTypes}
    trash={[{ type: "client", field: "notes", droppedAt: 1, expiresAt: 2_000_000_000_000, rows: 4 }, { type: "project", field: "other", droppedAt: 1, expiresAt: 2_000_000_000_000, rows: 1 }]} />));
  assert.ok(has(out, 'data-testid="panel-restore-notes"') && !has(out, 'data-testid="panel-restore-other"'));
});

const ty = (key: string, o: Partial<TypeRow> = {}): TypeRow => ({ key, title: key, plural: `${key}s`, icon: "table", label: "internal", system: false, rowCount: 0, fieldCount: 3, ...o }) as TypeRow;

test("internal types are hidden until they hold a record; Issues and Pull requests show once GitHub is connected", () => {
  assert.equal(worthShowing(ty("envelope")), false);
  assert.equal(worthShowing(ty("report", { system: true })), false);
  assert.equal(worthShowing(ty("envelope", { rowCount: 2 })), true);
  assert.equal(worthShowing(ty("issue")), false);
  assert.equal(worthShowing(ty("issue", { syncedFrom: "github" })), true);
  assert.equal(worthShowing(ty("pull_request", { rowCount: 1 })), true);
  assert.equal(worthShowing(ty("agent")), false, "Agents wait for a record");
  assert.equal(worthShowing(ty("agent", { rowCount: 1 })), true);
  for (const k of ["company", "meeting", "note_board", "project", "task"]) { assert.equal(worthShowing(ty(k)), false, `${k} waits for a record`); assert.equal(worthShowing(ty(k, { rowCount: 1 })), true, `${k} shows with a record`); }
  assert.equal(worthShowing(ty("contact")), true);
  const keys = (t: TypeRow[]): string[] => typeSections(t).flatMap((g) => g.items.map((i) => i.key));
  const all = [ty("contact"), ty("envelope"), ty("report"), ty("issue"), ty("agent", { system: true, rowCount: 1 })];
  assert.deepEqual(keys(all).sort(), ["agent", "contact"]);
  const flat = typeGroups(all).flatMap((g) => g.items.map((i) => i.key));
  assert.deepEqual(flat, ["contact"], "the sidebar hides the same ones (Agents is a Manage row)");
});

test("the page groups types: People, Work, Journeys, Sites, Connected, Built in, in that order, empty groups left out", () => {
  const types = [
    ty("task", { system: true, rowCount: 1 }), ty("matter"), ty("contact", { system: true }), ty("onboarding", { group: "Journeys" }), ty("issue", { syncedFrom: "github", rowCount: 4 }),
    ty("page", { group: "Sites", scope: "site:northwind" }), ty("deal", { syncedFrom: "hubspot" }),
  ];
  const sections = typeSections(types);
  assert.deepEqual(sections.map((g) => g.key), ["People", "Work", "Journeys", "Sites", "Connected", "Built in"]);
  assert.deepEqual(sections.find((g) => g.key === "People")!.items.map((i) => i.key), ["contact"]);
  assert.deepEqual(sections.find((g) => g.key === "Work")!.items.map((i) => i.key), ["matter"]);
  assert.deepEqual(sections.find((g) => g.key === "Built in")!.items.map((i) => i.key), ["task"]);
  assert.equal(sections.find((g) => g.key === "Connected")!.items.length, 2);
  assert.equal(sectionOf(ty("x")), "Work");
  assert.deepEqual(typeSections([ty("matter")]).map((g) => g.key), ["Work"]);
  assert.equal(typeSections([ty("issue", { syncedFrom: "github", rowCount: 1 })])[0]!.label, "Connected (GitHub)");
});

test("the first few field names read as a line, the title field left out", () => {
  const f = [{ key: "name", title: "Name" }, { key: "email", title: "Email" }, { key: "phone", title: "Phone" }, { key: "co", title: "Company" }, { key: "x", title: "More" }];
  assert.equal(fieldLine(f, "name"), "Email, Phone, Company");
  assert.equal(fieldLine([{ key: "name", title: "Name" }], "name"), "");
});

test("the page draws sections, a primary New record type, an Edit fields menu item, and no internal empty types", () => {
  const s = createSampleSchema(northwind, { withSynced: true });
  const out = withTypes(s, true, <RecordTypesList />);
  assert.ok(has(out, 'data-testid="types-section-People"') || has(out, 'data-testid="types-section-Work"') || has(out, 'data-testid="types-section-Built in"'));
  assert.ok(has(out, 'data-testid="types-section-Connected'));
  assert.ok(has(out, 'data-testid="record-types-new"'));
  assert.ok(!has(out, 'data-testid="row-type:envelope"') && !has(out, 'data-testid="row-type:report"'));
  const menu = typeRowMenu({ system: false }, { rename: () => undefined, fields: () => undefined, remove: () => undefined });
  assert.deepEqual(menu.flatMap((e) => ("label" in e ? [e.label] : [])), ["Rename", "Edit fields", "Delete record type"]);
});
