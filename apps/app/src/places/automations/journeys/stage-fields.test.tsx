// Journey designer > a stage's fields and gates: "Fields for this stage", "Must be filled to move here", "Must be filled to move on". Each picks from the Journey's record type or makes a field on the
// spot; every change is journeys.design with the whole stage list, and a field sits in one stage's group at most.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { ConfigExtrasProvider } from "../config/data.tsx";
import { createConfigSample, northwind } from "../config/sample.ts";
import type { ConfigSample } from "../config/sample.ts";
import { JourneyPane } from "./JourneyPane.tsx";
import { addToList, fieldKeyFor, listOf, pickableFields, removeFromList } from "./model.ts";
import type { Journey, Stage } from "./model.ts";

const FIELDS = [{ key: "name", title: "Name", type: "text" }, { key: "stage", title: "Stage", type: "status" }, { key: "subject", title: "Subject", type: "relation" },
  { key: "invoice", title: "Invoice number", type: "text" }, { key: "amount", title: "Amount", type: "money" }];
const st = (key: string, extra: Record<string, unknown> = {}): Stage => ({ key, title: key, order: 0, exit: { requireTasks: false }, tasks: [], automations: [], ...extra }) as Stage;

test("a field joins a list once, a stage group holds it in one stage only, and an empty list leaves no key behind", () => {
  const a = [st("one"), st("two")];
  const one = addToList(a, "one", "fields", "invoice");
  assert.deepEqual(listOf(one[0]!, "fields"), ["invoice"]);
  assert.deepEqual(addToList(one, "one", "fields", "invoice"), one, "adding again changes nothing");
  const moved = addToList(one, "two", "fields", "invoice");
  assert.deepEqual([listOf(moved[0]!, "fields"), listOf(moved[1]!, "fields")], [[], ["invoice"]], "the group moves to the other stage");
  assert.ok(!("fields" in moved[0]!), "no empty list is kept");
  const gate = addToList(moved, "one", "needToEnter", "invoice");
  assert.deepEqual([listOf(gate[0]!, "needToEnter"), listOf(gate[1]!, "fields")], [["invoice"], ["invoice"]], "a gate can name a field another stage holds");
  assert.deepEqual(removeFromList(gate, "one", "needToEnter", "invoice").map((s) => listOf(s, "needToEnter")), [[], []]);
  assert.deepEqual(pickableFields(FIELDS).map((f) => f.key), ["invoice", "amount"], "the Journey's own base fields are not offered");
  assert.equal(fieldKeyFor("Invoice number", ["invoice_number"]), "invoice_number_2");
  assert.equal(fieldKeyFor("2024 total", []), "f_2024_total");
  assert.equal(fieldKeyFor("???", []), "");
});

type Rig = { s: ConfigSample; calls: { cap: string; input: Record<string, unknown> }[]; root: Node; stop(): Promise<void> };
async function open(stage: string, canDesign = true): Promise<Rig> {
  const s = createConfigSample(northwind);
  const calls: Rig["calls"] = [];
  let fields = [...FIELDS];
  const data = {
    ...s.data,
    async call(cap: string, input: unknown) {
      const i = input as Record<string, unknown>;
      if (cap === "schema.describe") return { types: [{ key: i["type"], fields }] };
      if (cap === "schema.diff") { calls.push({ cap, input: i }); return { previewToken: "tok", items: [], problems: [], destructive: 0, additive: 1 }; }
      if (cap === "schema.apply") {
        calls.push({ cap, input: i });
        for (const op of i["ops"] as { field: string; def: { title: string; type: string } }[]) fields = [...fields, { key: op.field, title: op.def.title, type: op.def.type }];
        return { changeId: "c", applied: 1, items: [] };
      }
      if (cap === "journeys.design") calls.push({ cap, input: i });
      return s.data.call(cap, input);
    },
  };
  const r = createRoot();
  await act(async () => { r.render(<AutomationsDataProvider value={data}><ConfigExtrasProvider value={s.extras}><JourneyPane journeyId="jrn_onboard" selection={{ stage }} canDesign={canDesign} /></ConfigExtrasProvider></AutomationsDataProvider>); });
  await flush(); await flush();
  return { s, calls, root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}
const stageOf = (s: ConfigSample, key: string): Record<string, unknown> => (s.replica.rows("journeys_full").find((r) => r.id === "jrn_onboard") as unknown as Journey).stages.find((x) => x.key === key) as unknown as Record<string, unknown>;

test("the stage pane has the three lists, each empty until a field is added", async () => {
  const restore = installDom();
  const o = await open("intake");
  try {
    for (const l of ["fields", "needToEnter", "needToLeave"]) assert.ok(find(o.root, `stage-list-${l}`) && find(o.root, `add-${l}`), l);
    assert.match(textOf(find(o.root, "stage-fields")), /Fields for this stage[\s\S]*Must be filled to move here[\s\S]*Must be filled to move on/);
    assert.match(textOf(find(o.root, "stage-list-needToLeave")), /Nothing is required to leave/);
  } finally { await o.stop(); restore(); }
});

test("picking an existing field adds it to the stage's group; Remove takes it out; both are journeys.design", async () => {
  const restore = installDom();
  const o = await open("intake");
  try {
    await press(find(o.root, "add-fields"));
    await press(find(o.root, "menu-item-Invoice number"));
    await flush(); await flush();
    const design = o.calls.filter((c) => c.cap === "journeys.design");
    assert.equal(design.length, 1);
    const sent = (design[0]!.input["stages"] as Record<string, unknown>[]).find((x) => x["key"] === "intake")!;
    assert.deepEqual(sent["fields"], ["invoice"]);
    assert.deepEqual(stageOf(o.s, "intake")["fields"], ["invoice"]);
    assert.match(textOf(find(o.root, "stage-list-fields")), /Invoice number/);
    await press(find(o.root, "remove-fields-invoice"));
    await flush(); await flush();
    assert.ok(!("fields" in stageOf(o.s, "intake")), "removed");
  } finally { await o.stop(); restore(); }
});

test("the gates: a field to be filled to move here, and one to move on", async () => {
  const restore = installDom();
  const o = await open("intake");
  try {
    await press(find(o.root, "add-needToEnter"));
    await press(find(o.root, "menu-item-Amount"));
    await flush(); await flush();
    assert.deepEqual(stageOf(o.s, "intake")["needToEnter"], ["amount"]);
    await press(find(o.root, "add-needToLeave"));
    await press(find(o.root, "menu-item-Invoice number"));
    await flush(); await flush();
    assert.deepEqual(stageOf(o.s, "intake")["needToLeave"], ["invoice"]);
    assert.match(textOf(find(o.root, "stage-list-needToEnter")), /Amount/);
    assert.match(textOf(find(o.root, "stage-list-needToLeave")), /Invoice number/);
  } finally { await o.stop(); restore(); }
});

test("New field makes the field on the record type (diff, then apply) and adds it to the stage", async () => {
  const restore = installDom();
  const o = await open("intake");
  try {
    await press(find(o.root, "add-fields"));
    await press(find(o.root, "menu-item-New field"));
    await typeInto(find(o.root, "stage-field-name"), "Passport number");
    await press(find(o.root, "stage-field-type-text"));
    await press(find(o.root, "stage-field-save"));
    await flush(); await flush(); await flush();
    assert.deepEqual(o.calls.map((c) => c.cap).filter((c) => c !== "journeys.design").slice(0, 2), ["schema.diff", "schema.apply"]);
    const s0 = o.s.replica.rows("journeys_full").find((r) => r.id === "jrn_onboard") as unknown as Journey;
    const op = (o.calls.find((c) => c.cap === "schema.diff")!.input["ops"] as Record<string, unknown>[])[0]!;
    assert.deepEqual([op["op"], op["type"], op["field"], (op["def"] as { title: string }).title], ["field.add", s0.recordType, "passport_number", "Passport number"]);
    assert.deepEqual(stageOf(o.s, "intake")["fields"], ["passport_number"]);
    assert.match(textOf(find(o.root, "stage-list-fields")), /Passport number/);
    assert.equal(find(o.root, "stage-field-form"), null, "the form closes");
  } finally { await o.stop(); restore(); }
});

test("a read-only designer lists the fields and has no controls", async () => {
  const restore = installDom();
  const o = await open("intake", false);
  try {
    assert.ok(find(o.root, "stage-fields"));
    for (const l of ["fields", "needToEnter", "needToLeave"]) assert.equal(find(o.root, `add-${l}`), null);
  } finally { await o.stop(); restore(); }
});
