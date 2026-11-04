// What a helper's last test run said, read from its own tool steps: running, then passing or failing; counts only when the step carries them.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { noteSteps, testsOf } from "../helper-tests.ts";
import type { Db } from "../projections.ts";

const mk = (): Db => {
  const s = new DatabaseSync(":memory:");
  return { run: (sql: string, ...a: unknown[]) => { s.prepare(sql).run(...(a as never[])); }, all: (sql: string, ...a: unknown[]) => s.prepare(sql).all(...(a as never[])) } as unknown as Db;
};

test("a test command is running until its result, then passing or failing", () => {
  const db = mk();
  assert.equal(testsOf(db, "thr_1"), undefined, "nothing run yet");
  noteSteps(db, "thr_1", [{ phase: "call", id: "a", name: "Bash" }, { phase: "input", id: "a", detail: "npm test" }], 1);
  assert.deepEqual(testsOf(db, "thr_1"), { state: "running" });
  noteSteps(db, "thr_1", [{ phase: "result", id: "a", ok: true, detail: "12 passed" }], 2);
  assert.deepEqual(testsOf(db, "thr_1"), { state: "passing", passed: 12 });
  noteSteps(db, "thr_1", [{ phase: "call", id: "b", name: "Bash" }, { phase: "input", id: "b", detail: "node --test test/x.test.ts" }, { phase: "result", id: "b", ok: false, detail: "3 failing, 9 passed" }], 3);
  assert.deepEqual(testsOf(db, "thr_1"), { state: "failing", passed: 9, failed: 3 });
});

test("a command that is not a test run, or a tool that is not a shell, changes nothing", () => {
  const db = mk();
  noteSteps(db, "thr_2", [{ phase: "call", id: "a", name: "Bash" }, { phase: "input", id: "a", detail: "ls -la" }, { phase: "result", id: "a", ok: true }], 1);
  noteSteps(db, "thr_2", [{ phase: "call", id: "b", name: "Read" }, { phase: "input", id: "b", detail: "npm test notes.md" }, { phase: "result", id: "b", ok: true }], 2);
  assert.equal(testsOf(db, "thr_2"), undefined);
});

test("a helper that waits on a person points at its held request: the newest waiting turn status with a task", async () => {
  const { holdOf } = await import("../handlers/helpers.ts");
  assert.equal(holdOf([]), undefined);
  assert.equal(holdOf([{ blocks: [{ type: "turn_status", data: { state: "waiting" } }] }]), undefined, "waiting with no task is not a card");
  assert.equal(holdOf([{ blocks: [{ type: "turn_status", data: { state: "waiting", taskId: "tsk_old" } }] }, { blocks: [{ type: "text" }] }, { blocks: [{ type: "turn_status", data: { state: "waiting", taskId: "tsk_new" } }] }]), "tsk_new");
  assert.equal(holdOf([{ blocks: [{ type: "turn_status", data: { state: "done", taskId: "tsk_x" } }] }]), undefined);
});

test("a helper whose last turn ended but has a person's line or a restart waiting reads as working with what it will do; otherwise as the turns say", async () => {
  const { waitingLine } = await import("../handlers/helpers.ts");
  const ended = 1_000;
  const person = (createdAt: number, restart = false) => ({ author: { kind: "person" }, createdAt, blocks: restart ? [{ data: { restart: true } }] : [] });
  assert.equal(waitingLine(person(2_000, true), ended), "Starting again", "stopped, then restarted: starting, not stopped");
  assert.equal(waitingLine(person(2_000), ended), "Reading your message", "a line to a helper that has finished");
  assert.equal(waitingLine(person(500), ended), undefined, "a line written before the last turn ended was answered by it");
  assert.equal(waitingLine({ author: { kind: "agent" }, createdAt: 2_000 }, ended), undefined, "the helper's own reply is not a line waiting");
  assert.equal(waitingLine(undefined, ended), undefined);
});
