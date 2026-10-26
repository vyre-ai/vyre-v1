import test from "node:test";
import assert from "node:assert/strict";
import { assertStrictInput, strictInputErrors } from "./strict.ts";

const task = { title: "Answer me", assigned: { kind: "person", id: "usr_dana" }, idempotencyKey: "k1" };

test("strict fakes: a valid tasks.create passes and a missing key, a bad kind or a bad field is named", () => {
  assert.deepEqual(strictInputErrors("tasks.create", task), []);
  assert.ok(strictInputErrors("tasks.create", { title: "x", assigned: task.assigned }).some((e) => e.includes("idempotencyKey")));
  assert.ok(strictInputErrors("tasks.create", { ...task, kind: "nope" }).length > 0);
});

test("strict fakes: a task action its kind does not have is refused like the real handler does", () => {
  assert.deepEqual(strictInputErrors("tasks.create", { ...task, kind: "answer", actions: [{ key: "answer", label: "Answer" }] }), []);
  assert.throws(() => assertStrictInput("tasks.create", { ...task, kind: "answer", actions: [{ key: "approve", label: "Approve" }] }), (e) => (e as { error: { code: string } }).error.code === "validation.precondition_failed");
});

test("strict fakes: other capabilities are not checked, a bad records input throws validation.bad_input", () => {
  assert.deepEqual(strictInputErrors("mail.send", {}), []);
  assert.throws(() => assertStrictInput("records.create", {}), (e) => (e as { error: { code: string } }).error.code === "validation.bad_input");
});
