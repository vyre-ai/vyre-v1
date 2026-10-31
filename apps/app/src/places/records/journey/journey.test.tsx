// Records > Journeys: a Journey's record type sits in its own sidebar group, opens on a board of its stages (a drop moves the stage through the Journeys module, a column's plus starts a
// subject record there), keeps the table in the kind switch, and its record page leads with a stage stepper and the subject as a link.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordsDataProvider, RecordsStateProvider, typeGroups } from "../sidebar/index.ts";
import type { RecordsData } from "../sidebar/index.ts";
import type { TypeRow } from "../sidebar/model.ts";
import { RecordViews } from "../views-a/index.ts";
import { northwind } from "../views-a/sample.ts";
import { createSampleRecords } from "../table/sample.ts";
import type { SampleSpace } from "../table/sample.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, PROJECT, createSamplePage } from "../recordpage/sample.ts";
import { isJourneyDef, journeyOfType, moveInJourney, moveWords, stageFieldOf } from "./model.ts";
import { JourneyStepper, subjectTarget } from "./JourneyStepper.tsx";

const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const f = (key: string, type: string, title: string, options?: Record<string, unknown>, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, title, ...(options ? { options } : {}), ...extra });
const STAGES = { stages: [{ key: "stage1", title: "Intake" }, { key: "stage2", title: "In review" }, { key: "stage3", title: "Done" }] };
const JOURNEY: TypeDef = {
  key: "journey_onboarding", title: "Onboarding", plural: "Onboarding", icon: "route", label: "internal", system: false, titleField: "name", group: "Journeys", statusField: "stage", version: 1,
  fields: [f("name", "text", "Name", undefined, { required: true }), f("stage", "status", "Stage", STAGES, { writeOnlyBy: ["journeys.move_stage"] }), f("subject", "relation", "Subject", { target: "clients" }, { required: true })],
};
const jrow = (i: number, stage: string, subject: string): RecordRow => ({ id: `jr_${i}`, type: JOURNEY.key, version: 1, label: 1, createdAt: NOW, updatedAt: NOW, holds: 0, fields: { name: `Onboarding ${i}`, stage, subject } });
const space: SampleSpace = {
  ...northwind,
  types: [...northwind.types, JOURNEY],
  counts: { ...northwind.counts, [JOURNEY.key]: 3 },
  rows: { [JOURNEY.key]: [jrow(1, "stage1", "cl_0"), jrow(2, "stage1", "cl_1"), jrow(3, "stage2", "cl_2")] as never },
};

function sample(opts: { failMove?: string } = {}) {
  const base = createSampleRecords(space);
  const journeyCalls: { cap: string; input: Record<string, unknown> }[] = [];
  const data: RecordsData = {
    ...base.data,
    async call(cap, input) {
      if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", name: "Onboarding", subjectType: "clients", recordType: JOURNEY.key, version: 1, stages: 3, inFlight: 3, updatedAt: NOW }] };
      if (cap === "journeys.move_stage" || cap === "journeys.start") {
        journeyCalls.push({ cap, input: input as Record<string, unknown> });
        if (opts.failMove) throw new Error(opts.failMove);
        if (cap === "journeys.move_stage") {
          const i = input as { recordId: string; toStage: string };
          const cur = (base.replica.rows(`records:${JOURNEY.key}`) as unknown as RecordRow[]).find((r) => r.id === i.recordId)!;
          base.replica.put(`records:${JOURNEY.key}`, [{ ...cur, version: cur.version + 1, fields: { ...cur.fields, stage: i.toStage } } as never]);
          return { recordId: i.recordId, stage: i.toStage };
        }
        return { recordId: "jr_new", stage: (input as { startStage: string }).startStage };
      }
      return base.data.call(cap, input);
    },
  };
  return { ...base, data, journeyCalls };
}

async function board(s: ReturnType<typeof sample>, props: { kind?: string } = {}): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => { r.render(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={{ type: JOURNEY.key }}><RecordViews {...props} /></RecordsStateProvider></RecordsDataProvider>); });
  await flush(); await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("a Journey type is told by its group and its stage field", () => {
  assert.ok(isJourneyDef(JOURNEY));
  assert.ok(!isJourneyDef(CLIENT) && !isJourneyDef({ ...JOURNEY, group: "Records" }), "an ordinary type is not one");
  assert.equal(stageFieldOf(JOURNEY)?.key, "stage");
});

test("the Records sidebar groups a Journey type under Journeys, after Records", () => {
  const row = (t: TypeDef): TypeRow => ({ key: t.key, title: t.title, plural: t.plural, icon: t.icon, ...(t.group ? { group: t.group } : {}), label: "internal", system: false, rowCount: 3, fieldCount: t.fields.length });
  const groups = typeGroups([row(CLIENT), row(JOURNEY), row(PROJECT)]);
  assert.deepEqual(groups.map((g) => g.label), ["Records", "Journeys"]);
  assert.deepEqual(groups[1]!.items.map((i) => [i.key, i.label]), [[JOURNEY.key, "Onboarding"]]);
  assert.equal(groups[1]!.items[0]!.icon, "route", "it keeps the route icon");
});

test("a Journey type opens on a board of its stages, with the cards in their columns and a plus in each", async () => {
  const restore = installDom();
  const s = sample();
  const b = await board(s);
  try {
    assert.ok(find(b.root, "records-board"), "the board is the default view");
    assert.equal(find(b.root, "records-table"), null);
    for (const id of ["lane-stage1", "lane-stage2", "lane-stage3"]) assert.ok(find(b.root, id), id);
    assert.match(textOf(find(b.root, "lane-stage1")), /Intake/);
    assert.ok(find(b.root, "card-jr_1") && find(b.root, "card-jr_2") && find(b.root, "card-jr_3"));
    assert.equal(find(b.root, "lane-count-stage1")?.children?.map(String).join(""), "2");
    for (const k of ["stage1", "stage2", "stage3"]) assert.ok(find(b.root, `add-${k}`), `a plus in ${k}`);
    assert.equal(find(b.root, "records-new"), null, "a Journey record starts from a column, not from a blank New");
  } finally { await b.stop(); restore(); }
});

test("the table stays available for a Journey type", async () => {
  const restore = installDom();
  const s = sample();
  const b = await board(s, { kind: "table" });
  try { assert.ok(find(b.root, "records-table"), "kind=table draws the table"); assert.ok(find(b.root, "records-kind"), "and the switch is there"); } finally { await b.stop(); restore(); }
});

test("dropping a card on another column calls the stage move, never records.update, and the card changes column", async () => {
  const restore = installDom();
  const s = sample();
  const b = await board(s);
  try {
    await act(async () => { (find(b.root, "drag-jr_1")!.props.onDragStart as (e: unknown) => void)({ dataTransfer: { setData() {}, effectAllowed: "" } }); });
    await act(async () => { (find(b.root, "drop-stage3")!.props.onDrop as (e: unknown) => void)({ preventDefault() {} }); });
    await flush();
    assert.deepEqual(s.journeyCalls, [{ cap: "journeys.move_stage", input: { journeyId: "jrn_1", recordId: "jr_1", toStage: "stage3", reason: "Moved on the board" } }]);
    assert.ok(!s.calls.some((c) => c.cap === "records.update"), "the stage field is not written by records.update");
    assert.equal(find(b.root, "lane-count-stage3")?.children?.map(String).join(""), "1");
  } finally { await b.stop(); restore(); }
});

test("a refused move says why in plain words and the card stays", async () => {
  const restore = installDom();
  const s = sample({ failMove: "stage precondition: required task t1 is not done (validation.precondition_failed)" });
  const b = await board(s);
  try {
    await act(async () => { (find(b.root, "drag-jr_1")!.props.onDragStart as (e: unknown) => void)({ dataTransfer: { setData() {}, effectAllowed: "" } }); });
    await act(async () => { (find(b.root, "drop-stage2")!.props.onDrop as (e: unknown) => void)({ preventDefault() {} }); });
    await flush();
    assert.equal(textOf(find(b.root, "board-error")), "Finish the required tasks in this stage first.");
    assert.equal(find(b.root, "lane-count-stage1")?.children?.map(String).join(""), "2");
  } finally { await b.stop(); restore(); }
});

test("the plus in a column lists the subject records and starts the one chosen at that stage", async () => {
  const restore = installDom();
  const s = sample();
  const b = await board(s);
  try {
    await press(find(b.root, "add-stage2"));
    await flush(); await flush();
    const names = (s.replica.rows("records:clients") as unknown as RecordRow[]).map((r) => String(r.fields["name"]));
    assert.ok(names.length > 0 && find(b.root, `menu-item-${names[0]}`), "the menu offers the subject records by name");
    await press(find(b.root, `menu-item-${names[0]}`));
    await flush();
    const start = s.journeyCalls.find((c) => c.cap === "journeys.start")!;
    assert.deepEqual([start.input["journeyId"], start.input["subjectRecordId"], start.input["startStage"]], ["jrn_1", "cl_0", "stage2"]);
  } finally { await b.stop(); restore(); }
});

test("moveInJourney does nothing for a card already in the stage, and refusals are translated", async () => {
  const calls: string[] = [];
  const row = jrow(1, "stage1", "cl_0");
  assert.equal(await moveInJourney(async (cap) => { calls.push(cap); return {}; }, "jrn_1", row, "stage1"), false);
  assert.deepEqual(calls, []);
  await assert.rejects(() => moveInJourney(async () => { throw new Error("raw backend text 500"); }, "jrn_1", row, "stage2"), (e: Error) => e.message === "Could not move it. Try again.");
  assert.equal(moveWords(new Error("permission denied")), "You do not have permission to move this record.");
  assert.equal((await journeyOfType(async () => ({ journeys: [{ id: "j", recordType: "a", subjectType: "b" }] }), "a"))?.subjectType, "b");
});

test("a Journey record's page leads with the stages and the subject as a link; a click on a stage moves it", async () => {
  const restore = installDom();
  const page = createSamplePage({ id: "northwind", people: { usr_irfad: "Irfad Imtiaz" }, types: [CLIENT, PROJECT, JOURNEY] });
  page.replica.put(`records:${JOURNEY.key}`, [jrow(1, "stage2", "cl_0") as never]);
  const moves: Record<string, unknown>[] = [];
  const data = {
    ...page.data,
    async call(cap: string, input: unknown) {
      if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", recordType: JOURNEY.key, subjectType: "clients" }] };
      if (cap === "journeys.move_stage") { moves.push(input as Record<string, unknown>); return {}; }
      return page.data.call(cap, input);
    },
  };
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={data}><RecordPage type={JOURNEY.key} recordId="jr_1" /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    assert.ok(find(root, "journey-stepper"), "the stepper is at the top");
    assert.match(textOf(find(root, "journey-stepper")), /Intake.*In review.*Done/);
    assert.match(String(find(root, "step-stage2")!.props["aria-label"] ?? ""), /current stage/);
    assert.match(textOf(find(root, "journey-subject-link")), /Elena Rivera/, "the subject by name");
    await press(find(root, "journey-subject-link"));
    assert.deepEqual(page.opened, ["record:clients:cl_0"], "the link opens the subject");
    await press(find(root, "step-stage3"));
    await flush();
    assert.deepEqual(moves, [{ journeyId: "jrn_1", recordId: "jr_1", toStage: "stage3", reason: "Moved on the board" }]);
    assert.ok(find(root, "record-sheet"), "the regular details are still on the page");
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

test("an ordinary record page has no stepper, and the subject target reads either spelling", () => {
  const page = createSamplePage();
  const out = renderToStaticMarkup(<RecordPageDataProvider value={page.data}><RecordPage type="clients" recordId="cl_0" /></RecordPageDataProvider>);
  assert.ok(!out.includes("journey-stepper"));
  assert.equal(subjectTarget(f("subject", "relation", "Subject", { target: "clients" })), "clients");
  assert.equal(subjectTarget(f("subject", "relation", "Subject", { to: "clients" })), "clients");
  assert.equal(subjectTarget(undefined), null);
  assert.equal(typeof JourneyStepper, "function");
});
