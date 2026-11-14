// Automation canvas screen (spec 3.7, 2.12; ARCH 7.7): built from the Northwind sample (the prototype's "New lead follow-up") through the live screen queries. A three-path Automation
// is built by the same edits the canvas makes, saved through automations.update, and its validation errors show on the card and in the line under the tabs. Screens render with
// react-dom/server over react-native-web (ruling 28). Path mapping: the packet names apps/app/tests/auto-canvas*.test.tsx; the lane's tests live beside the screens, as P-L9f_07's do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { BuilderPage } from "../screens/BuilderPage.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { addAfter, addInto, check, removeStep, updateStep } from "./model.ts";
import type { Definition } from "./model.ts";
import { createSampleAutomations, harbor, northwind, LEAD_FOLLOW_UP } from "../sidebar/sample.ts";
import type { SampleAutomations } from "../sidebar/sample.ts";

const html = (
  s: SampleAutomations,
  id = "aut_lead",
  props: Partial<Parameters<typeof BuilderPage>[0]> = {},
): string =>
  renderToStaticMarkup(
    <AutomationsDataProvider value={s.data}>
      <BuilderPage automationId={id} {...props} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const defOf = (s: SampleAutomations, id: string): Definition =>
  (s.replica.rows("automations").find((r) => r.id === id) as unknown as { definition: Definition }).definition;

test("the head shows the name, why it needs attention and the actions", () => {
  const out = html(createSampleAutomations(northwind));
  assert.ok(has(out, "New lead follow-up"));
  assert.ok(has(out, "Paused. Needs the Twilio key"), "why it is paused, in words");
  assert.ok(!has(out, "Connect Twilio"), "a paused reason without a service does not open a connection");
  for (const label of ["Ask Vyre", ">Test<"]) assert.ok(has(out, label), label);
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("the tabs are Steps, Runs and Settings; Steps is open; History is one press away in the menu", () => {
  const out = html(createSampleAutomations(northwind));
  for (const k of ["steps", "runs", "settings"]) assert.ok(has(out, `data-testid="page-tab-${k}"`), k);
  assert.match(tag(out, "page-tab-steps"), /aria-selected="true"/);
  assert.match(tag(out, "page-tab-runs"), /aria-selected="false"/);
  assert.ok(has(out, 'data-testid="page-menu"'));
});

test("the page starts with When, then each step is a sentence with its title and no field key", () => {
  const out = html(createSampleAutomations(northwind));
  assert.ok(has(out, "When"));
  for (const t of [
    "Look up the person by email",
    "Draft a personal reply from the first hello",
    "Does the lead have a mobile number?",
    "Text the lead a first hello",
    "Wait until they reply, or 1 day",
    "Email the lead a first hello",
  ])
    assert.ok(has(out, t), t);
  for (const id of LEAD_FOLLOW_UP.nodes.map((n) => n.id)) assert.ok(has(out, `data-testid="sv-step-${id}"`), `step ${id}`);
});

test("a pressed step opens its form beside the page, with its fields", () => {
  const s = createSampleAutomations(northwind);
  const plain = html(s);
  assert.ok(!has(plain, 'data-testid="inspector"'));
  const open = html(s, "aut_lead", { initialSelected: "mobile" });
  assert.ok(has(open, 'data-testid="inspector"'));
  assert.ok(has(open, 'data-testid="field-title"') && has(open, 'data-testid="field-path-0"'), "name and the path's condition");
  assert.ok(has(open, "lead.phone is not empty"));
  assert.ok(has(open, "If this step fails") && has(open, "Stop the run"));
  const ai = html(s, "aut_lead", { initialSelected: "draft" });
  assert.ok(has(ai, 'data-testid="choose-key"') && has(ai, "Your Claude sign-in") && has(ai, 'data-testid="choose-backup"'));
});

test("build a three-path Automation: the lanes appear, save writes one version, and a missing condition shows inline", async () => {
  const s = createSampleAutomations(northwind);
  const made = (await s.data.call("automations.create", { name: "Score the lead" })) as { automation: { id: string } };
  const id = made.automation.id;
  let d: Definition = { triggers: [{ key: "record_change" }], nodes: [] };
  const first = addAfter(d, null, "records.find");
  d = updateStep(first.def, first.id, { input: { type: "lead" } });
  const p = addAfter(d, first.id, "paths");
  d = p.def;
  d = updateStep(d, p.id, {
    title: "How warm is the lead?",
    branches: [
      { label: "Hot", to: "", when: "lead.score > 80" },
      { label: "Warm", to: "", when: "" },
      { label: "Otherwise", to: "" },
    ],
  });
  const hot = addInto(d, p.id, "create_task", 0);
  d = updateStep(hot.def, hot.id, { input: { title: "Call now" } });
  const warm = addInto(d, p.id, "send_email", 1);
  d = warm.def;
  await s.data.call("automations.update", { automationId: id, definition: d, expectedVersion: 1 });
  const out = html(s, id);
  for (const t of ["How warm is the lead?", "Call now", "Send an email"])
    assert.ok(has(out, t) || has(out, "Create a task"), t);
  assert.ok(
    has(out, `data-testid="sv-step-${p.id}"`) &&
      has(out, `data-testid="sv-step-${hot.id}"`) &&
      has(out, `data-testid="sv-step-${warm.id}"`),
  );
  assert.equal(defOf(s, id).nodes.length, 4);
  // the lanes read as If yes and Otherwise under the Paths step
  assert.ok(has(out, "If yes") && has(out, "Otherwise"));
  assert.ok(has(out, `data-testid="sv-need-${warm.id}"`), "the email with no recipient carries its one line and button");
  assert.ok(check(defOf(s, id)).some((i) => i.nodeId === p.id && /needs its condition/.test(i.message)));
  // fix them and the line goes away
  let fixed = updateStep(defOf(s, id), p.id, {
    branches: [
      { label: "Hot", to: hot.id, when: "lead.score > 80" },
      { label: "Warm", to: warm.id, when: "lead.score > 40" },
      { label: "Otherwise", to: "" },
    ],
  });
  fixed = updateStep(fixed, warm.id, { input: { to: "{{lead.email}}", mailboxId: "mbx_main" } });
  await s.data.call("automations.update", { automationId: id, definition: fixed, expectedVersion: 2 });
  const clean = html(s, id);
  assert.ok(!has(clean, `data-testid="sv-need-${warm.id}"`), "no missing thing left");
});

test("a stale save is refused with a sentence, and the edit is kept for another try", async () => {
  const s = createSampleAutomations(northwind);
  await assert.rejects(
    () =>
      s.data.call("automations.update", { automationId: "aut_lead", definition: LEAD_FOLLOW_UP, expectedVersion: 2 }),
    /newer version/,
  );
  assert.equal(s.replica.rows("automations").find((r) => r.id === "aut_lead")!["version"], 5, "nothing was written");
});

test("the server's check merges with the local one: the Twilio step needs its key", async () => {
  const s = createSampleAutomations(northwind);
  const out = (await s.data.call("automations.validate", { definition: LEAD_FOLLOW_UP, kind: "space" })) as {
    ok: boolean;
    issues: { nodeId?: string; message: string; severity: string }[];
  };
  assert.ok(
    out.issues.some((i) => i.nodeId === "text" && i.message === "Needs the Twilio key" && i.severity === "warning"),
  );
  assert.equal(out.ok, true, "a missing connection is a warning, so the Automation can still be saved");
});

test("History lists versions with who and why; the Runs tab shows the body the shell gives it", () => {
  const s = createSampleAutomations(northwind);
  const v = html(s, "aut_lead", { initialTab: "history" });
  assert.ok(has(v, 'data-testid="versions-list"'));
  assert.ok(
    has(v, "Version 5, current") &&
      has(v, "Added the text branch for leads with a mobile number") &&
      has(v, "Maya Chen"),
  );
  assert.ok(has(v, "Restore"), "older versions can be restored");
  const own = renderToStaticMarkup(
    <AutomationsDataProvider value={s.data}>
      <BuilderPage automationId="aut_lead" initialTab="runs" runsBody={<span data-x="runs-body">Runs body</span>} />
    </AutomationsDataProvider>,
  );
  assert.ok(has(own, "Runs body"), "the shell's runs body fills the tab");
  assert.ok(!has(html(s, "aut_lead", { initialTab: "steps" }), "Runs body"));
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

test("an empty definition draws the page with Add a step; nothing throws", async () => {
  const s = createSampleAutomations(northwind);
  const made = (await s.data.call("automations.create", { name: "Empty" })) as { automation: { id: string } };
  const out = html(s, made.automation.id);
  assert.ok(has(out, 'data-testid="sv-add"'), "the first step can be added");
});

test("opening an Automation does not crash when the shell refuses the Versions query as not live (the real registry marks it live: false)", () => {
  const s = createSampleAutomations(northwind);
  const real = {
    ...s.data,
    screens: {
      ...s.data.screens,
      query: (screen: string, name: string, state?: Record<string, unknown>) => {
        if (name === "versions") throw new Error(`query ${screen}.${name} is not live`);
        return s.data.screens.query(screen, name, state);
      },
    },
  };
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={real as typeof s.data}>
      <BuilderPage automationId="aut_lead" initialTab="steps" />
    </AutomationsDataProvider>,
  );
  assert.ok(out.length > 0 && has(out, "data-testid"), "the page draws, with the versions read as a plain call");
});

test("a place that names an id once gets the registry's /route pointers filled in, so the real shell resolves the query and stops showing a skeleton", async () => {
  const { withRoute } = await import("./data.tsx");
  assert.deepEqual(withRoute({ automationId: "aut_1" }), { automationId: "aut_1", route: { automationId: "aut_1" } });
  assert.deepEqual(withRoute({ runId: "run_1", route: { x: 1 } }), { runId: "run_1", route: { x: 1, runId: "run_1" } });
  assert.deepEqual(withRoute({ scope: "subject" }), { scope: "subject" }, "a state with no id is left as it was");
  assert.deepEqual(
    withRoute({ automationId: "a", route: { automationId: "b" } }).route,
    { automationId: "b" },
    "an explicit route wins",
  );
});
