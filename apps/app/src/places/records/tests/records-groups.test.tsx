// Records > field groups on the record page: a type's groups are sections of its layout; three or more show as tabs under the title (Overview first). A Journey record leads with the group of
// its current stage, shows the earlier ones, and keeps the later ones locked ("Opens at <stage>").
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { CLIENT, PROJECT, createSamplePage } from "../recordpage/sample.ts";
import type { SamplePage } from "../recordpage/sample.ts";
import { sectionsOf } from "../recordpage/model.ts";
import { tabsOf, visibleSections, withStages } from "../recordpage/groups.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";

const has = (s: string, needle: string): boolean => s.includes(needle);
const OVERVIEW = { key: "overview", title: "Overview", fields: ["company", "status"] };
const G3 = [
  OVERVIEW,
  { key: "contact", title: "Contact", fields: ["email", "phone"] },
  { key: "billing", title: "Billing", fields: ["value", "due"] },
  { key: "documents", title: "Documents", fields: ["id_doc", "notes"] },
];
const html = (s: SamplePage): string => renderToStaticMarkup(<RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId="cl_0" start={{ all: true }} /></RecordPageDataProvider>).replaceAll("<!-- -->", "");
const withLayout = (sections: unknown[]): SamplePage => {
  const s = createSamplePage();
  s.replica.resolve("schema.layout.get", () => ({ sections }) as never);
  return s;
};

test("groups are the layout's sections; fields no group holds stay in the Overview, wherever it sits", () => {
  const s = sectionsOf(CLIENT, { sections: G3.slice(0, 2) }, { folded: [], keepVisible: [] });
  assert.deepEqual(s.map((x) => x.key), ["overview", "contact"]);
  assert.ok(s[0]!.fields.some((f) => f.key === "rating") && !s[1]!.fields.some((f) => f.key === "rating"), "a field no group holds is ungrouped");
  assert.deepEqual(s[1]!.fields.map((f) => f.key), ["email", "phone"]);
});

test("fewer than three groups stay sections; three or more become tabs with Overview first", () => {
  const two = sectionsOf(CLIENT, { sections: G3.slice(0, 3) }, undefined);
  assert.equal(tabsOf(two), null);
  const three = sectionsOf(CLIENT, { sections: G3 }, undefined);
  assert.deepEqual(tabsOf(three), [{ key: "overview", title: "Overview" }, { key: "contact", title: "Contact" }, { key: "billing", title: "Billing" }, { key: "documents", title: "Documents" }]);
  assert.deepEqual(visibleSections(three, tabsOf(three), "billing").map((x) => x.key), ["billing"]);
  assert.deepEqual(visibleSections(three, tabsOf(three), "nope").map((x) => x.key), ["overview"], "an unknown tab falls back to the first");
  assert.equal(visibleSections(two, null, "billing").length, 3, "no tabs, every section");
  assert.equal(tabsOf(sectionsOf(CLIENT, { sections: G3.slice(1) }, undefined)), null, "a hand-written layout without an Overview keeps its sections");
});

test("the page draws the groups as sections below three, and as tabs at three with only the first tab's fields", () => {
  const two = html(withLayout(G3.slice(0, 3)));
  for (const k of ["overview", "contact", "billing"]) assert.ok(has(two, `data-testid="section-${k}"`), k);
  assert.ok(!has(two, 'data-testid="tab-overview') && !has(two, 'data-testid="tab-billing'), "no tabs");
  const three = html(withLayout(G3));
  assert.ok(has(three, 'data-testid="tab-overview-selected"') && has(three, 'data-testid="tab-billing"'));
  assert.ok(has(three, 'data-testid="section-overview"') && !has(three, 'data-testid="section-billing"'), "only the Overview tab's section");
});

test("choosing a tab shows that group's fields", async () => {
  const restore = installDom();
  const s = withLayout(G3);
  const r = createRoot();
  try {
    await act(async () => { r.render(<RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId="cl_0" start={{ all: true }} /></RecordPageDataProvider>); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    assert.ok(find(root, "section-overview") && !find(root, "section-billing"));
    await press(find(root, "tab-billing"));
    await flush();
    assert.ok(find(root, "section-billing") && !find(root, "section-overview"), "the Billing group");
    assert.ok(find(root, "tab-billing-selected"));
    assert.match(textOf(find(root, "section-billing")), /Value/);
  } finally { await act(async () => { r.unmount(); }); restore(); }
});

// ---------------------------------------------------------------- stages

const f = (key: string, type: string, title: string, options?: Record<string, unknown>, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, title, ...(options ? { options } : {}), ...extra });
const STAGES = { stages: [{ key: "intake", title: "Intake" }, { key: "review", title: "In review" }, { key: "paid", title: "Paid" }, { key: "done", title: "Done" }] };
const JOURNEY: TypeDef = {
  key: "journey_matter", title: "Matter", plural: "Matters", icon: "route", label: "internal", system: false, titleField: "name", group: "Journeys", statusField: "stage", version: 1,
  fields: [f("name", "text", "Name", undefined, { required: true }), f("stage", "status", "Stage", STAGES), f("subject", "relation", "Subject", { target: "clients" }),
    f("source", "text", "Source"), f("reviewer", "text", "Reviewer"), f("invoice", "text", "Invoice number"), f("note", "text", "Closing note")],
};
const jstages = [
  { key: "intake", title: "Intake", order: 0, fields: ["source"] }, { key: "review", title: "In review", order: 1, fields: ["reviewer"] },
  { key: "paid", title: "Paid", order: 2, fields: ["invoice"] }, { key: "done", title: "Done", order: 3, fields: ["note"], final: true },
];
const jrow = (stage: string): RecordRow => ({ id: "jr_1", type: JOURNEY.key, version: 1, label: 1, createdAt: 0, updatedAt: 0, holds: 0, fields: { name: "Matter 1", stage, subject: "cl_0", source: "Referral", reviewer: "Maya", invoice: "INV-9", note: "ok" } });
function journeyPage(stage: string): SamplePage & { opened: string[] } {
  const s = createSamplePage({ id: "northwind", people: {}, types: [CLIENT, PROJECT, JOURNEY] });
  s.replica.put(`records:${JOURNEY.key}`, [jrow(stage) as never]);
  const call = s.data.call;
  s.data.call = async (cap: string, input: unknown) => {
    if (cap === "journeys.list") return { journeys: [{ id: "jrn_1", recordType: JOURNEY.key, subjectType: "clients" }] };
    if (cap === "journeys.get") return { journey: { id: "jrn_1", stages: jstages } };
    return call(cap, input);
  };
  return s;
}
async function mounted(s: SamplePage): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => { r.render(<RecordPageDataProvider value={s.data}><RecordPage type={JOURNEY.key} recordId="jr_1" start={{ all: true }} /></RecordPageDataProvider>); });
  await flush(); await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("stage groups: the current stage first, earlier ones next, later ones locked after them; a stage's fields leave the other sections", () => {
  const base = sectionsOf(JOURNEY, undefined, undefined);
  const out = withStages(JOURNEY, base, jstages, "review", []);
  assert.deepEqual(out.slice(0, 4).map((x) => [x.key, x.stage?.state]), [["stage-review", "current"], ["stage-intake", "past"], ["stage-paid", "locked"], ["stage-done", "locked"]]);
  assert.deepEqual(out.filter((x) => x.stage?.state === "locked").map((x) => [x.folded, x.stage?.opensAt]), [[true, "Paid"], [true, "Done"]]);
  assert.ok(!out.slice(4).some((x) => x.fields.some((fd) => ["source", "reviewer", "invoice", "note"].includes(fd.key))), "the stage fields are not drawn twice");
  assert.equal(withStages(JOURNEY, base, [{ key: "intake", title: "Intake", order: 0 }], "intake", []).length, base.length, "a stage with no fields makes no group");
  assert.equal(withStages(JOURNEY, base, jstages, "intake", ["stage-intake"])[0]!.folded, true, "a person can fold the current group");
});

test("a Journey record's page: the current stage's group leads and is lit, later groups are locked with their opening stage", async () => {
  const restore = installDom();
  const b = await mounted(journeyPage("review"));
  try {
    const order = ["section-stage-review", "section-stage-intake", "section-stage-paid", "section-stage-done"];
    const sheet = textOf(find(b.root, "record-sheet"));
    const at = order.map((id) => { assert.ok(find(b.root, id), id); return sheet.indexOf(textOf(find(b.root, id))); });
    assert.ok(at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1]!)), "in that order");
    assert.match(textOf(find(b.root, "section-stage-review")), /This stage/);
    assert.match(textOf(find(b.root, "section-stage-review")), /Reviewer/);
    assert.match(textOf(find(b.root, "section-stage-intake")), /Referral/, "an earlier stage shows its fields");
    for (const k of ["paid", "done"]) {
      const sec = find(b.root, `section-stage-${k}`)!;
      assert.match(textOf(find(b.root, `opens-stage-${k}`)), /Opens at/);
      assert.ok(!/INV-9|Invoice number|Closing note/.test(textOf(sec)), "a locked group shows no fields");
      assert.equal(find(b.root, `fold-stage-${k}`)!.props.disabled, true, "and cannot be opened");
    }
    assert.match(textOf(find(b.root, "opens-stage-paid")), /Opens at Paid/);
    assert.match(textOf(find(b.root, "opens-stage-done")), /Opens at Done/);
  } finally { await b.stop(); restore(); }
});

test("when the record moves on, the lit group moves with it", async () => {
  const restore = installDom();
  const b = await mounted(journeyPage("paid"));
  try {
    assert.match(textOf(find(b.root, "section-stage-paid")), /This stage/);
    assert.match(textOf(find(b.root, "section-stage-review")) + textOf(find(b.root, "section-stage-intake")), /Maya[\s\S]*Referral|Referral[\s\S]*Maya/);
    assert.match(textOf(find(b.root, "opens-stage-done")), /Opens at Done/);
    assert.equal(find(b.root, "opens-stage-paid"), null, "the current stage is not locked");
  } finally { await b.stop(); restore(); }
});
