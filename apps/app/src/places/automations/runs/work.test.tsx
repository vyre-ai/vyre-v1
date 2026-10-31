// The Work of a Run (work baton, lane W2): who holds the baton of the tasks a run made, the Work mark on a run row, and the read that never breaks the list.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RunRow } from "./RunRow.tsx";
import { loadOpenWork, loadRunWork, markOf, marksByRun, workLabel } from "./work.ts";
import type { WorkTask } from "./work.ts";
import { SAMPLE_NOW } from "./sample.ts";
import type { Run } from "./model.ts";

const task = (over: Partial<WorkTask> = {}): WorkTask => ({ id: "tsk_1", kind: "work", title: "Draft the letter", state: "todo", assigned: { kind: "agent", id: "agt_doer" }, reviewer: { kind: "agent", id: "agt_check" }, approver: { kind: "person", id: "usr_boss" }, source: { kind: "run", id: "run_1" }, ...over });

test("the mark is the seat that holds the baton and what it is doing", () => {
  assert.deepEqual([markOf(task())!.who.id, markOf(task())!.word], ["agt_doer", "Next up"]);
  assert.deepEqual([markOf(task({ state: "doing" }))!.word, markOf(task({ state: "doing" }))!.step], ["Doing", "work"]);
  assert.deepEqual([markOf(task({ state: "in_review" }))!.who.id, markOf(task({ state: "in_review" }))!.word], ["agt_check", "Reviewing"]);
  assert.deepEqual([markOf(task({ state: "awaiting_approval" }))!.who.id, markOf(task({ state: "awaiting_approval" }))!.step], ["usr_boss", "approve"]);
  assert.equal(markOf(task({ state: "done" })), null);
  assert.equal(markOf(task({ kind: "approve" })), null);
  assert.equal(markOf(task({ assigned: { kind: "group", id: "grp_desk" }, takenBy: "usr_me" }))!.who.id, "usr_me", "a task taken from a group is held by the one who took it");
});

test("each run gets the mark of its first open task; tasks of no run get none", () => {
  const marks = marksByRun([task({ id: "tsk_a", source: { kind: "run", id: "run_1" } }), task({ id: "tsk_b", source: { kind: "run", id: "run_1" }, state: "in_review" }), task({ id: "tsk_c", source: { kind: "run", id: "run_2" }, state: "done" }), task({ id: "tsk_d", source: { kind: "chat", id: "thr_1" } })]);
  assert.deepEqual([...marks.keys()], ["run_1"]);
  assert.equal(marks.get("run_1")!.taskId, "tsk_a");
  assert.equal(workLabel(marks.get("run_1")!, "Drafter"), "Next up: Drafter");
});

test("a task list that cannot be read is no work, never an error", async () => {
  const bad = async (): Promise<unknown> => { throw new Error("offline"); };
  assert.deepEqual(await loadOpenWork(bad), []);
  assert.deepEqual(await loadRunWork(bad, "run_1"), []);
  const seen: unknown[] = [];
  const good = async (cap: string, input: unknown): Promise<unknown> => { seen.push([cap, input]); return { tasks: [task(), task({ id: "tsk_x", source: { kind: "chat", id: "t" } })] }; };
  assert.equal((await loadOpenWork(good)).length, 1, "only the tasks runs made");
  assert.deepEqual(seen[0], ["tasks.list", { scope: "all", kinds: ["work"], states: ["todo", "doing", "in_review", "awaiting_approval"], limit: 200 }]);
});

test("a run row shows the face of who holds the baton, with a hover that says what they are doing", () => {
  const run: Run = { id: "run_1", kind: "automation", owner: "usr_a", startedBy: "usr_a", status: "waiting", costMicros: 0, startedAt: SAMPLE_NOW, traceId: "tr_1", waitReason: "approval" } as Run;
  const html = renderToStaticMarkup(<RunRow run={run} now={SAMPLE_NOW} rowKey="run_1" work={{ mark: markOf(task({ state: "in_review" }))!, name: "Checker" }} onOpen={() => undefined} onRetry={() => undefined} onMenu={() => undefined} />);
  assert.match(html, /data-testid="work-run_1"/);
  assert.match(html, /aria-label="Reviewing: Checker"/);
  const plain = renderToStaticMarkup(<RunRow run={run} now={SAMPLE_NOW} rowKey="run_1" onOpen={() => undefined} onRetry={() => undefined} onMenu={() => undefined} />);
  assert.doesNotMatch(plain, /data-testid="work-run_1"/);
});
