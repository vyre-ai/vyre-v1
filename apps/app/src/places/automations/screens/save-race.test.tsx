// Two people, one Automation: a draft carries the version it started on, every write sends that base, and a refused save overwrites nothing and is not retried on the new version. Plus the gating a person without the right sees.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

const OTHER = { triggers: [{ key: "manual" }], nodes: [] };
const open = async (id: string, extra: Record<string, unknown> = {}, tweak: (d: object) => object = (d) => d) => {
  installDom();
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={tweak(s.data) as never}>
      <BuilderPage automationId={id} {...extra} />
    </AutomationsDataProvider>,
  );
  await flush();
  return { s, root };
};
const updates = (s: ReturnType<typeof createSampleAutomations>) => s.calls.filter((c) => c.cap === "automations.update");
const stored = (s: ReturnType<typeof createSampleAutomations>, id: string) =>
  s.replica.rows("automations").find((r) => r["id"] === id) as unknown as { version: number; definition: unknown };

test("Off with autosave: another person saves while I hold a draft; mine is refused, theirs stays, and it is not retried on their version", async () => {
  const { s, root } = await open("aut_lead", { initialSelected: "draft" });
  const started = stored(s, "aut_lead").version;
  await press(find(root, "delete-step"));
  // a second writer saves on the version I started from, inside my 900 ms
  await s.data.call("automations.update", { automationId: "aut_lead", definition: OTHER, expectedVersion: started });
  await flush();
  await new Promise((r) => setTimeout(r, 1300));
  await flush();
  const mine = updates(s).filter((c) => (c.input as { definition?: unknown }).definition !== OTHER);
  assert.equal(mine.length, 1, "one attempt, no retry on the new version");
  assert.equal((mine[0]!.input as { expectedVersion: number }).expectedVersion, started, "the base is the version the draft started on");
  assert.deepEqual(stored(s, "aut_lead").definition, OTHER, "their save is still there");
  assert.equal(stored(s, "aut_lead").version, started + 1);
  assert.ok(find(root, "save-conflict"), "the page says someone else changed it");
});

test("On with Save: the same two writers; Save is refused, nothing is overwritten, and Keep mine as a copy keeps my edit", async () => {
  const { s, root } = await open("aut_digest", { initialSelected: "post" });
  const started = stored(s, "aut_digest").version;
  await press(find(root, "delete-step"));
  await s.data.call("automations.update", { automationId: "aut_digest", definition: OTHER, expectedVersion: started });
  await flush();
  await press(find(root, "sv-bar-Save"));
  await flush();
  const mine = updates(s).filter((c) => (c.input as { definition?: unknown }).definition !== OTHER);
  assert.equal(mine.length, 1);
  assert.equal((mine[0]!.input as { expectedVersion: number }).expectedVersion, started);
  assert.deepEqual(stored(s, "aut_digest").definition, OTHER);
  assert.ok(find(root, "save-conflict"));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(updates(s).length, 2, "autosave and retries stay stopped until the person chooses");
  await press(find(root, "conflict-copy"));
  await flush();
  const made = s.calls.filter((c) => c.cap === "automations.create");
  assert.equal(made.length, 1, "my edit is kept as a copy");
  assert.equal(find(root, "save-conflict"), null, "the choice clears the bar");
});

test("See theirs asks once, then discards my draft", async () => {
  const { s, root } = await open("aut_digest", { initialSelected: "post" });
  const started = stored(s, "aut_digest").version;
  await press(find(root, "delete-step"));
  await s.data.call("automations.update", { automationId: "aut_digest", definition: OTHER, expectedVersion: started });
  await flush();
  await press(find(root, "sv-bar-Save"));
  await flush();
  await press(find(root, "conflict-theirs"));
  assert.equal(find(root, "conflict-discard") !== null, true, "one confirm first");
  await press(find(root, "conflict-discard"));
  await flush();
  assert.equal(find(root, "save-conflict"), null);
  assert.equal(find(root, "sv-bar-Save"), null, "the draft is gone");
});

test("a person without the right: no Turn on or off, no +, no Add a step, no step form, no autosave, one line saying why", async () => {
  const { s, root } = await open("aut_lead", { initialSelected: "draft" }, (d) => ({ ...d, canSpace: false }));
  for (const id of ["sv-primary", "sv-secondary", "sv-add", "inspector", "delete-step"])
    assert.equal(find(root, id), null, `${id} is not shown`);
  assert.ok(find(root, "read-only-note"), "one line says who can edit");
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(updates(s).length, 0, "no write");
});
