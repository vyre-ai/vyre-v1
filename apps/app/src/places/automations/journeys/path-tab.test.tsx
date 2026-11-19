// The Journey path page: its columns and facts, and the whole-path test driven through the page (it starts, it shows what could not start, a failure to start is said, Done clears it).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { PathTab } from "./PathTab.tsx";
import type { Journey } from "./model.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const journey = {
  id: "jrn_1",
  name: "Onboarding",
  subjectType: "client",
  recordType: "client",
  version: 1,
  inFlight: 0,
  createdAt: 0,
  updatedAt: 0,
  variables: [{ key: "plan", title: "Plan" }],
  stages: [
    { key: "lead", title: "Lead", order: 0, exit: { requireTasks: false }, tasks: [], automations: ["aut_a"] },
    {
      key: "won",
      title: "Active",
      order: 1,
      final: true,
      exit: { requireTasks: false },
      tasks: [],
      automations: ["aut_b"],
    },
  ],
} as unknown as Journey;

const open = async (call: (cap: string, i: any) => unknown, canDesign = false) => {
  installDom();
  const calls: { cap: string; input: any }[] = [];
  const data = {
    call: async (cap: string, input: any) => {
      calls.push({ cap, input });
      if (cap === "automations.list")
        return {
          automations: [
            {
              id: "aut_a",
              name: "Greet",
              status: "on",
              failedRuns: 0,
              sentence: "When a lead is created, email them hello.",
            },
          ],
        };
      return call(cap, input);
    },
    name: (id: string) => ({ aut_a: "Greet", aut_b: "Welcome" })[id] ?? id,
    me: { id: "usr_me", name: "Me" },
  };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={data as never}>
      <PathTab
        journey={journey}
        counts={[{ stage: "lead", count: 3, overLimit: 1 }]}
        canDesign={canDesign}
        design={
          {
            design: async (next: unknown) => {
              await data.call("journeys.design", { stages: next });
              return true;
            },
          } as never
        }
      />
    </AutomationsDataProvider>,
  );
  await flush();
  return { root, calls };
};

test("the columns show each stage with its count and its Automations, and the facts say where it starts and ends", async () => {
  const { root } = await open(() => ({}));
  const t = textOf(root);
  assert.match(t, /Starts when\s+Records are added by hand/);
  assert.match(
    textOf(find(root, "path-card-lead-aut_a")!),
    /Greet\s+When a lead is created, email them hello\./,
    "the card carries its sentence",
  );
  assert.equal(find(root, "path-add-lead"), null, "no Add button without the right to design");
  assert.doesNotMatch(textOf(find(root, "path-col-lead")!), /No limit|Nothing runs here/);
  assert.match(t, /Finishes at\s+Active/);
  assert.match(t, /Carried forward\s+Plan/);
  assert.ok(find(root, "path-card-lead-aut_a") && find(root, "path-card-won-aut_b"));
  assert.match(textOf(find(root, "path-col-lead")!), /Lead\s+3/);
  assert.match(textOf(find(root, "path-finish")!), /Finish lines\s+Active/);
});

test("Test the whole path starts a test for every Automation, says what could not start, and Done clears the bar", async () => {
  const { root, calls } = await open((cap) =>
    cap === "journeys.test_path"
      ? {
          runs: [
            { stage: "lead", automationId: "aut_a", runId: "run_a1" },
            { stage: "won", automationId: "aut_b", error: "It needs a mailbox." },
          ],
        }
      : {},
  );
  await press(find(root, "path-test"));
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "journeys.test_path")!.input, { journeyId: "jrn_1" });
  assert.match(textOf(find(root, "path-test-bar")!), /1 Automation started, 1 could not start\. Nothing is sent\./);
  assert.match(textOf(find(root, "path-card-won-aut_b")!), /It needs a mailbox\./);
  assert.match(textOf(find(root, "path-card-lead-aut_a")!), /Test started/);
  await press(find(root, "path-test-done"));
  await flush();
  assert.equal(find(root, "path-test-bar"), null);
});

test("a test that cannot start says why, and can be run again", async () => {
  let n = 0;
  const { root } = await open((cap) => {
    if (cap === "journeys.test_path" && ++n === 1)
      throw { error: { message: "Automations are not available right now." } };
    return { runs: [] };
  });
  await press(find(root, "path-test"));
  await flush();
  assert.match(textOf(find(root, "path-test-bar")!), /Automations are not available right now\./);
  await press(find(root, "path-test"));
  await flush();
  assert.match(textOf(find(root, "path-test-bar")!), /No stage has an Automation to try yet\./);
});

test("an Automation that already starts on a stage is offered in that column; pressing Add puts it in the stage through journeys.design", async () => {
  const { root, calls } = await open((cap) => {
    if (cap === "automations.stage_offers") return { offers: [{ automationId: "aut_x", name: "Welcome new customers", stage: "won", on: true }] };
    return { journey: {} };
  }, true);
  const offer = find(root, "path-offer-won-aut_x");
  assert.ok(offer, "the offer is under its stage");
  assert.match(textOf(offer!), /Welcome new customers\s+It already starts when the stage becomes Active\./);
  assert.deepEqual(calls.find((c) => c.cap === "automations.stage_offers")!.input, {
    recordType: "client",
    stages: ["lead", "won"],
    members: ["aut_a", "aut_b"],
  });
  await press(find(root, "path-take-aut_x"));
  await flush();
  const saved = calls.find((c) => c.cap === "journeys.design")!.input as { stages: { key: string; automations: string[] }[] };
  assert.deepEqual(saved.stages.find((s) => s.key === "won")!.automations, ["aut_b", "aut_x"]);
});

test("without the right to design the offer is shown and cannot be taken", async () => {
  const { root } = await open((cap) => (cap === "automations.stage_offers" ? { offers: [{ automationId: "aut_x", name: "W", stage: "lead", on: true }] } : {}), false);
  assert.ok(find(root, "path-offer-lead-aut_x"));
  assert.equal(find(root, "path-take-aut_x"), null);
});
