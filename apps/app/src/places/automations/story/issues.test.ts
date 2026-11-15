import test from "node:test";
import assert from "node:assert/strict";
import { actOf, needsFromIssues } from "./issues.ts";

const issues = [
  { nodeId: "b", severity: "error" as const, message: "Send for signature: choose the file." },
  { nodeId: "b", severity: "warning" as const, message: "This step uses Microsoft 365, which you cannot use." },
  { nodeId: "a", severity: "warning" as const, message: "Consider a shorter subject." },
  { severity: "error" as const, message: "Nothing starts this." },
];

// changed for AUTOMATIONS-BUILD-RC29 (round two, item 1): the line says the thing to do, never the step's name, and the button is named for the act
test("a step's errors become its missing things, the server's own words; a warning is not a missing thing", () => {
  assert.deepEqual(needsFromIssues(issues, "b", new Set()), [
    { kind: "value", line: "Choose the file", button: "Choose the file" },
  ]);
  assert.deepEqual(needsFromIssues(issues, "a", new Set()), []);
});

test("a step whose app he may not use carries the one plain line, first, and an Ask-an-admin button", () => {
  const n = needsFromIssues(issues, "b", new Set(["b"]));
  assert.deepEqual(n[0], {
    kind: "no_access",
    line: "This step uses Microsoft 365, which you cannot use.",
    button: "Ask an admin",
  });
  assert.equal(n.length, 2);
});

test("an issue with no step belongs to the page, not to a step", () => {
  assert.deepEqual(needsFromIssues(issues, "trigger", new Set()), []);
});

test("a missing account is fixed where it is missing: the button says what to connect", () => {
  const n = needsFromIssues(issues, "b", new Set(), "Connect a mailbox");
  assert.deepEqual(n, [{ kind: "value", line: "Choose the file", button: "Connect a mailbox" }]);
});

test("the missing thing is said as the act to do, from the server's words and from the page's own check, never with the step's name or (required)", () => {
  assert.equal(actOf("Create a task: add a title."), "Add a title");
  assert.equal(actOf("Create a task needs a title."), "Add a title");
  assert.equal(actOf("Create a task: choose who it is for."), "Choose who it is for");
  assert.equal(actOf("Title (required): add a title."), "Add a title");
  const two = [
    { nodeId: "a", severity: "error", message: "Create a task: add a title." },
    { nodeId: "a", severity: "error", message: "Create a task: choose who it is for." },
  ];
  assert.deepEqual(
    needsFromIssues(two, "a", new Set()).map((n) => n.line),
    ["Add a title"],
    "the first shows; the next appears when it is done",
  );
});

test("the form's needs bar and the row's orange line come from the one message: the bar says what is missing, the line what to do", async () => {
  const { chipForIssue } = await import("../../../../../../lib/words/step-missing.ts");
  const m = "Create a task needs a title";
  assert.equal(chipForIssue(m), "Needs a title");
  assert.equal(actOf(m), "Add a title");
  assert.equal(needsFromIssues([{ nodeId: "a", severity: "error", message: m }], "a", new Set())[0]!.line, actOf(m));
});
