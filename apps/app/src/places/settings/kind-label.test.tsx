import test from "node:test";
import assert from "node:assert/strict";
import { KIND_LABELS, kindLabel, kindsFor } from "./pages-a.tsx";

test("a notification kind reads as words, with no template left in it", () => {
  assert.equal(kindLabel("Approval needed: {{title}}"), "Approval needed");
  assert.equal(kindLabel("{{from}} mentioned you in {{where}}"), "Someone mentioned you in a chat");
  assert.equal(kindLabel("{{from}} asks for {{level}} access to {{title}}"), "Someone asks for more access to something");
  assert.equal(kindLabel("While you were away"), "While you were away");
});

test("a member is not shown the kinds only an owner or admin can act on; an owner and an admin see them all", () => {
  const all = ["dm", "mention", "space.deletion_cancelled", "ci.paused", "member.join_requested", "limit.hit", "member.joined", "machine.alert", "hook.asked", "task.assigned"].map((key) => ({ key }));
  const keys = (role: string): string[] => kindsFor(all, role).map((k) => k.key);
  assert.deepEqual(keys("Member"), ["dm", "mention", "task.assigned"]);
  assert.deepEqual(keys("Guest"), ["dm", "mention", "task.assigned"]);
  assert.equal(keys("Owner").length, all.length);
  assert.equal(keys("Admin").length, all.length);
});

test("every admin-only kind and the hook kind has a plain label", () => {
  for (const k of ["space.deletion_cancelled", "ci.paused", "member.join_requested", "limit.hit", "hook.asked"]) assert.ok(KIND_LABELS[k], k);
});
