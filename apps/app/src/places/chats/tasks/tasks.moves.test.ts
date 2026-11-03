// The status menu offers only the moves a person's seat allows, in the words of the move (l-tasks). Pure: the same table the server keeps.
import test from "node:test";
import assert from "node:assert/strict";
import { canRelease, canTake, movesFor } from "./moves.ts";
import type { MoveTask } from "./moves.ts";
import { isHandIn } from "./actions.ts";

const me = "usr_me", maya = "usr_maya", cara = "usr_cara";
const person = (id: string) => ({ kind: "person", id });
const work = (over: Partial<MoveTask> = {}): MoveTask => ({ kind: "work", state: "todo", createdBy: cara, assigned: person(me), reviewer: person(maya), ...over });
const labels = (t: MoveTask, who: string): string[] => movesFor(t, who).map((m) => m.label);

test("the doer starts or hands in for review; the reviewer has nothing yet; a bystander nothing at all", () => {
  assert.deepEqual(labels(work(), me), ["Start", "Hand in for review", "Cancel the task"]);
  assert.deepEqual(labels(work(), maya), ["Cancel the task"]);
  assert.deepEqual(labels(work(), "usr_other"), []);
  assert.equal(movesFor(work(), me).find((m) => m.key === "submit")?.ask, "summary", "handing in asks for the one line");
});

test("in review the reviewer approves or sends back with fixes; awaiting approval the approver decides", () => {
  const t = work({ state: "in_review", approver: person(cara) });
  assert.deepEqual(labels(t, maya), ["Looks good, on to approval", "Send back", "Cancel the task"]);
  assert.deepEqual(labels(t, me), ["Cancel the task"], "the doer cannot approve their own work here");
  assert.deepEqual(labels(work({ state: "awaiting_approval", approver: person(cara) }), cara).slice(0, 2), ["Approve", "Send back"]);
  assert.deepEqual(labels(work({ state: "done" }), me), ["Reopen"]);
});

test("a request offers its own actions; a team task is taken, then given back", () => {
  const r = work({ kind: "answer", actions: [{ key: "answer", label: "Answer" }, { key: "dismiss", label: "Dismiss" }, { key: "delegate", label: "Hand over" }] });
  assert.deepEqual(labels(r, me), ["Answer", "Dismiss"]);
  const team = work({ assigned: { kind: "group", id: "grp_a" }, yourTurn: true });
  assert.equal(canTake(team), true);
  assert.equal(canTake({ ...team, takenBy: maya }), false);
  assert.equal(canRelease({ ...team, takenBy: me }, me), true);
  assert.deepEqual(labels({ ...team, takenBy: me }, me).slice(0, 2), ["Start", "Hand in for review"]);
});

test("Done on open work is a hand-in, from every door (one path)", () => {
  assert.equal(isHandIn({ kind: "work", state: "doing" }, "done"), true);
  assert.equal(isHandIn({ kind: "work", state: "doing", reviewer: person(maya) }, "in_review"), true);
  assert.equal(isHandIn({ kind: "work", state: "doing", reviewer: person(maya) }, "done"), false);
  assert.equal(isHandIn({ kind: "approve", state: "awaiting_approval" }, "done"), false);
});
