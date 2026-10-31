// New Journey type: who goes through it is a real record type picked by name (or a new plain one made in place), the stages are an editable list with templates and a live board preview,
// the problems read in plain words next to the field, and the Journey is made through journeys.create with the real type key.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import type { AutomationsData } from "../canvas/data.tsx";
import { JourneyNewSheet } from "./JourneyNewSheet.tsx";
import { STAGE_TEMPLATES, createPlainType, issuesOf, makeJourney, plainError, stagesFrom, typeChoices, typeKeyFor } from "./newModel.ts";

type Row = Parameters<typeof typeChoices>[0][number];
const type = (key: string, plural: string, o: Partial<Row> = {}): Row => ({ key, title: plural.replace(/s$/, ""), plural, icon: "people", label: "internal", system: false, rowCount: 0, fieldCount: 3, ...o });
const TYPES: Row[] = [type("contacts", "Contacts"), type("companies", "Companies", { icon: "building" }), type("projects", "Projects", { icon: "project" }), type("agent", "Agents", { system: true }), type("journey_hire", "Hiring", { group: "Journeys" }), type("orders", "Orders", { scope: "site:shop" })];

interface Rig { data: AutomationsData; calls: { cap: string; input: Record<string, unknown> }[]; opened: string[] }
function rig(handler: (cap: string, input: Record<string, unknown>) => unknown = () => ({})): Rig {
  const calls: Rig["calls"] = [];
  const opened: string[] = [];
  const data = {
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "schema.types.list") return { types: TYPES };
      return handler(cap, input as Record<string, unknown>);
    },
    nav: { openJourney: (id: string) => void opened.push(id), openAutomation() {}, openFailedRuns() {}, openRun() {}, ask() {}, connect() {} },
    me: { id: "usr_irfad", name: "Irfad" }, name: (id: string) => id, keys: [], screens: {}, clock: () => ({ now: 0 }),
  } as unknown as AutomationsData;
  return { data, calls, opened };
}

async function sheet(r: Rig, props: Partial<Parameters<typeof JourneyNewSheet>[0]> = {}): Promise<{ root: Node; closed: () => boolean; stop(): Promise<void> }> {
  let closed = false;
  const c = createRoot();
  await act(async () => { c.render(<AutomationsDataProvider value={r.data}><JourneyNewSheet onClose={() => { closed = true; }} {...props} /></AutomationsDataProvider>); });
  await flush(); await flush();
  return { root: c.container as unknown as Node, closed: () => closed, stop: async () => { await act(async () => { c.unmount(); }); } };
}
function strip(n: Node | string): unknown { return typeof n === "string" ? n : { p: { "data-testid": n.props["data-testid"], value: n.props["value"] }, c: (n.children ?? []).map(strip) }; }
/** The stage name inputs, top to bottom as drawn. */
const stageInputs = (root: Node): Node[] => {
  const out: Node[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; if (String(n.props["data-testid"] ?? "").startsWith("stage-name-")) out.push(n); for (const c of n.children ?? []) walk(c); };
  walk(root);
  return out;
};
const valueOf = (n: Node): string => String(n.props["value"] ?? "");

test("the picker lists the Space's real record types by name, not the system's, an agent, a site table or another Journey", async () => {
  assert.deepEqual(typeChoices(TYPES).map((t) => t.plural), ["Contacts", "Companies", "Projects"]);
  const restore = installDom();
  const r = rig();
  const s = await sheet(r);
  try {
    for (const k of ["contacts", "companies", "projects"]) assert.ok(find(s.root, `subject-${k}`), k);
    for (const k of ["agent", "journey_hire", "orders"]) assert.equal(find(s.root, `subject-${k}`), null, k);
    assert.match(textOf(find(s.root, "new-subjects")), /Contacts.*Companies.*Projects/);
    const raw = JSON.stringify([...TYPES.map((t) => t.key)]);
    assert.ok(!/client|lead|matter/.test(textOf(s.root)), `no raw key or law word in the sheet (${raw})`);
    assert.equal(find(s.root, "new-subject"), null, "there is no free-text subject box");
  } finally { await s.stop(); restore(); }
});

test("making the Journey calls journeys.create with the real type key and the stages, then opens it", async () => {
  const restore = installDom();
  const r = rig((cap) => (cap === "journeys.create" ? { journey: { id: "jrn_new" } } : {}));
  const s = await sheet(r);
  try {
    await typeInto(find(s.root, "new-name"), "ATP");
    await press(find(s.root, "subject-contacts"));
    await press(find(s.root, "new-create"));
    await flush();
    const made = r.calls.find((c) => c.cap === "journeys.create")!;
    assert.equal(made.input["name"], "ATP");
    assert.equal(made.input["subjectType"], "contacts");
    assert.deepEqual((made.input["stages"] as { title: string; order: number }[]).map((x) => [x.title, x.order]), [["Start", 0], ["In progress", 1], ["Done", 2]]);
    assert.deepEqual(r.opened, ["jrn_new"]);
    assert.ok(s.closed());
  } finally { await s.stop(); restore(); }
});

test("a quick template fills the stages, and the preview shows one column for each", async () => {
  const restore = installDom();
  const r = rig();
  const s = await sheet(r);
  try {
    for (const t of STAGE_TEMPLATES) {
      await press(find(s.root, `template-${t.key}`));
      assert.deepEqual(stageInputs(s.root).map(valueOf), [...t.stages], t.label);
      assert.match(textOf(find(s.root, "new-preview")), new RegExp(t.stages.join(".*")));
      assert.equal(textOf(find(s.root, "new-stage-count")), `${t.stages.length} columns on the board`);
    }
    assert.deepEqual(STAGE_TEMPLATES.find((t) => t.key === "sales")!.stages, ["New", "Qualified", "Proposal", "Won", "Lost"]);
    assert.deepEqual(STAGE_TEMPLATES.find((t) => t.key === "delivery")!.stages, ["Kickoff", "In progress", "Review", "Done"]);
    assert.deepEqual(STAGE_TEMPLATES.find((t) => t.key === "hiring")!.stages, ["Applied", "Screen", "Interview", "Offer", "Hired"]);
  } finally { await s.stop(); restore(); }
});

test("stages are edited in the list: add, rename inline, reorder, delete", async () => {
  const restore = installDom();
  const r = rig();
  const s = await sheet(r, { initialStages: ["One", "Two", "Three"] });
  try {
    await press(find(s.root, "new-add-stage"));
    assert.equal(stageInputs(s.root).length, 4);
    await typeInto(stageInputs(s.root)[3]!, "Four");
    await typeInto(stageInputs(s.root)[0]!, "First");
    assert.deepEqual(stageInputs(s.root).map(valueOf), ["First", "Two", "Three", "Four"]);
    await press(find(s.root, "stage-down-stage1"));
    assert.deepEqual(stageInputs(s.root).map(valueOf), ["Two", "First", "Three", "Four"]);
    await press(find(s.root, "stage-up-stage4"));
    assert.deepEqual(stageInputs(s.root).map(valueOf), ["Two", "First", "Four", "Three"]);
    await act(async () => { (find(s.root, "stage-drag-stage3")!.props.onDragStart as (e: unknown) => void)({ dataTransfer: { setData() {}, effectAllowed: "" } }); });
    await act(async () => { (find(s.root, "stage-drag-stage2")!.props.onDrop as (e: unknown) => void)({ preventDefault() {} }); });
    assert.deepEqual(stageInputs(s.root).map(valueOf), ["Three", "Two", "First", "Four"], "a stage dragged onto another takes its place");
    await press(find(s.root, "stage-delete-stage2"));
    assert.deepEqual(stageInputs(s.root).map(valueOf), ["Three", "First", "Four"]);
    assert.equal(textOf(find(s.root, "new-stage-count")), "3 columns on the board");
  } finally { await s.stop(); restore(); }
});

test("a new type is made from a name, selected at once, and the Journey then follows it", async () => {
  const restore = installDom();
  const r = rig((cap) => (cap === "journeys.create" ? { journey: { id: "jrn_c" } } : {}));
  const s = await sheet(r);
  try {
    await press(find(s.root, "new-type"));
    await typeInto(find(s.root, "new-type-name"), "Candidates");
    await press(find(s.root, "new-type-add"));
    await flush();
    const apply = r.calls.find((c) => c.cap === "schema.apply")!;
    const op = (apply.input["ops"] as { op: string; type: string; def: Record<string, unknown> }[])[0]!;
    assert.deepEqual([op.op, op.type, op.def["title"], op.def["plural"], op.def["titleField"]], ["type.create", "candidates", "Candidates", "Candidates", "name"]);
    assert.ok(find(s.root, "subject-candidates"), "it is in the picker");
    assert.equal(find(s.root, "subject-candidates")!.props["aria-checked"], true, "and selected");
    assert.equal(find(s.root, "new-type-form"), null, "the inline form closes");
    await typeInto(find(s.root, "new-name"), "Hiring pipeline");
    await press(find(s.root, "new-create"));
    await flush();
    assert.equal(r.calls.find((c) => c.cap === "journeys.create")!.input["subjectType"], "candidates");
  } finally { await s.stop(); restore(); }
});

test("a new type that cannot be made says so in plain words and keeps the form", async () => {
  const restore = installDom();
  const r = rig((cap) => { if (cap === "schema.apply") throw new Error("denied: schema.manage required"); return {}; });
  const s = await sheet(r);
  try {
    await press(find(s.root, "new-type"));
    await typeInto(find(s.root, "new-type-name"), "Candidates");
    await press(find(s.root, "new-type-add"));
    await flush();
    assert.equal(textOf(find(s.root, "issue-new-type")), "You do not have permission to make Journeys here.");
    assert.ok(find(s.root, "new-type-form"));
    assert.ok(!find(s.root, "subject-candidates"));
  } finally { await s.stop(); restore(); }
});

test("pressing Make the Journey with things missing says what, next to each field, and calls nothing", async () => {
  const restore = installDom();
  const r = rig();
  const s = await sheet(r, { initialStages: [] });
  try {
    await press(find(s.root, "new-create"));
    assert.equal(textOf(find(s.root, "issue-name")), "Give it a name");
    assert.equal(textOf(find(s.root, "issue-subject")), "Pick who goes through it");
    assert.equal(textOf(find(s.root, "issue-stages")), "Add at least one stage");
    assert.ok(!r.calls.some((c) => c.cap === "journeys.create"));
  } finally { await s.stop(); restore(); }
});

test("a backend refusal is shown in plain words, never as the raw text", async () => {
  const restore = installDom();
  const r = rig((cap) => { if (cap === "journeys.create") throw new Error("field subject: relation target client is not a record type"); return {}; });
  const s = await sheet(r);
  try {
    await typeInto(find(s.root, "new-name"), "ATP");
    await press(find(s.root, "subject-contacts"));
    await press(find(s.root, "new-create"));
    await flush();
    const shown = textOf(find(s.root, "new-error"));
    assert.equal(shown, "Pick who goes through it again. That type is not available.");
    assert.ok(!/relation target|field subject|client/.test(textOf(s.root)));
    assert.ok(!s.closed());
  } finally { await s.stop(); restore(); }
});

test("plainError, issuesOf, typeKeyFor and the two writes", async () => {
  assert.equal(plainError(new Error("A Journey with that name exists.")), "That name is taken. Try another.");
  assert.equal(plainError(new Error("fetch failed")), "Could not reach your Space. Check the connection and try again.");
  assert.equal(plainError(new Error("boom 500 stack at x")), "That did not work. Try again.");
  assert.equal(plainError({ code: "validation.duplicate" }), "That name is taken. Try another.");
  assert.deepEqual(issuesOf("A", "contacts", stagesFrom(["x", "X"])), { stages: "Two stages are named X" });
  assert.deepEqual(issuesOf("A", "contacts", stagesFrom(["x", " "])), {}, "an unnamed stage is left out, not an error");
  assert.equal(typeKeyFor("Hiring Pipeline!", []), "hiring_pipeline");
  assert.equal(typeKeyFor("Contacts", ["contacts", "contacts_2"]), "contacts_3");
  const seen: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => { seen.push({ cap, input: input as Record<string, unknown> }); return { journey: { id: "j1" } }; };
  assert.equal((await createPlainType(call, "Leads", ["leads"])).key, "leads_2");
  assert.equal(await makeJourney(call, { name: " Sales ", subject: "contacts", stages: stagesFrom(["New", "", "Won"]) }), "j1");
  const made = seen.find((x) => x.cap === "journeys.create")!.input;
  assert.deepEqual([made["name"], made["subjectType"], (made["stages"] as { title: string }[]).map((x) => x.title)], ["Sales", "contacts", ["New", "Won"]]);
});

test("no copy in the sheet uses an em dash or a section sign", async () => {
  const restore = installDom();
  const r = rig();
  const s = await sheet(r);
  try {
    const all = textOf(s.root) + JSON.stringify(strip(s.root));
    assert.ok(!all.includes(String.fromCharCode(0x2014)) && !all.includes(String.fromCharCode(0xa7)));
  } finally { await s.stop(); restore(); }
});
