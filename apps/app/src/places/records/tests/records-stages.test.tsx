// Records > stages on any record type: a type turns stages on in the Fields panel (a list of stages, each field shown Always or at one stage, fields to fill to enter or leave a stage); a Projects-style
// record then shows the stage stepper and its stage groups; a stage change that the gates hold opens the fill-and-move sheet, and the one records.update fills the fields and moves the record.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { FieldsPanel } from "../typeedit/index.ts";
import type { PanelType } from "../typeedit/index.ts";
import { addStage, moveStage, removeStage, renameStage, setStagesOps, showAt, stageFieldOf, stageOfField, stagesOf, stagesOffOps, stagesOn, stagesOnOps, toggleGate } from "../typeedit/stages.ts";
import type { StageEntry } from "../typeedit/stages.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, PROJECT, createSamplePage } from "../recordpage/sample.ts";
import type { RecordRow, TypeDef } from "../table/model.ts";

const f = (key: string, type: string, title: string, options?: Record<string, unknown>) => ({ key, type, title, ...(options ? { options } : {}) });
const STAGES: StageEntry[] = [{ key: "lead", title: "Lead" }, { key: "won", title: "Won" }, { key: "paid", title: "Paid" }];
const plainType = (on: boolean, stages: StageEntry[] = STAGES): PanelType => ({
  key: "deal", title: "Deal", system: false, titleField: "name", statusField: "stage",
  fields: [f("name", "text", "Name"), f("stage", "status", "Stage", { stages, ...(on ? { stagesOn: true } : {}) }), f("amount", "number", "Amount"), f("contract", "text", "Contract")] as never,
});

test("stages on and off: an existing status field is kept and flagged; a type without one gets a Stage field; off keeps the field and drops the flag", () => {
  const off = plainType(false);
  assert.equal(stagesOn(off), false);
  const on = stagesOnOps(off)[0] as { op: string; field: string; def: { options: { stagesOn: boolean; stages: unknown[] } } };
  assert.deepEqual([on.op, on.field, on.def.options.stagesOn, on.def.options.stages.length], ["field.update", "stage", true, 3]);
  const bare = stagesOnOps({ key: "note", statusField: undefined, fields: [f("name", "text", "Name")] as never }) as { op: string; field?: string; def: Record<string, unknown> }[];
  assert.deepEqual(bare.map((o) => o.op), ["field.add", "type.update"]);
  assert.equal(bare[0]!.field, "stage");
  assert.deepEqual(bare[1]!.def, { statusField: "stage" });
  const offOps = stagesOffOps(plainType(true, [{ key: "a", title: "A", needToEnter: ["amount"] }]))[0] as { def: { options: Record<string, unknown> } };
  assert.ok(!("stagesOn" in offOps.def.options), "the flag is gone");
  assert.deepEqual(offOps.def.options["stages"], [{ key: "a", title: "A" }], "the gates are dropped, the stages stay");
  assert.equal(stageFieldOf(plainType(true))?.key, "stage");
});

test("the stage list: add, rename, move, remove (never the last), and each field shows Always or at one stage", () => {
  const added = addStage(STAGES, " Closed ");
  assert.deepEqual(added.map((s) => s.key), ["lead", "won", "paid", "closed"]);
  assert.equal(addStage(STAGES, "Lead").at(-1)!.key, "lead_2");
  assert.deepEqual(addStage(STAGES, "  "), STAGES);
  assert.equal(renameStage(STAGES, "won", "Signed")[1]!.title, "Signed");
  assert.deepEqual(moveStage(STAGES, "paid", -1).map((s) => s.key), ["lead", "paid", "won"]);
  assert.deepEqual(moveStage(STAGES, "lead", -1), STAGES);
  assert.deepEqual(removeStage(STAGES, "won").map((s) => s.key), ["lead", "paid"]);
  assert.equal(removeStage([STAGES[0]!], "lead").length, 1);
  const at = showAt(STAGES, "amount", "won");
  assert.deepEqual(stageOfField(at, "amount")?.key, "won");
  const moved = showAt(at, "amount", "paid");
  assert.deepEqual([moved[1]!.fields, moved[2]!.fields], [undefined, ["amount"]], "one stage at most, no empty list kept");
  assert.equal(stageOfField(showAt(moved, "amount", null), "amount"), undefined, "Always");
  const gated = toggleGate(STAGES, "won", "needToEnter", "amount");
  assert.deepEqual(gated[1]!.needToEnter, ["amount"]);
  assert.equal(toggleGate(gated, "won", "needToEnter", "amount")[1]!.needToEnter, undefined);
  assert.deepEqual(setStagesOps("deal", stageFieldOf(plainType(true))!, gated)[0], { op: "field.update", type: "deal", field: "stage", def: { options: { stages: gated, stagesOn: true } } });
  assert.deepEqual(stagesOf(stageFieldOf(plainType(true, gated))).map((s) => s.needToEnter), [undefined, ["amount"], undefined]);
});

// ---------------------------------------------------------------- the panel

type Call = { cap: string; input: Record<string, unknown> };
async function panel(type: PanelType): Promise<{ root: Node; calls: Call[]; stop(): Promise<void> }> {
  const calls: Call[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "schema.trash.list") return { items: [] };
    if (cap === "schema.diff") return { previewToken: "t", items: [], problems: [], destructive: 0, additive: 1 };
    return {};
  };
  const r = createRoot();
  await act(async () => { r.render(<FieldsPanel call={call} type={type} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={[]} trash={[]} layout={[]} viewToggles={false} />); });
  await flush();
  return { root: r.container as unknown as Node, calls, stop: async () => { await act(async () => { r.unmount(); }); } };
}
const lastOps = (calls: Call[]): Record<string, unknown>[] => calls.filter((c) => c.cap === "schema.apply").at(-1)!.input["ops"] as never;

test("the panel turns stages on, and lists and edits the stages once they are on", async () => {
  const restore = installDom();
  const off = await panel(plainType(false));
  try {
    assert.equal(find(off.root, "panel-stage-add"), null, "no editor while off");
    await press(find(off.root, "panel-stages-on"));
    await flush();
    const op = lastOps(off.calls)[0] as { field: string; def: { options: { stagesOn: boolean } } };
    assert.deepEqual([op.field, op.def.options.stagesOn], ["stage", true]);
  } finally { await off.stop(); }
  const on = await panel(plainType(true));
  try {
    assert.match(textOf(find(on.root, "panel-stages")), /Lead[\s\S]*Won[\s\S]*Paid/);
    await press(find(on.root, "panel-stage-add"));
    await typeInto(find(on.root, "panel-stage-name"), "Closed");
    await press(find(on.root, "panel-stage-save"));
    await flush();
    assert.deepEqual(((lastOps(on.calls)[0] as { def: { options: { stages: { key: string }[] } } }).def.options.stages).map((s) => s.key), ["lead", "won", "paid", "closed"]);
    await press(find(on.root, "row-panel-stage-row-won"));
    await press(find(on.root, "panel-gate-needToEnter-won-amount"));
    await flush();
    assert.deepEqual(((lastOps(on.calls)[0] as { def: { options: { stages: StageEntry[] } } }).def.options.stages)[1]!.needToEnter, ["amount"]);
    await press(find(on.root, "panel-stage-up-won"));
    await flush();
    assert.deepEqual(((lastOps(on.calls)[0] as { def: { options: { stages: StageEntry[] } } }).def.options.stages).map((s) => s.key), ["won", "lead", "paid"]);
  } finally { await on.stop(); restore(); }
});

test("a field's Show menu puts it Always or at a stage, and its row says which", async () => {
  const restore = installDom();
  const p = await panel(plainType(true, [{ key: "lead", title: "Lead" }, { key: "won", title: "Won", fields: ["contract"] }]));
  try {
    assert.match(textOf(find(p.root, "panel-field-contract")), /at Won/);
    await press(find(p.root, "row-panel-field-amount"));
    await press(find(p.root, "panel-show-at-amount"));
    await press(find(p.root, "panel-show-stage-lead"));
    await flush();
    const stages = (lastOps(p.calls)[0] as { def: { options: { stages: StageEntry[] } } }).def.options.stages;
    assert.deepEqual([stages[0]!.fields, stages[1]!.fields], [["amount"], ["contract"]]);
    await press(find(p.root, "panel-show-at-amount"));
    await press(find(p.root, "panel-show-always-amount"));
    await flush();
    assert.equal((lastOps(p.calls)[0] as { def: { options: { stages: StageEntry[] } } }).def.options.stages[0]!.fields, undefined);
    assert.equal(find(p.root, "panel-show-at-name"), null, "the title is not offered");
  } finally { await p.stop(); restore(); }
});

test("a Journey's type points to the designer instead of offering the stage editor", async () => {
  const restore = installDom();
  const t = plainType(true);
  (t.fields.find((x) => x.key === "stage") as { writeOnlyBy?: string[] }).writeOnlyBy = ["journeys.move_stage"];
  const p = await panel(t);
  try {
    assert.ok(find(p.root, "panel-stages-journey"));
    assert.equal(find(p.root, "panel-stages-on"), null);
    await press(find(p.root, "row-panel-field-amount"));
    assert.equal(find(p.root, "panel-show-at-amount"), null, "no Show: the designer owns stage fields");
  } finally { await p.stop(); restore(); }
});

// ---------------------------------------------------------------- the page

const DEAL: TypeDef = {
  ...PROJECT, key: "deals", title: "Deal", plural: "Deals", statusField: "status",
  fields: [
    { key: "name", type: "text", title: "Name", required: true }, { key: "status", type: "status", title: "Status", options: { stagesOn: true, stages: [
      { key: "lead", title: "Lead", fields: ["source"] }, { key: "won", title: "Won", fields: ["contract"], needToEnter: ["amount"] }, { key: "paid", title: "Paid", fields: ["receipt"] }] } },
    { key: "amount", type: "text", title: "Amount" }, { key: "source", type: "text", title: "Source" }, { key: "contract", type: "text", title: "Contract" }, { key: "receipt", type: "text", title: "Receipt" },
    { key: "region", type: "text", title: "Region" },
  ] as never,
};
const drow = (stage: string, over: Record<string, unknown> = {}): RecordRow => ({ id: "dl_1", type: "deals", version: 1, label: 1, createdAt: 0, updatedAt: 0, holds: 0, fields: { name: "Deal 1", status: stage, source: "Referral", region: "West", ...over } });

test("a staged type that is not a Journey shows the stepper, Always fields, and its stage groups with the later ones locked", async () => {
  const restore = installDom();
  const s = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, DEAL] });
  s.replica.put("records:deals", [drow("lead") as never]);
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={s.data}><RecordPage type="deals" recordId="dl_1" start={{ all: true }} /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    assert.ok(find(root, "journey-stepper"), "the stage stepper");
    assert.match(textOf(find(root, "journey-stepper")), /Lead.*Won.*Paid/);
    assert.match(textOf(find(root, "section-stage-lead")), /This stage[\s\S]*Source/);
    assert.match(textOf(find(root, "opens-stage-won")), /Opens at Won/);
    assert.match(textOf(find(root, "opens-stage-paid")), /Opens at Paid/);
    assert.match(textOf(find(root, "record-sheet")), /Region/, "a field with no stage shows the whole time");
    assert.ok(!/Receipt/.test(textOf(find(root, "section-stage-paid"))), "a locked group hides its fields");
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

test("a type without stages has no stepper; a status field with no flag is just a field", async () => {
  const restore = installDom();
  const off = { ...DEAL, fields: DEAL.fields.map((x) => (x.key === "status" ? { ...x, options: { stages: (x.options as { stages: unknown[] }).stages } } : x)) } as TypeDef;
  const s = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, off] });
  s.replica.put("records:deals", [drow("lead") as never]);
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={s.data}><RecordPage type="deals" recordId="dl_1" /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    assert.equal(find(root, "journey-stepper"), null);
    assert.equal(find(root, "section-stage-lead"), null);
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

test("moving a record the gates hold opens the sheet; Save and move is one records.update that fills the field and changes the stage", async () => {
  const restore = installDom();
  const s = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, DEAL] });
  s.replica.put("records:deals", [drow("lead") as never]);
  const updates: Record<string, unknown>[] = [];
  const data = {
    ...s.data,
    async call(cap: string, input: unknown) {
      if (cap === "records.update") {
        const i = input as { patch: Record<string, unknown>; baseVersion: number };
        updates.push(i.patch);
        const row = (s.replica.rows("records:deals") as unknown as RecordRow[])[0]!;
        const merged = { ...row.fields, ...i.patch };
        if (i.patch["status"] === "won" && !merged["amount"]) {
          throw Object.assign(new Error("Fill these first: Amount."), { details: { reason: "fields_required", fields: [{ key: "amount", title: "Amount", stage: "won", when: "enter" }], toStage: "won" } });
        }
      }
      return s.data.call(cap, input);
    },
  };
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={data}><RecordPage type="deals" recordId="dl_1" /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    await press(find(root, "step-won"));
    await flush();
    assert.ok(find(root, "gate-sheet") && find(root, "gate-field-amount"), "the sheet asks for Amount");
    assert.deepEqual(updates, [{ status: "won" }]);
    await typeInto(find(root, "gate-input-amount"), "5000");
    await press(find(root, "gate-save"));
    await flush(); await flush();
    assert.deepEqual(updates.at(-1), { amount: "5000", status: "won" });
    assert.equal(updates.length, 2, "one more update, not two");
    assert.equal(find(root, "gate-sheet"), null);
    assert.equal((s.replica.rows("records:deals") as unknown as RecordRow[])[0]!.fields["status"], "won");
  } finally { await act(async () => { r.unmount(); }); restore(); }
});
