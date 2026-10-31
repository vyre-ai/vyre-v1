// Records > field groups in the Fields panel: a group is a section of the record page layout. New group, rename and delete (its fields go back to the Overview), and a field moves into a group
// from its own menu. Every change is one schema.layout.set of the whole layout.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { FieldsPanel } from "./index.ts";
import type { PanelType } from "./index.ts";
import { OVERVIEW, addGroup, deleteGroup, groupOf, groupsIn, moveField, normalize, renameGroup } from "./groups.ts";

const FIELDS = ["name", "company", "email", "phone", "value", "due"] as const;
const keys: readonly string[] = FIELDS;
const type: PanelType = {
  key: "clients", title: "Client", system: false, titleField: "name",
  fields: FIELDS.map((k) => ({ key: k, title: k[0]!.toUpperCase() + k.slice(1), type: "text" })) as never,
};
const titles = (s: { key: string; title: string }[]): string[] => s.map((x) => `${x.key}:${x.title}`);

test("the first group turns the lone Details section into the Overview; the Overview always leads and holds what no group does", () => {
  const first = addGroup([{ key: "details", title: "Details", fields: [...FIELDS] }], keys, "Billing");
  assert.equal(first.key, "billing");
  assert.deepEqual(titles(first.sections), ["overview:Overview", "billing:Billing"]);
  assert.deepEqual(first.sections[0]!.fields, [...FIELDS]);
  assert.deepEqual(first.sections[1]!.fields, []);
  assert.deepEqual(normalize([], keys)[0]!.fields, [...FIELDS], "no layout at all: everything is ungrouped");
  const again = addGroup(first.sections, keys, "Billing");
  assert.equal(again.key, "billing_2", "a taken key gets the next free one");
  assert.deepEqual(groupsIn(again.sections, keys).map((g) => g.key), ["billing", "billing_2"]);
});

test("a field moves into a group and back; it is in one place at a time", () => {
  const base = addGroup([], keys, "Billing").sections;
  const moved = moveField(base, keys, "value", "billing");
  assert.deepEqual(moved.find((s) => s.key === "billing")!.fields, ["value"]);
  assert.ok(!moved.find((s) => s.key === OVERVIEW)!.fields.includes("value"));
  assert.equal(groupOf(moved, keys, "value")?.key, "billing");
  assert.equal(groupOf(moved, keys, "email"), null);
  const other = addGroup(moved, keys, "Documents").sections;
  const again = moveField(other, keys, "value", "documents");
  assert.deepEqual([again.find((s) => s.key === "billing")!.fields, again.find((s) => s.key === "documents")!.fields], [[], ["value"]]);
  const back = moveField(again, keys, "value", null);
  assert.ok(back.find((s) => s.key === OVERVIEW)!.fields.includes("value") && back.every((s) => s.key === OVERVIEW || !s.fields.includes("value")));
  assert.deepEqual(moveField(base, keys, "value", "nope"), base, "an unknown group changes nothing");
});

test("rename keeps the key and the fields; delete sends the fields back to the Overview", () => {
  const made = moveField(addGroup([], keys, "Billing").sections, keys, "value", "billing");
  const renamed = renameGroup(made, keys, "billing", "  Money ");
  assert.deepEqual(titles(renamed), ["overview:Overview", "billing:Money"]);
  assert.deepEqual(renamed[1]!.fields, ["value"]);
  assert.equal(renameGroup(made, keys, OVERVIEW, "Home")[0]!.title, "Overview", "the Overview keeps its name");
  const gone = deleteGroup(renamed, keys, "billing");
  assert.deepEqual(titles(gone), ["overview:Overview"]);
  assert.ok(gone[0]!.fields.includes("value") && gone[0]!.fields.length === FIELDS.length, "no field is lost");
  assert.equal(deleteGroup(made, keys, OVERVIEW).length, made.length, "the Overview cannot be deleted");
});

test("a dropped field no longer sits in a group", () => {
  const made = moveField(addGroup([], keys, "Billing").sections, keys, "value", "billing");
  const left = normalize(made, keys.filter((k) => k !== "value"));
  assert.ok(left.every((s) => !s.fields.includes("value")));
});

function rig(layout: { key: string; title: string; fields: string[] }[], fail?: string): { calls: { cap: string; input: Record<string, unknown> }[]; el: ReturnType<typeof FieldsPanel> } {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (fail && cap === "schema.layout.set") throw new Error(fail);
    return {};
  };
  return { calls, el: <FieldsPanel call={call} type={type} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={[]} trash={[]} layout={layout} viewToggles={false} /> };
}
async function open(el: React.ReactElement): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => { r.render(el); });
  await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}
const last = (calls: { cap: string; input: Record<string, unknown> }[]): { key: string; title: string; fields: string[] }[] =>
  (calls.filter((c) => c.cap === "schema.layout.set").at(-1)!.input["sections"]) as never;

test("New group in the panel saves the layout with an Overview and the new group", async () => {
  const restore = installDom();
  const { calls, el } = rig([{ key: "details", title: "Details", fields: [...FIELDS] }]);
  const o = await open(el);
  try {
    await press(find(o.root, "panel-group-new"));
    await typeInto(find(o.root, "panel-group-name"), "Billing");
    await press(find(o.root, "panel-group-save"));
    await flush();
    assert.deepEqual(titles(last(calls)), ["overview:Overview", "billing:Billing"]);
    assert.equal(calls.find((c) => c.cap === "schema.layout.set")!.input["type"], "clients");
    assert.match(textOf(find(o.root, "panel-groups")), /Billing\s*0 fields/);
  } finally { await o.stop(); restore(); }
});

test("a field's Move to group puts it in the group, its row says so, and Ungrouped puts it back", async () => {
  const restore = installDom();
  const { calls, el } = rig([{ key: "overview", title: "Overview", fields: ["name", "company", "email", "phone", "due"] }, { key: "billing", title: "Billing", fields: ["value"] }]);
  const o = await open(el);
  try {
    assert.match(textOf(find(o.root, "panel-field-value")), /Billing/, "the row names its group");
    await press(find(o.root, "row-panel-field-email"));
    await press(find(o.root, "panel-group-move-email"));
    await press(find(o.root, "panel-to-group-billing"));
    await flush();
    assert.deepEqual(last(calls).find((s) => s.key === "billing")!.fields, ["value", "email"]);
    assert.match(textOf(find(o.root, "panel-field-email")), /Billing/);
    await press(find(o.root, "panel-group-move-email"));
    await press(find(o.root, `panel-to-group-${OVERVIEW}`));
    await flush();
    assert.deepEqual(last(calls).find((s) => s.key === "billing")!.fields, ["value"]);
    assert.ok(last(calls)[0]!.fields.includes("email"));
  } finally { await o.stop(); restore(); }
});

test("rename and delete a group in the panel; deleting keeps its fields", async () => {
  const restore = installDom();
  const { calls, el } = rig([{ key: "overview", title: "Overview", fields: ["name", "company"] }, { key: "billing", title: "Billing", fields: ["value", "due"] }]);
  const o = await open(el);
  try {
    await press(find(o.root, "panel-group-rename-billing"));
    await typeInto(find(o.root, "panel-group-input-billing"), "Money");
    await press(find(o.root, "panel-group-rename-save-billing"));
    await flush();
    assert.deepEqual(titles(last(calls)), ["overview:Overview", "billing:Money"]);
    await press(find(o.root, "panel-group-delete-billing"));
    await flush();
    assert.deepEqual(titles(last(calls)), ["overview:Overview"]);
    assert.equal(last(calls)[0]!.fields.length, FIELDS.length, "the fields came back");
    assert.equal(find(o.root, "panel-group-billing"), null);
  } finally { await o.stop(); restore(); }
});

test("a refused layout save says why and changes nothing on screen", async () => {
  const restore = installDom();
  const { el } = rig([{ key: "details", title: "Details", fields: [...FIELDS] }], "denied: schema.manage required");
  const o = await open(el);
  try {
    await press(find(o.root, "panel-group-new"));
    await typeInto(find(o.root, "panel-group-name"), "Billing");
    await press(find(o.root, "panel-group-save"));
    await flush();
    assert.match(textOf(find(o.root, "panel-group-error")), /denied/);
    assert.equal(find(o.root, "panel-group-billing"), null);
  } finally { await o.stop(); restore(); }
});

test("with no group yet, Move to group says to make one first", async () => {
  const restore = installDom();
  const { el } = rig([]);
  const o = await open(el);
  try {
    await press(find(o.root, "row-panel-field-email"));
    await press(find(o.root, "panel-group-move-email"));
    assert.ok(find(o.root, "panel-group-none"));
  } finally { await o.stop(); restore(); }
});
