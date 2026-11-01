// Records > Journeys > gates: a stage that waits on fields refuses the move with the list; the board and the stepper open a small sheet for exactly those fields, and Save and move writes them and
// moves the record in one step.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import type { RecordsData } from "../sidebar/index.ts";
import { RecordViews } from "../views-a/index.ts";
import { northwind } from "../views-a/sample.ts";
import { createSampleRecords } from "../table/sample.ts";
import type { SampleSpace } from "../table/sample.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, PROJECT, createSamplePage } from "../recordpage/sample.ts";
import { GateError, fillAndMove, gateOf, moveInJourney } from "./model.ts";

const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const f = (key: string, type: string, title: string, options?: Record<string, unknown>, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, title, ...(options ? { options } : {}), ...extra });
const STAGES = { stages: [{ key: "stage1", title: "Intake" }, { key: "stage2", title: "In review" }, { key: "stage3", title: "Done" }] };
const JOURNEY: TypeDef = {
  key: "journey_onboarding", title: "Onboarding", plural: "Onboarding", icon: "route", label: "internal", system: false, titleField: "name", group: "Journeys", statusField: "stage", version: 1,
  fields: [f("name", "text", "Name", undefined, { required: true }), f("stage", "status", "Stage", STAGES, { writeOnlyBy: ["journeys.move_stage"] }), f("subject", "relation", "Subject", { target: "clients" }, { required: true }),
    f("invoice", "text", "Invoice number"), f("amount", "money", "Amount"), f("plan", "choice", "Plan", { choices: [{ key: "basic", title: "Basic" }, { key: "pro", title: "Pro" }] })],
};
const MISSING = [{ key: "invoice", title: "Invoice number", stage: "stage2", when: "enter" }, { key: "amount", title: "Amount", stage: "stage1", when: "leave" }];
const jrow = (i: number, stage: string, over: Record<string, unknown> = {}): RecordRow => ({ id: `jr_${i}`, type: JOURNEY.key, version: 1, label: 1, createdAt: NOW, updatedAt: NOW, holds: 0, fields: { name: `Onboarding ${i}`, stage, subject: "cl_0", ...over } });
/** The error the gateway throws for a refused gate. */
const refusal = (missing = MISSING, toStage = "stage2"): Error => Object.assign(new Error("Fill these first: Invoice number, Amount."), { code: "validation.precondition_failed", details: { reason: "fields_required", fields: missing, toStage } });

/** A move_stage that refuses until the record holds every field in `need`, like the server. */
function gate(rows: () => RecordRow[], need: string[], log: { cap: string; input: Record<string, unknown> }[]): (cap: string, input: unknown) => void {
  return (cap, input) => {
    log.push({ cap, input: input as Record<string, unknown> });
    if (cap !== "journeys.move_stage") return;
    const i = input as { recordId: string; toStage: string };
    const row = rows().find((r) => r.id === i.recordId)!;
    const missing = MISSING.filter((m) => need.includes(m.key) && (row.fields[m.key] === undefined || row.fields[m.key] === null || row.fields[m.key] === ""));
    if (missing.length) throw refusal(missing, i.toStage);
  };
}

test("a refusal that names fields becomes a GateError with the list; any other refusal is not one", async () => {
  const g = gateOf(refusal());
  assert.ok(g instanceof GateError);
  assert.deepEqual(g!.missing.map((m) => [m.key, m.title, m.when]), [["invoice", "Invoice number", "enter"], ["amount", "Amount", "leave"]]);
  assert.equal(g!.toStage, "stage2");
  assert.ok(gateOf({ error: { details: { reason: "fields_required", fields: [{ key: "a" }], toStage: "x" } } }), "the envelope shape too");
  assert.equal(gateOf(new Error("permission denied")), null);
  assert.equal(gateOf({ details: { reason: "fields_required", fields: [] } }), null, "an empty list is no gate");
  const row = jrow(1, "stage1");
  await assert.rejects(() => moveInJourney(async () => { throw refusal(); }, "jrn_1", row, "stage2"), (e) => e instanceof GateError && e.missing.length === 2);
});

test("fillAndMove writes the answers then asks again; nothing is written while an answer is missing or wrong", async () => {
  const log: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => { log.push({ cap, input: input as Record<string, unknown> }); return {}; };
  const row = jrow(1, "stage1");
  const o = { journeyId: "jrn_1", type: JOURNEY.key, row, def: JOURNEY, missing: MISSING, toStage: "stage2" };
  const none = await fillAndMove(call, { ...o, entered: { invoice: "INV-1" } });
  assert.deepEqual(none, { ok: false, message: "Amount needs an answer." });
  const bad = await fillAndMove(call, { ...o, entered: { invoice: "INV-1", amount: "lots" } });
  assert.deepEqual(bad, { ok: false, message: "Amount takes an amount." });
  assert.equal(log.length, 0, "nothing written");
  assert.deepEqual(await fillAndMove(call, { ...o, entered: { invoice: "INV-1", amount: "1,200" } }), { ok: true });
  assert.deepEqual(log.map((c) => c.cap), ["records.update", "journeys.move_stage"]);
  assert.deepEqual(log[0]!.input, { type: JOURNEY.key, recordId: "jr_1", patch: { invoice: "INV-1", amount: { amount: 1200, currency: "USD" } }, baseVersion: 1 });
  assert.equal(log[1]!.input["toStage"], "stage2");
});

test("if the stage still wants more after the answers, the new list comes back", async () => {
  const call = async (cap: string): Promise<unknown> => { if (cap === "journeys.move_stage") throw refusal([MISSING[0]!]); return {}; };
  const r = await fillAndMove(call, { journeyId: "jrn_1", type: JOURNEY.key, row: jrow(1, "stage1"), def: JOURNEY, missing: [MISSING[1]!], toStage: "stage2", entered: { amount: "5" } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.missing?.map((m) => m.key), ["invoice"]);
});

// ---------------------------------------------------------------- the stepper

test("the stepper: a refused move opens the sheet for the missing fields; Save and move fills them and the record moves in one step", async () => {
  const restore = installDom();
  const page = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, PROJECT, JOURNEY] });
  page.replica.put(`records:${JOURNEY.key}`, [jrow(1, "stage1") as never]);
  const log: { cap: string; input: Record<string, unknown> }[] = [];
  const check = gate(() => page.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[], ["invoice"], log);
  const data = {
    ...page.data,
    async call(cap: string, input: unknown) {
      if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", recordType: JOURNEY.key, subjectType: "clients" }] };
      if (cap === "journeys.move_stage") { check(cap, input); return {}; }
      log.push({ cap, input: input as Record<string, unknown> });
      return page.data.call(cap, input);
    },
  };
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={data}><RecordPage type={JOURNEY.key} recordId="jr_1" /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    await press(find(root, "step-stage2"));
    await flush();
    assert.ok(find(root, "gate-sheet"), "the sheet opens");
    assert.deepEqual(log.filter((c) => c.cap === "journeys.move_stage").length, 1, "the first ask was refused");
    assert.ok(find(root, "gate-field-invoice") && !find(root, "gate-field-amount"), "only the field that is missing");
    assert.match(textOf(find(root, "gate-sheet")), /Before it moves to In review/);
    await press(find(root, "gate-save"));
    await flush();
    assert.match(textOf(find(root, "gate-error")), /Invoice number needs an answer/);
    assert.ok(!log.some((c) => c.cap === "records.update"), "nothing is written for an empty answer");
    await typeInto(find(root, "gate-input-invoice"), "INV-77");
    await press(find(root, "gate-save"));
    await flush(); await flush();
    assert.deepEqual(log.filter((c) => c.cap === "records.update").map((c) => c.input["patch"]), [{ invoice: "INV-77" }]);
    assert.deepEqual(log.filter((c) => c.cap === "journeys.move_stage").length, 2, "and the move is asked once more");
    assert.equal(find(root, "gate-sheet"), null, "the sheet closes when the move is done");
    assert.equal(find(root, "journey-stepper-error"), null);
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

test("the sheet's Cancel leaves the record where it is", async () => {
  const restore = installDom();
  const page = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, PROJECT, JOURNEY] });
  page.replica.put(`records:${JOURNEY.key}`, [jrow(1, "stage1") as never]);
  const moves: unknown[] = [];
  const data = { ...page.data, async call(cap: string, input: unknown) {
    if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", recordType: JOURNEY.key, subjectType: "clients" }] };
    if (cap === "journeys.move_stage") { moves.push(input); throw refusal(); }
    return page.data.call(cap, input);
  } };
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={data}><RecordPage type={JOURNEY.key} recordId="jr_1" /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    await press(find(root, "step-stage2"));
    await flush();
    assert.ok(find(root, "gate-field-invoice") && find(root, "gate-field-amount"), "both fields are asked");
    await press(find(root, "gate-cancel"));
    await flush();
    assert.equal(find(root, "gate-sheet"), null);
    assert.equal(moves.length, 1);
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

// ---------------------------------------------------------------- the board

const space: SampleSpace = {
  ...northwind,
  types: [...northwind.types, JOURNEY],
  counts: { ...northwind.counts, [JOURNEY.key]: 2 },
  rows: { [JOURNEY.key]: [jrow(1, "stage1"), jrow(2, "stage1", { invoice: "INV-1" })] as never },
};

test("the board: dropping a card on a stage that wants fields opens the sheet; filling them moves the card", async () => {
  const restore = installDom();
  const base = createSampleRecords(space);
  const log: { cap: string; input: Record<string, unknown> }[] = [];
  const check = gate(() => base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[], ["invoice"], log);
  const data: RecordsData = {
    ...base.data,
    async call(cap, input) {
      if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", name: "Onboarding", subjectType: "clients", recordType: JOURNEY.key, version: 1, stages: 3, inFlight: 2, updatedAt: NOW }] };
      if (cap === "journeys.move_stage") {
        check(cap, input);
        const i = input as { recordId: string; toStage: string };
        const cur = (base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[]).find((x) => x.id === i.recordId)!;
        base.replica.put(`records:${JOURNEY.key}`, [{ ...cur, version: cur.version + 1, fields: { ...cur.fields, stage: i.toStage } } as never]);
        return { recordId: i.recordId, stage: i.toStage };
      }
      if (cap === "records.update") {
        const i = input as { type: string; recordId: string; patch: Record<string, unknown> };
        log.push({ cap, input: i });
        const cur = (base.replica.rows(`records:${i.type}`) as unknown as RecordRow[]).find((x) => x.id === i.recordId)!;
        base.replica.put(`records:${i.type}`, [{ ...cur, version: cur.version + 1, fields: { ...cur.fields, ...i.patch } } as never]);
        return {};
      }
      return base.data.call(cap, input);
    },
  };
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordsDataProvider value={data}><RecordsStateProvider initial={{ type: JOURNEY.key }}><RecordViews /></RecordsStateProvider></RecordsDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    await act(async () => { (find(root, "drag-jr_1")!.props.onDragStart as (e: unknown) => void)({ dataTransfer: { setData() {}, effectAllowed: "" } }); });
    await act(async () => { (find(root, "drop-stage2")!.props.onDrop as (e: unknown) => void)({ preventDefault() {} }); });
    await flush();
    assert.ok(find(root, "gate-sheet"), "the sheet opens in place of an error");
    assert.equal(find(root, "board-error"), null);
    assert.equal(find(root, "lane-count-stage1")?.children?.map(String).join(""), "2", "the card has not moved");
    await typeInto(find(root, "gate-input-invoice"), "INV-5");
    await press(find(root, "gate-save"));
    await flush(); await flush();
    assert.equal(find(root, "gate-sheet"), null);
    assert.equal(find(root, "lane-count-stage2")?.children?.map(String).join(""), "1", "the card is in the new stage");
    assert.deepEqual(log.filter((c) => c.cap === "records.update").map((c) => c.input["patch"]), [{ invoice: "INV-5" }]);
    // a card that already has the field moves with no sheet
    await act(async () => { (find(root, "drag-jr_2")!.props.onDragStart as (e: unknown) => void)({ dataTransfer: { setData() {}, effectAllowed: "" } }); });
    await act(async () => { (find(root, "drop-stage2")!.props.onDrop as (e: unknown) => void)({ preventDefault() {} }); });
    await flush();
    assert.equal(find(root, "gate-sheet"), null);
    assert.equal(find(root, "lane-count-stage2")?.children?.map(String).join(""), "2");
  } finally { await act(async () => { r.unmount(); }); restore(); }
});
