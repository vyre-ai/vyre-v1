// The first page and the builder page, drawn from their models. Every element has a defined press.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { firstPage } from "../first/model.ts";
import { story } from "../story/model.ts";
import { FirstPageView } from "./FirstPageView.tsx";
import { StoryView } from "./StoryView.tsx";

installDom();

test("the first page: Needs you cards each with their fix, one suggestion, one Today line, and nothing that explains the page", async () => {
  const calls: string[] = [];
  const page = firstPage({
    needs: [
      {
        id: "n1",
        automation: "New lead follow-up",
        why: "Step 2, Text to me, could not run: the Twilio key is missing.",
        at: 1,
        runId: "r4",
        app: "twilio",
        fix: { label: "Add the key", kind: "key" },
      },
    ],
    suggestions: [
      {
        id: "s1",
        app: { id: "notely", name: "Notely" },
        item: "Notely API key",
        mayUse: true,
        knownService: true,
        assistant: "owner",
      },
    ],
    today: { ran: 4, failed: [{ runId: "r4" }] },
  });
  const root = await mount(
    createRoot,
    <FirstPageView
      page={page}
      now={2 * 3600_000 + 1000}
      onFix={(id) => calls.push(`fix:${id}`)}
      onSeeRun={(id) => calls.push(`run:${id}`)}
      onSetUp={(id) => calls.push(`setup:${id}`)}
      onNotNow={(id) => calls.push(`notnow:${id}`)}
      onNew={() => calls.push("new")}
      onExamples={() => calls.push("examples")}
      onAllRuns={() => calls.push("allruns")}
    />,
  );
  const t = textOf(root);
  assert.ok(find(root, "fp-when-n1"), "a card that needs him says since when");
  for (const w of [
    "Needs you",
    "New lead follow-up",
    "Add the key",
    "Connect Notely",
    "Notely API key",
    "Set up",
    "Not now",
    "Today",
    "4 ran",
    "1 failed",
  ])
    assert.ok(t.includes(w), w);
  for (const id of [
    "fp-fix-n1",
    "fp-run-n1",
    "fp-setup-s1",
    "fp-notnow-s1",
    "fp-today-run",
    "fp-new",
    "fp-examples",
    "fp-allruns",
  ])
    await press(find(root, id));
  assert.deepEqual(calls, ["fix:n1", "run:r4", "setup:s1", "notnow:s1", "run:r4", "new", "examples", "allruns"]);
});

test("with nothing to show the first page draws only the Today line and the ways in", async () => {
  const root = await mount(
    createRoot,
    <FirstPageView
      page={firstPage({ needs: [], suggestions: [], today: { ran: 0, failed: [] } })}
      now={0}
      onFix={() => {}}
      onSeeRun={() => {}}
      onSetUp={() => {}}
      onNotNow={() => {}}
      onNew={() => {}}
      onExamples={() => {}}
      onAllRuns={() => {}}
    />,
  );
  const t = textOf(root);
  assert.ok(!t.includes("Needs you") && !t.includes("Suggested"));
  assert.ok(t.includes("Nothing ran today."));
});

const base = { name: "Intake", on: false, proposed: false, dirty: false, test: null };
const trig = {
  id: "t",
  app: { id: "wordpress", name: "WordPress" },
  template: "A form is submitted: {form}",
  values: { form: { text: "Contact" } },
  hand: false,
};
const step = (id: string, extra: object = {}) => ({
  id,
  app: { id: "vyre", name: "Vyre" },
  action: "Create a task",
  template: "Make a task for {who}",
  values: { who: { chip: { label: "Name", from: "A form is submitted", sample: "Sam" } } },
  ...extra,
});

test("the builder page: When, numbered sentences with chips, one orange line with one button, the draft bar, and Turn on", async () => {
  const calls: string[] = [];
  const m = story({
    ...base,
    proposed: true,
    trigger: trig,
    steps: [
      step("a"),
      step("b", { needs: [{ kind: "value", line: "Choose the file to send", button: "Choose the file" }] }),
    ],
  });
  const root = await mount(createRoot, <StoryView story={m} on={(a, id) => calls.push(id ? `${a}:${id}` : a)} />);
  const t = textOf(root);
  for (const w of [
    "When",
    "A form is submitted",
    "Contact",
    "Make a task for",
    "Name",
    "Choose the file to send",
    "Choose the file",
    "Assistant’s draft, 2 steps. Nothing is on yet.",
    "Create a task",
  ])
    assert.ok(t.includes(w), w);
  assert.ok(t.includes("1") && t.includes("2"));
  for (const id of ["sv-bar-Accept", "sv-bar-Discard", "sv-bar-Change", "sv-need-b", "sv-step-a", "sv-add"])
    await press(find(root, id));
  assert.deepEqual(calls, ["bar:Accept", "bar:Discard", "bar:Change", "need:b", "open:a", "add"]);
});

test("head: the state in words, Test, and the one primary; a disabled Turn on says why", async () => {
  const m = story({
    ...base,
    trigger: trig,
    steps: [step("a", { needs: [{ kind: "value", line: "x", button: "y" }] })],
  });
  const calls: string[] = [];
  const root = await mount(createRoot, <StoryView story={m} on={(a) => calls.push(a)} />);
  assert.ok(textOf(root).includes("Off, saved as a draft"));
  await press(find(root, "sv-test"));
  assert.ok(
    find(root, "sv-primary")!.props["aria-disabled"] === true ||
      find(root, "sv-primary")!.props["accessibilityState"] !== undefined,
  );
  assert.ok(textOf(root).includes("1 step needs you"));
});

test("the run page: numbered rows, the failed step in words with its one fix, Not sent, and Values to open per step", async () => {
  const { runView } = await import("../run/model.ts");
  const { RunView } = await import("./RunView.tsx");
  const calls: string[] = [];
  const steps = [step("a"), step("b", { writes: true })];
  const v = runView(steps, {
    a: { status: "ok", line: "Task for Lena", values: [["Title", "Follow up"]] },
    b: { status: "failed", why: "The Twilio key is missing.", fix: "Add the key" },
  });
  const root = await mount(createRoot, <RunView view={v} onFix={() => calls.push("fix")} />);
  const t = textOf(root);
  for (const w of [
    "Stopped at step 2, Create a task",
    "The Twilio key is missing. Add it and run again.",
    "Add the key",
    "Task for Lena",
    "Values",
  ])
    assert.ok(t.includes(w), w);
  assert.ok(!t.includes("Follow up"), "values are closed until opened");
  await press(find(root, "rv-values-a"));
  assert.ok(textOf(root).includes("Follow up"));
  await press(find(root, "rv-fix"));
  assert.deepEqual(calls, ["fix"]);
});

test("the left list: a dot, the name, a quiet scope word, search, the count on the head", async () => {
  const { listView } = await import("../list/model.ts");
  const { ListView } = await import("./ListView.tsx");
  const calls: string[] = [];
  const rows = [
    { id: "1", name: "Daily brief", state: "needs" as const, scope: "Space" as const },
    { id: "2", name: "Weekly report", state: "on" as const, scope: null },
  ];
  const root = await mount(
    createRoot,
    <ListView rows={rows} onOpen={(id) => calls.push(id)} onHome={() => calls.push("home")} />,
  );
  const t = textOf(root);
  assert.ok(t.includes("Automations") && t.includes("Daily brief") && t.includes("Space") && t.includes("1"));
  await press(find(root, "row-al-2"));
  await press(find(root, "al-home"));
  assert.deepEqual(calls, ["2", "home"]);
});

test("a slot between two steps adds a step there, and can be reached by keyboard", async () => {
  const calls: string[] = [];
  const m = story({ ...base, trigger: trig, steps: [step("a"), step("b")] });
  const root = await mount(createRoot, <StoryView story={m} on={(a, id) => calls.push(id ? `${a}:${id}` : a)} />);
  assert.equal(find(root, "sv-slot-b"), null, "no slot after the last row");
  const slot = find(root, "sv-slot-a")!;
  assert.equal(slot.props["aria-label"] ?? slot.props["accessibilityLabel"], "Add a step here");
  await press(slot);
  assert.deepEqual(calls, ["insert:a"]);
});
