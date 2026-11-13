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
