import test from "node:test";
import assert from "node:assert/strict";
import { needsFromIssues } from "./issues.ts";

const issues = [
  { nodeId: "b", severity: "error" as const, message: "Send for signature: choose the file." },
  { nodeId: "b", severity: "warning" as const, message: "This step uses Microsoft 365, which you cannot use." },
  { nodeId: "a", severity: "warning" as const, message: "Consider a shorter subject." },
  { severity: "error" as const, message: "Nothing starts this." },
];

test("a step's errors become its missing things, the server's own words; a warning is not a missing thing", () => {
  assert.deepEqual(needsFromIssues(issues, "b", new Set()), [
    { kind: "value", line: "Send for signature: choose the file.", button: "Fix" },
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
