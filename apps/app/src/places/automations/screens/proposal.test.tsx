// Building by asking, on the page (AUTOMATIONS-BUILD-RC29 phase 2; design AUTOMATIONS-2026-11-13 2.7): what the Assistant proposed is drawn with one bar, Discard, Change, Accept.
// Nothing proposed is the Automation's until a person presses Accept.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

const PROPOSED = {
  triggers: [{ key: "manual" }],
  nodes: [
    { id: "p1", key: "tasks.create", title: "Create a task: Call back", input: { title: "Call back" }, next: ["p2"] },
    { id: "p2", key: "tasks.create", title: "Create a task: Send the quote", input: { title: "Send the quote" } },
  ],
};
const open = async (id: string) => {
  installDom();
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={s.data as never}>
      <BuilderPage automationId={id} />
    </AutomationsDataProvider>,
  );
  await flush();
  return { s, root };
};
const stored = (s: ReturnType<typeof createSampleAutomations>, id: string) =>
  s.replica.rows("automations").find((r) => r["id"] === id) as unknown as {
    version: number;
    definition: { nodes: { id: string }[] };
  };
const propose = async (s: ReturnType<typeof createSampleAutomations>, id: string): Promise<void> => {
  await s.data.call("automations.draft.propose", {
    automationId: id,
    definition: PROPOSED,
    summary: "Two tasks: call back, then send the quote.",
  });
  await flush();
};

test("an Off Automation: the proposal shows with its bar, the Automation is untouched, and Accept makes it the Automation's steps", async () => {
  const { s, root } = await open("aut_lead");
  const before = stored(s, "aut_lead");
  const was = JSON.stringify(before.definition);
  assert.equal(find(root, "sv-bar-Accept"), null, "no bar before anything is proposed");
  await propose(s, "aut_lead");
  assert.ok(find(root, "sv-bar-Accept"), "the bar offers Accept");
  assert.ok(find(root, "sv-bar-Change"));
  assert.ok(find(root, "sv-bar-Discard"));
  assert.match(textOf(root), /Assistant’s draft, 2 steps\. Nothing is on yet\./);
  assert.match(textOf(root), /Call back/, "the proposed steps are on the page");
  assert.equal(JSON.stringify(stored(s, "aut_lead").definition), was, "nothing proposed is saved");
  assert.equal(
    s.calls.filter((c) => c.cap === "automations.draft.save" || c.cap === "automations.update").length,
    0,
    "showing a proposal writes nothing",
  );
  await press(find(root, "sv-bar-Accept"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "automations.proposal.accept").length, 1);
  assert.deepEqual(
    stored(s, "aut_lead").definition.nodes.map((n) => n.id),
    ["p1", "p2"],
  );
  assert.equal(find(root, "sv-bar-Accept"), null, "the bar is gone");
});

test("an On Automation: Accept keeps the proposal as the person's draft; live does not move until Make live", async () => {
  const { s, root } = await open("aut_digest");
  const live = JSON.stringify(stored(s, "aut_digest").definition);
  const version = stored(s, "aut_digest").version;
  await propose(s, "aut_digest");
  await press(find(root, "sv-bar-Accept"));
  await flush();
  assert.equal(JSON.stringify(stored(s, "aut_digest").definition), live, "live is as it was");
  assert.equal(stored(s, "aut_digest").version, version);
  assert.ok(find(root, "sv-bar-Make live"), "the draft bar offers Make live");
  assert.equal(find(root, "sv-bar-Accept"), null);
});

test("Discard throws the proposal away and the page shows the Automation as it was", async () => {
  const { s, root } = await open("aut_lead");
  const was = JSON.stringify(stored(s, "aut_lead").definition);
  await propose(s, "aut_lead");
  await press(find(root, "sv-bar-Discard"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "automations.proposal.discard").length, 1);
  assert.equal(
    s.calls.filter((c) => c.cap === "automations.draft.discard").length,
    0,
    "the person's own draft is not what was discarded",
  );
  assert.equal(find(root, "sv-bar-Accept"), null);
  assert.equal(JSON.stringify(stored(s, "aut_lead").definition), was);
  assert.doesNotMatch(textOf(root), /Send the quote/);
});
