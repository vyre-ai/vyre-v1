// The behaviours the old canvas had that must stay, driven through the new BuilderPage: Ask Vyre with the Automation, Test, Turn on, and the save with its expected version.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

const open = async (id: string, extra: Record<string, unknown> = {}) => {
  installDom();
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={s.data}>
      <BuilderPage automationId={id} {...extra} />
    </AutomationsDataProvider>,
  );
  await flush();
  return { s, root };
};
const caps = (s: ReturnType<typeof createSampleAutomations>, cap: string) => s.calls.filter((c) => c.cap === cap);

test("Ask Vyre opens the assistant with this Automation as its context, in one press", async () => {
  const { s, root } = await open("aut_lead");
  await press(find(root, "sv-ask"));
  assert.deepEqual(s.opened, ["ask:aut_lead"]);
});

// Changed for AUTOMATIONS-BUILD-RC29 (1f): Test tries the draft on a real past event and names it in the bar; it no longer sends an empty sample.
test("Test tries the Automation on a real past event and names it in the bar", async () => {
  const { s, root } = await open("aut_lead");
  await press(find(root, "sv-test"));
  await flush();
  const t = caps(s, "automations.test");
  assert.equal(t.length, 1);
  const input = t[0]!.input as { automationId: string; sample?: unknown; eventRunId?: string };
  assert.equal(input.automationId, "aut_lead");
  assert.equal(input.sample, undefined, "no empty sample");
  assert.equal(input.eventRunId, "run_past1", "the last real event");
  assert.match(textOf(root), /Test with Sam Reyes/);
  assert.match(textOf(root), /The test sent nothing/);
});

// Changed for AUTOMATIONS-BUILD-RC29 (1c): no Save button. An On Automation's edit is saved as a draft as you go, the bar offers Make live, and nothing is live until then.
test("an edit on an On Automation is saved as a draft as you go; Make live publishes it", async () => {
  const { s, root } = await open("aut_digest", { initialSelected: "post" });
  const del = find(root, "delete-step");
  assert.ok(del, "the step form is open on the step");
  await press(del);
  await new Promise((r) => setTimeout(r, 1100));
  await flush();
  assert.equal(caps(s, "automations.update").length, 0, "nothing went live");
  const d = caps(s, "automations.draft.save");
  assert.equal(d.length, 1, "the edit was saved as a draft");
  assert.equal((d[0]!.input as { expectedVersion: number }).expectedVersion, 2);
  assert.equal(find(root, "sv-bar-Save"), null, "there is no Save button");
  // the sample's Automation still has a step that needs something: Make live says so in one sentence and sends nothing
  await press(find(root, "sv-bar-Make live"));
  await flush();
  assert.equal(caps(s, "automations.make_live").length, 0, "a draft with something missing does not go live");
  assert.match(textOf(root), /Fix the problem before this goes live\./);
  await press(find(root, "sv-bar-Discard"));
  await flush();
  assert.equal(caps(s, "automations.draft.discard").length, 1, "Discard drops the draft on the server");
  assert.equal(find(root, "sv-bar-Make live"), null, "the bar is gone");
});
