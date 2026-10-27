// Automation canvas screen (spec 3.7, 2.12; ARCH 7.7): built from the Northwind sample (the prototype's "New lead follow-up") through the live screen queries. A three-path Automation
// is built by the same edits the canvas makes, saved through automations.update, and its validation errors show on the card and in the line under the tabs. Screens render with
// react-dom/server over react-native-web (ruling 28). Path mapping: the packet names apps/app/tests/auto-canvas*.test.tsx; the lane's tests live beside the screens, as P-L9f_07's do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationCanvas } from "./AutomationCanvas.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { addAfter, addInto, check, removeStep, updateStep } from "./model.ts";
import type { Definition } from "./model.ts";
import { createSampleAutomations, harbor, northwind, LEAD_FOLLOW_UP } from "../sidebar/sample.ts";
import type { SampleAutomations } from "../sidebar/sample.ts";

const html = (s: SampleAutomations, id = "aut_lead", props: Partial<Parameters<typeof AutomationCanvas>[0]> = {}): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={s.data}><AutomationCanvas automationId={id} {...props} /></AutomationsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const defOf = (s: SampleAutomations, id: string): Definition => (s.replica.rows("automations").find((r) => r.id === id) as unknown as { definition: Definition }).definition;

test("the header shows the name, the Space, why it needs attention and the actions", () => {
  const out = html(createSampleAutomations(northwind));
  assert.ok(has(out, "New lead follow-up"));
  assert.ok(has(out, ">Space<"), "kind");
  assert.ok(has(out, "Needs the Twilio key"), "why it is paused");
  assert.ok(!has(out, "Connect Twilio"), "a paused reason without a service does not open a connection");
  for (const label of ["Paused", "Test run", "Ask", "Show the side pane", "More"]) assert.ok(has(out, label), label);
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("the tabs are Steps, Runs with its failed count, Versions with the version and Settings; Steps is open", () => {
  const out = html(createSampleAutomations(northwind));
  for (const k of ["steps", "runs", "versions", "settings"]) assert.ok(has(out, `data-testid="subtab-${k}"`), k);
  assert.ok(has(out, "1 failed"), "one failed run");
  assert.ok(has(out, "v5"));
  assert.match(tag(out, "subtab-steps"), /aria-selected="true"/);
  assert.match(tag(out, "subtab-runs"), /aria-selected="false"/);
});

test("the trigger card lists every trigger, then each step is a card with its title and what it does", () => {
  const out = html(createSampleAutomations(northwind));
  assert.ok(has(out, "Any one starts a run"));
  assert.ok(has(out, "A new lead is created") && has(out, "Only when Source is Meta"));
  assert.ok(has(out, "Client intake form is submitted") && has(out, "Every time"));
  for (const t of ["Look up the person by email", "Draft a personal reply from the first hello", "Does the lead have a mobile number?", "Text the lead a first hello", "Wait until they reply, or 1 day", "Email the lead a first hello"]) assert.ok(has(out, t), t);
  assert.ok(has(out, "Your Claude sign-in, then Northwind OpenAI key"), "the AI step names its key and backup");
  assert.ok(has(out, "1 path and Otherwise, first match wins"));
  for (const id of LEAD_FOLLOW_UP.nodes.map((n) => n.id)) assert.ok(has(out, `data-testid="card-${id}"`), `card ${id}`);
  assert.ok(has(out, "If "), "lane labels");
  assert.ok(has(out, "Otherwise"));
});

test("the zoom control shows the level and Fit, and the surface is labelled", () => {
  const out = html(createSampleAutomations(northwind));
  assert.ok(has(out, "84%"));
  assert.ok(has(out, 'aria-label="Fit to the window"'));
  assert.ok(has(out, 'aria-label="Zoom in"') && has(out, 'aria-label="Zoom out"'));
  assert.ok(has(out, 'aria-label="Automation steps"'));
  assert.ok(has(html(createSampleAutomations(northwind), "aut_lead", { initialZoom: 1 }), "100%"));
});

test("a selected card carries the accent ring; the step panel opens on it with its fields", () => {
  const s = createSampleAutomations(northwind);
  const plain = html(s);
  const sel = html(s, "aut_lead", { initialSelected: "mobile" });
  assert.ok(!has(plain, 'data-testid="inspector"'));
  assert.match(tag(sel, "card-mobile"), /aria-selected="true"/);
  assert.ok(!has(sel, 'data-testid="inspector"'), "selecting alone does not open the panel");
  const open = html(s, "aut_lead", { initialSelected: "mobile", initialPanel: true });
  assert.ok(has(open, 'data-testid="inspector"'));
  assert.ok(has(open, 'data-testid="field-title"') && has(open, 'data-testid="field-path-0"'), "name and the path's condition");
  assert.ok(has(open, "lead.phone is not empty"));
  assert.ok(has(open, "If this step fails") && has(open, "Stop the run"));
  const ai = html(s, "aut_lead", { initialSelected: "draft", initialPanel: true });
  assert.ok(has(ai, 'data-testid="choose-key"') && has(ai, "Your Claude sign-in") && has(ai, 'data-testid="choose-backup"'));
});

test("build a three-path Automation: the lanes appear, save writes one version, and a missing condition shows inline", async () => {
  const s = createSampleAutomations(northwind);
  const made = (await s.data.call("automations.create", { name: "Score the lead" })) as { automation: { id: string } };
  const id = made.automation.id;
  let d: Definition = { triggers: [{ key: "record_change" }], nodes: [] };
  const first = addAfter(d, null, "records.find"); d = updateStep(first.def, first.id, { input: { type: "lead" } });
  const p = addAfter(d, first.id, "paths"); d = p.def;
  d = updateStep(d, p.id, { title: "How warm is the lead?", branches: [{ label: "Hot", to: "", when: "lead.score > 80" }, { label: "Warm", to: "", when: "" }, { label: "Otherwise", to: "" }] });
  const hot = addInto(d, p.id, "create_task", 0); d = updateStep(hot.def, hot.id, { input: { title: "Call now" } });
  const warm = addInto(d, p.id, "send_email", 1); d = warm.def;
  await s.data.call("automations.update", { automationId: id, definition: d, expectedVersion: 1 });
  const out = html(s, id);
  for (const t of ["How warm is the lead?", "Call now", "Send an email"]) assert.ok(has(out, t) || has(out, "Create a task"), t);
  assert.ok(has(out, `data-testid="card-${p.id}"`) && has(out, `data-testid="card-${hot.id}"`) && has(out, `data-testid="card-${warm.id}"`));
  assert.equal(defOf(s, id).nodes.length, 4);
  assert.ok(has(out, "v2"), "one new version");
  // three lanes, three labels
  assert.ok(has(out, "If lead.score &gt; 80"));
  assert.ok(has(out, 'data-testid="problems"'), "errors are called out under the tabs");
  assert.ok(has(out, "things to fix before this can run") || has(out, "thing to fix before this can run"));
  assert.ok(has(out, `data-testid="issue-${p.id}"`), "the Paths card carries the warning");
  assert.ok(has(out, `data-testid="issue-${warm.id}"`), "so does the email with no recipient");
  assert.ok(check(defOf(s, id)).some((i) => i.nodeId === p.id && /needs its condition/.test(i.message)));
  // fix them and the line goes away
  let fixed = updateStep(defOf(s, id), p.id, { branches: [{ label: "Hot", to: hot.id, when: "lead.score > 80" }, { label: "Warm", to: warm.id, when: "lead.score > 40" }, { label: "Otherwise", to: "" }] });
  fixed = updateStep(fixed, warm.id, { input: { to: "{{lead.email}}" } });
  await s.data.call("automations.update", { automationId: id, definition: fixed, expectedVersion: 2 });
  const clean = html(s, id);
  assert.ok(!has(clean, 'data-testid="problems"'), "no errors left");
  assert.ok(has(clean, "v3"));
});

test("a stale save is refused with a sentence, and the edit is kept for another try", async () => {
  const s = createSampleAutomations(northwind);
  await assert.rejects(() => s.data.call("automations.update", { automationId: "aut_lead", definition: LEAD_FOLLOW_UP, expectedVersion: 2 }), /newer version/);
  assert.equal(s.replica.rows("automations").find((r) => r.id === "aut_lead")!["version"], 5, "nothing was written");
});

test("the server's check merges with the local one: the Twilio step needs its key", async () => {
  const s = createSampleAutomations(northwind);
  const out = (await s.data.call("automations.validate", { definition: LEAD_FOLLOW_UP, kind: "space" })) as { ok: boolean; issues: { nodeId?: string; message: string; severity: string }[] };
  assert.ok(out.issues.some((i) => i.nodeId === "text" && i.message === "Needs the Twilio key" && i.severity === "warning"));
  assert.equal(out.ok, true, "a missing connection is a warning, so the Automation can still be saved");
});

test("a run lights its lane and says which run is shown", () => {
  const s = createSampleAutomations(northwind);
  const out = html(s, "aut_lead", { run: { id: "run_b", label: "Lead from Meta: Marcus Pruitt", states: { find: "done", draft: "done", mobile: "done", email: "done", text: "skipped" } } });
  assert.ok(has(out, "Showing Lead from Meta: Marcus Pruitt"));
  assert.ok(has(out, 'data-testid="run-chip"'));
  assert.ok(has(out, 'aria-label="Stop showing this run"'));
});

test("the Versions tab lists versions with who and why; the Runs tab lists runs", () => {
  const s = createSampleAutomations(northwind);
  const v = html(s, "aut_lead", { initialTab: "versions" });
  assert.ok(has(v, 'data-testid="versions-list"'));
  assert.ok(has(v, "Version 5, current definition") && has(v, "Added the text branch for leads with a mobile number") && has(v, "Maya Chen"));
  assert.ok(has(v, "Restore"), "older versions can be restored");
  const r = html(s, "aut_lead", { initialTab: "runs" });
  assert.ok(has(r, 'data-testid="runs-list"'));
  assert.ok(has(r, "Text the lead failed: no Twilio key"));
  assert.ok(!has(html(s, "aut_lead", { initialTab: "steps" }), 'data-testid="runs-list"'));
  const own = renderToStaticMarkup(<AutomationsDataProvider value={s.data}><AutomationCanvas automationId="aut_lead" initialTab="settings" tabBodies={{ settings: <span data-x="settings-body">Settings body</span> }} /></AutomationsDataProvider>);
  assert.ok(has(own, "Settings body"), "another packet's body fills the tab");
});

test("Harbor Studio opens its own single-step Automation; a deleted Automation says it is not available", async () => {
  const h = createSampleAutomations(harbor);
  const out = html(h, "aut_h1");
  assert.ok(has(out, "Brief to project") && has(out, "Post the morning digest"));
  assert.ok(!has(out, "New lead follow-up"));
  const s = createSampleAutomations(northwind);
  await s.data.call("automations.delete", { automationId: "aut_lead" });
  assert.ok(has(html(s, "aut_lead"), "This Automation is not available"));
});

test("removing the step a lane starts with keeps the Automation connected", () => {
  const d = removeStep(LEAD_FOLLOW_UP, "text");
  assert.ok(!check(d).some((i) => /leads to a step that no longer exists/.test(i.message)));
});

test("an empty definition draws the trigger card and the first plus; nothing throws", async () => {
  const s = createSampleAutomations(northwind);
  const made = (await s.data.call("automations.create", { name: "Empty" })) as { automation: { id: string } };
  const out = html(s, made.automation.id);
  assert.ok(has(out, "Add a trigger"));
  assert.ok(has(out, "Add the first step"));
  assert.ok(has(out, "1 thing to fix before this can run"));
});
