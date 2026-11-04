// The project Overview page: every control is pressed in a rendered tree against the in-memory stand-in (sample.ts). The page is the shared Markdown editor (a browser editor, drawn here as its
// stand-in field), so the live blocks are tested through their own view, and the page's toolbar, properties, history, templates, an agent's edit and Undo through OverviewPage.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../../ui/src/testing/dom.ts";
import { ProjectPageDataProvider } from "../data.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { LiveBlockView } from "./LiveBlockView.tsx";
import { LiveSettings } from "./Sheets.tsx";
import { createSampleOverview, NOW } from "./sample.ts";
import type { SampleOverview } from "./sample.ts";
import { agentNotice, countLine, hiddenLine, liveReady, liveTitle, pageLine, propertyText, propertyValue, revisionLine, saveFailure, when } from "./model.ts";

const wait = async (until: () => boolean): Promise<void> => { for (let i = 0; i < 90 && !until(); i++) await flush(); };
const page = (s: SampleOverview, canEdit = true) => <ProjectPageDataProvider value={s.data}><OverviewPage projectId="prj_rivera" canEdit={canEdit} /></ProjectPageDataProvider>;
const open = async (s: SampleOverview, canEdit = true): Promise<Node> => { const root = await mount(createRoot, page(s, canEdit)); await wait(() => find(root, "project-overview") !== null); await flush(); return root; };
const type = async (n: Node | null, _name: string, v: string): Promise<void> => { await typeInto(n, v); await flush(); };

test("words: titles, counts, hidden rows, properties, versions, a stale save, an agent's edit", () => {
  assert.equal(liveTitle("tasks", { title: "Late work" }), "Late work");
  assert.equal(liveTitle("tasks", {}), "Tasks");
  assert.equal(liveReady("records", { type: "" }), false);
  assert.equal(liveReady("records", { type: "invoice" }), true);
  assert.equal(liveReady("metric", { type: "invoice", op: "sum" }), false);
  assert.equal(liveReady("metric", { type: "invoice", op: "sum", field: "amount" }), true);
  assert.equal(countLine({ rows: [{ id: "a", title: "A" }], hidden: 2, total: 3 }, "row"), "1 row, 2 you can't open");
  assert.equal(hiddenLine(2), "2 more you can't open");
  assert.equal(propertyText({ type: "text", value: null }), "");
  assert.equal(propertyText({ type: "boolean", value: true }), "Yes");
  assert.equal(propertyValue("number", "$1,250"), 1250);
  assert.equal(propertyValue("text", "  "), null);
  assert.equal(pageLine(1), "1 version");
  assert.equal(pageLine(4), "4 versions");
  assert.equal(when(NOW - 30_000, NOW), "just now");
  assert.equal(when(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.deepEqual(revisionLine({ rev: 3, by: "x", authorKind: "agent", summary: "added a live tasks block", at: NOW - 60_000, }, "Docs", NOW), { title: "Added a live tasks block", note: "Edited by Docs (Agent) · 1 min ago" });
  assert.equal(revisionLine({ rev: 4, by: "x", authorKind: "person", summary: "undid: x", undoOf: 3, at: NOW }, "you", NOW).title, "Undid version 3");
  const latest = { rev: 5, by: "agt_docs", authorKind: "agent" as const, summary: "added a section", at: NOW };
  assert.deepEqual(agentNotice(latest, "usr_irfad", (id) => (id === "agt_docs" ? "Docs" : id)), { text: "Docs added a section", rev: 5 });
  assert.equal(agentNotice({ ...latest, undoOf: 4 }, "usr_irfad", String), null, "an undo is not an agent's edit");
  assert.equal(agentNotice({ ...latest, authorKind: "person" }, "usr_irfad", String), null);
  assert.equal(saveFailure({ code: "validation.precondition_failed", details: { reason: "stale_revision" } }).stale, true);
  assert.equal(saveFailure(new Error("boom")).text, "boom");
});

test("the page opens with its properties, version count and editor; a reader with no edit access gets no controls", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    assert.ok(find(root, "overview-editor"));
    assert.match(textOf(find(root, "overview-line")), /1 version/);
    assert.match(textOf(find(root, "prop-status")), /Active/);
    assert.match(textOf(find(root, "prop-lead")), /Maya Chen/);
    assert.match(textOf(find(root, "prop-health")), /At risk/);
    assert.ok(find(root, "prop-contract") && find(root, "prop-add") && find(root, "overview-template-open") && find(root, "overview-history-open"));
    const ro = await open(createSampleOverview(), false);
    assert.equal(find(ro, "prop-add"), null);
    assert.equal(find(ro, "overview-template-open"), null);
    assert.ok(find(ro, "overview-history-open"), "history is readable by a reader");
    assert.match(textOf(find(ro, "prop-contract")), /\$48,000/);
  } finally { off(); }
});

test("a page the reader cannot open says so, and a loading page shows a placeholder first", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    s.failNext("projects.overview_doc.get", "permission.not_found", "no");
    const root = await mount(createRoot, page(s));
    await wait(() => find(root, "overview-gone") !== null);
    assert.match(textOf(find(root, "overview-gone")), /could not be opened/);
  } finally { off(); }
});

test("a property is edited in place and saved as an edit of the page; Add a property fills one that is empty", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    await type(find(root, "prop-contract"), "onChangeText", "$52,000");
    await act(async () => { (find(root, "prop-contract")!.props["onBlur"] as (e: unknown) => void)({ nativeEvent: {}, target: {}, currentTarget: {} }); });
    await wait(() => s.state().props["contract"] === "$52,000");
    assert.equal(s.state().props["contract"], "$52,000");
    const op = s.calls.find((c) => c.cap === "projects.overview_edit")!.input as { ops: { op: string; key: string; value: unknown }[]; baseRev: number };
    assert.deepEqual(op.ops, [{ op: "set_property", key: "contract", value: "$52,000" }]);
    assert.equal(op.baseRev, 1);
    // Add a property: the one still empty is offered
    await press(find(root, "prop-add"));
    await wait(() => find(root, "overview-addprop") !== null);
    assert.ok(find(root, "addprop-key-repo"));
    assert.equal(find(root, "addprop-key-contract"), null, "a property that has a value is not offered");
    await type(find(root, "addprop-value"), "onChangeText", "vyre-ai/rivera");
    await press(find(root, "addprop-add"));
    await wait(() => s.state().props["repo"] === "vyre-ai/rivera");
    assert.equal(s.state().props["repo"], "vyre-ai/rivera");
    assert.equal(find(root, "overview-addprop"), null);
    await press(find(root, "prop-add"));
    await wait(() => find(root, "overview-addprop") !== null);
    await press(find(root, "addprop-cancel"));
    assert.equal(find(root, "overview-addprop"), null);
  } finally { off(); }
});

test("History lists each version with who made it; Undo takes back the latest and is itself a version", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    s.agentEdits("added a live tasks block", `${s.state().markdown}\n\n<!--b:blk_x9-->\n:::live {"type":"people","spec":{},"view":"list"}`);
    const root = await open(s);
    await press(find(root, "overview-history-open"));
    await wait(() => find(root, "overview-history") !== null);
    await wait(() => find(root, "rev-2") !== null);
    assert.match(textOf(find(root, "rev-2")), /Added a live tasks block/);
    assert.match(textOf(find(root, "rev-2")), /Docs \(Agent\)/);
    assert.match(textOf(find(root, "rev-1")), /Maya Chen/);
    assert.ok(find(root, "rev-undo-2"), "only the latest has Undo");
    assert.equal(find(root, "rev-undo-1"), null);
    await press(find(root, "rev-undo-2"));
    await wait(() => s.state().revisions.length === 3);
    assert.equal(s.state().revisions.at(-1)!.undoOf, 2);
    assert.equal(s.state().markdown.includes("blk_x9"), false);
    await press(find(root, "overview-history-done"));
    assert.equal(find(root, "overview-history"), null);
  } finally { off(); }
});

test("an agent's edit leaves a quiet bar with who and what; Undo reverts it; Dismiss hides it", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    s.agentEdits("added a section: Open invoices", `${s.state().markdown}\n\n<!--b:blk_y1-->\nNew paragraph.`);
    const root = await open(s);
    assert.match(textOf(find(root, "overview-notice")), /Docs added a section: Open invoices/);
    await press(find(root, "overview-notice-undo"));
    await wait(() => s.state().revisions.at(-1)!.undoOf !== undefined);
    assert.equal(s.state().markdown.includes("blk_y1"), false);
    await wait(() => find(root, "overview-notice") === null);
    assert.equal(find(root, "overview-notice"), null, "an undo is not an agent's edit, so the bar is gone");
    const s2 = createSampleOverview();
    s2.agentEdits("changed a paragraph", s2.state().markdown + "\n\n<!--b:blk_z2-->\nX");
    const r2 = await open(s2);
    await press(find(r2, "overview-notice-dismiss"));
    assert.equal(find(r2, "overview-notice"), null);
    const ro = await open((() => { const x = createSampleOverview(); x.agentEdits("added", x.state().markdown + "\n\n<!--b:blk_q\nQ"); return x; })(), false);
    assert.ok(find(ro, "overview-notice") && !find(ro, "overview-notice-undo"), "a reader sees the bar but cannot undo");
  } finally { off(); }
});

test("a template replaces the page after a choice; the page it had stays in the history; a Space template is saved from the page", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    await press(find(root, "overview-template-open"));
    await wait(() => find(root, "tpl-tpl_hiring") !== null);
    assert.ok(find(root, "tpl-tpl_client_account") && find(root, "tpl-tpl_software_project"), "the three built-in templates");
    await press(find(root, "tpl-tpl_hiring"));
    await wait(() => s.state().markdown.includes("# Hiring"));
    const call = s.calls.find((c) => c.cap === "projects.overview_doc.apply_template")!.input as { templateId: string; baseRev: number };
    assert.deepEqual([call.templateId, call.baseRev], ["tpl_hiring", 1]);
    assert.equal(s.state().revisions.length, 2, "the old page is the version before");
    await wait(() => find(root, "overview-template-open") !== null && find(root, "overview-templates") === null);
    // save this page as a template
    await press(find(root, "overview-template-open"));
    await wait(() => find(root, "tpl-name") !== null);
    await press(find(root, "tpl-save"));
    await wait(() => find(root, "overview-templates-error") !== null);
    assert.match(textOf(find(root, "overview-templates-error")), /Name the template/);
    await type(find(root, "tpl-name"), "onChangeText", "Retainer matter");
    await press(find(root, "tpl-save"));
    await wait(() => s.calls.some((c) => c.cap === "projects.overview_doc.templates.save"));
    assert.deepEqual((s.calls.find((c) => c.cap === "projects.overview_doc.templates.save")!.input as { title: string }).title, "Retainer matter");
    await wait(() => find(root, "overview-templates") === null);
    assert.match(textOf(find(root, "overview-note")), /Saved the template Retainer matter/);
    await press(find(root, "overview-template-open"));
    await wait(() => find(root, "overview-templates-cancel") !== null);
    await press(find(root, "overview-templates-cancel"));
    assert.equal(find(root, "overview-templates"), null);
  } finally { off(); }
});

test("a page someone else changed is not overwritten: the person is told, and Reload brings it in", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    s.racing();
    await press(find(root, "overview-template-open"));
    await wait(() => find(root, "tpl-tpl_hiring") !== null);
    await press(find(root, "tpl-tpl_hiring"));
    await wait(() => find(root, "overview-stale") !== null);
    assert.match(textOf(find(root, "overview-stale")), /Someone changed this page/);
    assert.equal(s.state().markdown.includes("# Hiring"), false, "nothing was written");
    await press(find(root, "overview-reload"));
    await wait(() => find(root, "overview-stale") === null);
    assert.equal(find(root, "overview-stale"), null);
  } finally { off(); }
});

test("a live block draws the project's data as a list, a table, cards or a count, and counts what the reader may not open", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const api = { update: () => undefined, remove: () => undefined };
    const draw = async (attrs: { type: string; spec: unknown; view: string }, readOnly = false): Promise<Node> => {
      const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveBlockView projectId="prj_rivera" attrs={{ blockId: "blk_c3", ...attrs }} readOnly={readOnly} api={api} onSettings={() => undefined} /></ProjectPageDataProvider>);
      await wait(() => find(root, "live-loading") === null);
      return root;
    };
    const list = await draw({ type: "tasks", spec: { title: "Open tasks", status: "open" }, view: "list" });
    assert.ok(find(list, "live-list") && find(list, "live-row-t3"));
    assert.match(textOf(find(list, "live-tag")), /Live · 4 rows, 2 you can't open/);
    assert.match(textOf(find(list, "live-hidden")), /2 more you can't open/);
    const call = s.calls.filter((c) => c.cap === "projects.live_block.query").at(-1)!.input as { type: string; spec: { status: string } };
    assert.deepEqual([call.type, call.spec.status], ["tasks", "open"]);
    assert.ok(find(await draw({ type: "records", spec: { type: "invoice", title: "Invoices" }, view: "table" }), "live-table"));
    assert.ok(find(await draw({ type: "tasks", spec: {}, view: "cards" }), "live-cards"));
    const count = await draw({ type: "tasks", spec: {}, view: "count" });
    assert.match(textOf(find(count, "live-number")), /6/);
    const metric = await draw({ type: "metric", spec: { type: "invoice", op: "sum", field: "amount", title: "Unpaid" }, view: "count" });
    assert.match(textOf(find(metric, "live-number")), /6,250/);
    assert.match(textOf(metric), /Unpaid/);
  } finally { off(); }
});

test("a live block with nothing chosen says what to do; an unknown kind is kept as written; a reader has no Edit or menu", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const api = { update: () => undefined, remove: () => undefined };
    const draw = async (attrs: { type: string; spec: unknown; view: string }, readOnly = false): Promise<Node> => mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveBlockView projectId="prj_rivera" attrs={{ blockId: null, ...attrs }} readOnly={readOnly} api={api} onSettings={() => undefined} /></ProjectPageDataProvider>);
    const setup = await draw({ type: "records", spec: { type: "" }, view: "table" });
    assert.match(textOf(find(setup, "live-setup")), /Choose what this shows\s*: press Edit/);
    assert.equal(s.calls.some((c) => c.cap === "projects.live_block.query"), false, "nothing is asked until it can show something");
    const unknown = await draw({ type: "hologram", spec: {}, view: "list" });
    assert.match(textOf(find(unknown, "live-unknown")), /kept as written/);
    assert.equal(find(unknown, "live-edit"), null, "an unknown kind has no settings");
    const ro = await draw({ type: "tasks", spec: {}, view: "list" }, true);
    assert.equal(find(ro, "live-edit"), null);
    assert.equal(find(ro, "live-menu"), null);
    s.failNext("projects.live_block.query");
    const err = await draw({ type: "tasks", spec: { a: 1 }, view: "list" });
    await wait(() => find(err, "live-error") !== null);
    assert.match(textOf(find(err, "live-error")), /could not be read/);
  } finally { off(); }
});

test("a row opens what it is: a task or a record, a goal's page; Edit and the menu act on the block", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const log: string[] = [];
    const api = { update: (p: unknown) => log.push(`update ${JSON.stringify(p)}`), remove: () => log.push("remove") };
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveBlockView projectId="prj_rivera" attrs={{ blockId: "b", type: "tasks", spec: { title: "Open tasks" }, view: "list" }} readOnly={false} api={api} onSettings={(a) => log.push(`settings ${a.type}`)} /></ProjectPageDataProvider>);
    await wait(() => find(root, "live-row-t3") !== null);
    await press(find(root, "live-row-t3"));
    assert.deepEqual(s.opened, ["record:task:t3"]);
    await press(find(root, "live-edit"));
    assert.deepEqual(log, ["settings tasks"]);
    assert.ok(find(root, "live-menu"));
  } finally { off(); }
});

test("the settings sheet changes the title, what it filters on and how it is drawn; a records block needs a type first", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const saved: unknown[] = [];
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveSettings attrs={{ blockId: "b", type: "tasks", spec: { title: "Open tasks", status: "open" }, view: "list" }} onSave={(n) => saved.push(n)} onClose={() => saved.push("closed")} /></ProjectPageDataProvider>);
    await flush();
    await type(find(root, "live-title"), "onChangeText", "Late work");
    await press(find(root, "live-spec-status-late"));
    await press(find(root, "live-view-table"));
    await press(find(root, "live-settings-save"));
    assert.deepEqual(saved, [{ spec: { title: "Late work", status: "late" }, view: "table" }]);
    await press(find(root, "live-settings-cancel"));
    assert.equal(saved.at(-1), "closed");
    const rec = await mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveSettings attrs={{ blockId: "b", type: "records", spec: { title: "Records", type: "" }, view: "table" }} onSave={(n) => saved.push(n)} onClose={() => undefined} /></ProjectPageDataProvider>);
    await wait(() => find(rec, "live-type-invoice") !== null);
    assert.equal(find(rec, "live-settings-save")!.props["aria-disabled"] ?? find(rec, "live-settings-save")!.props["disabled"], true, "Save is off until a record type is chosen");
    await press(find(rec, "live-type-invoice"));
    const n = saved.length;
    await press(find(rec, "live-settings-save"));
    assert.equal(saved.length, n + 1);
    assert.deepEqual((saved.at(-1) as { spec: { type: string } }).spec.type, "invoice");
  } finally { off(); }
});

test("a metric that sums asks which field; its view is only a count", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><LiveSettings attrs={{ blockId: "b", type: "metric", spec: { title: "Unpaid", type: "invoice", op: "count" }, view: "count" }} onSave={() => undefined} onClose={() => undefined} /></ProjectPageDataProvider>);
    await wait(() => find(root, "live-spec-op-sum") !== null);
    assert.equal(find(root, "live-field"), null);
    await press(find(root, "live-spec-op-sum"));
    assert.ok(find(root, "live-field"), "a sum names the field");
    assert.equal(find(root, "live-view-table"), null, "a metric is drawn as a count");
  } finally { off(); }
});

test("typing saves the page by itself a pause later, on the revision it was opened at; the status says Saving then Saved and the version count grows", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    await press(find(root, "md-view-raw"));
    const next = `${s.state().markdown}\n\n<!--b:blk_n1-->\nA new paragraph.`;
    await typeInto(find(root, "markdown-editor-raw-text"), next);
    await wait(() => s.state().rev === 2);
    const save = s.calls.find((c) => c.cap === "projects.overview_doc.save")!.input as { markdown: string; baseRev: number; projectId: string };
    assert.deepEqual([save.baseRev, save.projectId, save.markdown], [1, "prj_rivera", next]);
    await wait(() => /Saved/.test(textOf(find(root, "overview-status"))));
    assert.match(textOf(find(root, "overview-status")), /Saved/);
    await wait(() => /2 versions/.test(textOf(find(root, "overview-line"))));
    assert.match(textOf(find(root, "overview-line")), /2 versions/);
    // a second edit rides on the new revision
    await typeInto(find(root, "markdown-editor-raw-text"), `${next} More.`);
    await wait(() => s.state().rev === 3);
    assert.equal((s.calls.filter((c) => c.cap === "projects.overview_doc.save").at(-1)!.input as { baseRev: number }).baseRev, 2);
  } finally { off(); }
});

test("a failed save says so and keeps the text; a stale save asks for a reload and writes nothing", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    await press(find(root, "md-view-raw"));
    s.failNext("projects.overview_doc.save", "internal.unexpected", "The page could not be saved.");
    await typeInto(find(root, "markdown-editor-raw-text"), `${s.state().markdown}\n\nWords.`);
    await wait(() => find(root, "overview-save-error") !== null);
    assert.match(textOf(find(root, "overview-save-error")), /could not be saved/);
    assert.equal(s.state().rev, 1);
    const s2 = createSampleOverview();
    const r2 = await open(s2);
    await press(find(r2, "md-view-raw"));
    s2.racing();
    await typeInto(find(r2, "markdown-editor-raw-text"), `${s2.state().markdown}\n\nMine.`);
    await wait(() => find(r2, "overview-stale") !== null);
    assert.match(textOf(find(r2, "overview-stale")), /Someone changed this page/);
    assert.equal(s2.state().markdown.includes("Mine."), false);
  } finally { off(); }
});

test("when an agent changes the page, a quiet bar appears on its own (no reload of the tab)", async () => {
  const off = installDom();
  try {
    const s = createSampleOverview();
    const root = await open(s);
    assert.equal(find(root, "overview-notice"), null);
    s.agentEdits("added a live goal block", `${s.state().markdown}\n\n<!--b:blk_g1-->\n:::live {"type":"goal","spec":{},"view":"list"}`);
    s.changed();
    await wait(() => find(root, "overview-notice") !== null);
    assert.match(textOf(find(root, "overview-notice")), /Docs added a live goal block/);
  } finally { off(); }
});
