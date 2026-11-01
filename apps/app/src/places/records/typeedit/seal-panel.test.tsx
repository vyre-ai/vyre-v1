// The Fields panel's sealing: Seal this field on a text field (one confirm, one way, then the schema change), and the sensitive data check with a Seal and a Mark button per suggestion.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { FieldsPanel } from "./index.ts";
import type { PanelType } from "./index.ts";

const type: PanelType = { key: "client", title: "Client", plural: "Clients", system: false, titleField: "name", fields: [
  { key: "name", type: "text", title: "Name", required: true }, { key: "taxid", type: "text", title: "Tax ID" }, { key: "budget", type: "money", title: "Budget" }, { key: "vault", type: "sealed", title: "Vault note" },
] as never };

function rig(): { calls: { cap: string; input: Record<string, unknown> }[]; el: ReactElement } {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "schema.diff") return { previewToken: "tok", additive: 0, destructive: 1, problems: [], items: [{ itemKey: "field.retype:client:taxid", op: "field.retype", type: "client", summary: "Seal", destructive: true, affectedRows: 50, copiedToTrash: false }] };
    if (cap === "schema.apply") return { changeId: "chg", applied: 1, items: [] };
    if (cap === "schema.sensitivity.scan") return { suggestions: [{ field: "taxid", kind: "id_number", matches: 50, suggestedLabel: "restricted", seal: true }, { field: "budget", kind: "health", matches: 0, suggestedLabel: "confidential", seal: false }] };
    if (cap === "schema.trash.list") return { items: [] };
    return {};
  };
  return { calls, el: <FieldsPanel call={call} type={type} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={[]} trash={[]} layout={[]} linkTypes={[]} viewToggles={false} /> };
}
async function open(el: ReactElement): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => { r.render(el); });
  await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("Seal this field: only on a text-like field, one confirm that says it is one way, then the retype is applied on that preview", async () => {
  const restore = installDom();
  const { calls, el } = rig();
  const o = await open(el);
  try {
    await press(find(o.root, "row-panel-field-budget"));
    assert.equal(find(o.root, "panel-seal-budget"), null, "a money field has no Seal");
    await press(find(o.root, "row-panel-field-vault"));
    assert.equal(find(o.root, "panel-seal-vault"), null, "a sealed field has no Seal");
    assert.equal((find(o.root, "panel-retype-vault")!.props as { disabled?: boolean }).disabled, true, "a sealed field cannot change type");
    await press(find(o.root, "row-panel-field-taxid"));
    await press(find(o.root, "panel-seal-taxid"));
    await flush();
    const said = textOf(find(o.root, "schema-confirm"));
    assert.match(said, /Seal Tax ID\? 50 values move into the Vault\. This cannot be undone/);
    assert.equal(calls.filter((c) => c.cap === "schema.apply").length, 0, "nothing is applied before the yes");
    await press(find(o.root, "schema-confirm-yes"));
    await flush();
    const applied = calls.find((c) => c.cap === "schema.apply")!;
    assert.deepEqual(applied.input["ops"], [{ op: "field.retype", type: "client", field: "taxid", toType: "sealed" }]);
    assert.equal(applied.input["previewToken"], "tok");
    assert.deepEqual(applied.input["confirm"], ["field.retype:client:taxid"]);
  } finally { await o.stop(); restore(); }
});

test("the sensitive data check: Seal and Mark per suggestion, and a health suggestion can only be marked", async () => {
  const restore = installDom();
  const { calls, el } = rig();
  const o = await open(el);
  try {
    await press(find(o.root, "panel-scan"));
    await flush();
    assert.match(textOf(find(o.root, "row-panel-scan-taxid")), /Looks like an ID number · 50 values/);
    assert.ok(find(o.root, "panel-scan-seal-taxid"), "an ID number can be sealed");
    assert.equal(find(o.root, "panel-scan-seal-budget"), null, "health information is marked, not sealed");
    await press(find(o.root, "panel-scan-mark-budget"));
    await flush();
    assert.deepEqual(calls.find((c) => c.cap === "schema.set_label")!.input, { type: "client", field: "budget", label: "confidential" });
    await press(find(o.root, "panel-scan-seal-taxid"));
    await flush();
    assert.match(textOf(find(o.root, "schema-confirm")), /cannot be undone/);
    await press(find(o.root, "schema-confirm-yes"));
    await flush();
    assert.deepEqual(calls.find((c) => c.cap === "schema.apply")!.input["ops"], [{ op: "field.retype", type: "client", field: "taxid", toType: "sealed" }]);
  } finally { await o.stop(); restore(); }
});
