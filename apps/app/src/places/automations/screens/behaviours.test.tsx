// The behaviours the old canvas had that must stay, driven through the new BuilderPage: Ask Vyre with the Automation, Test, Turn on, and the save with its expected version.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
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

test("Test runs the saved version with sample data and says nothing was sent", async () => {
  const { s, root } = await open("aut_lead");
  await press(find(root, "sv-test"));
  await flush();
  const t = caps(s, "automations.test");
  assert.equal(t.length, 1);
  assert.equal((t[0]!.input as { automationId: string }).automationId, "aut_lead");
  assert.ok(find(root, "builder-note"), "the person is told what started");
});

test("an edit on an On Automation waits for Save, then saves with the version it was made on", async () => {
  const { s, root } = await open("aut_digest", { initialSelected: "post" });
  const del = find(root, "delete-step");
  assert.ok(del, "the step form is open on the step");
  await press(del);
  await new Promise((r) => setTimeout(r, 1100));
  await flush();
  assert.equal(caps(s, "automations.update").length, 0, "an On Automation is not saved as you go");
  await press(find(root, "sv-bar-Save"));
  await flush();
  const u = caps(s, "automations.update");
  assert.equal(u.length, 1);
  assert.equal((u[0]!.input as { expectedVersion: number }).expectedVersion, 2);
});
