// The runs capabilities around the engine: start, get, list, steps, count, stop, retry, replay, record_step, record_key, mark_waiting, resume, finish, status.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { admin, alice, bob, engine, newRun, MINUTE, NOW } from "../fixtures/seed.ts";
import { allSteps, readExtra, readWait } from "../projections.ts";

const names = (h: Harness): string[] => h.events.map((e) => e.name);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
async function mk(h: Harness, over: Record<string, unknown> = {}, who = engine): Promise<string> {
  return (await h.call("runs.start", newRun(over), who)).runId as string;
}
const get = async (h: Harness, id: string): Promise<any> => (await h.call("runs.get", { runId: id }, engine)).run;   // eslint-disable-line @typescript-eslint/no-explicit-any
const managers = (...ids: string[]) => (who: { id: string }, a: { perm: string | null }): boolean => ids.includes(who.id) && a.perm === "runs.manage";
const tasks = (h: Harness): any[] => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const made: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("tasks.create", (input) => { made.push(input); return { task: { id: `tsk_n${made.length}` } }; });
  return made;
};
const step = (h: Harness, runId: string, s: string, attempt: number, state: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
  h.call("runs.record_step", { runId, step: s, attempt, state, ...extra }, engine);

// ---- start and get ----

test("start makes a queued Run with its own thread and trace, and says so", async () => {
  const h = harness();
  const r = await h.call("runs.start", newRun({ subject: { type: "record", id: "rec_one" }, definitionVersion: 3, modelUsed: "m1" }), { id: "usr_alice", kind: "person" });
  assert.deepEqual(names(h), ["run.started"]);
  assert.equal(h.events[0]!.subject, `run/${r.runId}`);
  const run = await get(h, r.runId);
  assert.equal(run.status, "queued");
  assert.equal(run.owner, alice.id);
  assert.equal(run.startedBy, alice.id);
  assert.equal(run.definitionVersion, 3);
  assert.deepEqual(run.subject, { type: "record", id: "rec_one" });
  assert.equal(run.costMicros, 0);
  assert.equal(run.startedAt, NOW);
  assert.match(run.threadId, /^thr_[a-z0-9]+$/);
  assert.equal(run.traceId, "0123456789abcdef0123456789abcdef");
  const given = await mk(h, { threadId: "thr_given1" });
  assert.equal((await get(h, given)).threadId, "thr_given1");
});

test("start is idempotent by key and checks the parent", async () => {
  const h = harness();
  const a = await h.call("runs.start", { ...newRun(), idempotencyKey: "same" }, engine);
  const b = await h.call("runs.start", { ...newRun(), idempotencyKey: "same" }, engine);
  assert.equal(a.runId, b.runId);
  assert.equal((h.db.all("SELECT COUNT(*) AS n FROM runs_items") as { n: number }[])[0]!.n, 1);
  assert.deepEqual(names(h), [], "the repeat emitted nothing");
  await refused(h.call("runs.start", newRun({ parentRun: "run_nothere" }), engine), "validation.not_found", "no_parent");
  const child = await mk(h, { parentRun: a.runId });
  assert.equal((await get(h, child)).parentRun, a.runId);
});

test("a Run is seen by its owner and starter, hidden from others, shown to a Manage holder", async () => {
  const h = harness({ authorize: managers(admin.id) });
  const id = await mk(h);
  assert.equal((await h.call("runs.get", { runId: id }, alice)).run.id, id);
  await refused(h.call("runs.get", { runId: id }, bob), "permission.not_found");
  assert.equal((await h.call("runs.get", { runId: id }, admin)).run.id, id);
  await refused(h.call("runs.get", { runId: "run_missing" }, alice), "permission.not_found");
  await refused(h.call("runs.steps", { runId: id }, bob), "permission.not_found");
});

// ---- list and count ----

test("list: mine, owner, subject, all, with filters and pages", async () => {
  const h = harness({ authorize: (who, a, r) => (who.id === admin.id && a.perm === "runs.manage") || (who.id === bob.id && a.level === "view" && r.id !== null) });
  const subj = { type: "record", id: "rec_x" };
  const r1 = await mk(h, { owner: alice.id, kind: "automation" });
  h.advance(MINUTE);
  const r2 = await mk(h, { owner: alice.id, kind: "routine", subject: subj });
  h.advance(MINUTE);
  const r3 = await mk(h, { owner: bob.id, kind: "automation", subject: subj });
  await h.call("runs.finish", { runId: r1, status: "succeeded" }, engine);
  const ids = (x: { runs: { id: string }[] }): string[] => x.runs.map((r) => r.id);

  assert.deepEqual(ids(await h.call("runs.list", { scope: "mine" }, alice)), [r2, r1], "newest first");
  assert.deepEqual(ids(await h.call("runs.list", { scope: "mine", kinds: ["routine"] }, alice)), [r2]);
  assert.deepEqual(ids(await h.call("runs.list", { scope: "mine", statuses: ["succeeded"] }, alice)), [r1]);
  assert.deepEqual(ids(await h.call("runs.list", { scope: "mine", since: NOW + MINUTE }, alice)), [r2]);
  assert.deepEqual(ids(await h.call("runs.list", { scope: "owner", ownerId: bob.id }, admin)), [r3]);
  assert.deepEqual(ids(await h.call("runs.list", { scope: "owner", ownerId: bob.id }, alice)), [], "someone else's Runs are not listed by owner");
  assert.deepEqual(ids(await h.call("runs.list", { scope: "subject", subject: subj }, bob)).sort(), [r2, r3].sort(), "a viewer of the object sees its Runs");
  assert.deepEqual(ids(await h.call("runs.list", { scope: "subject", subject: subj }, alice)), [r2], "without access, only your own");
  assert.equal((await h.call("runs.list", { scope: "all" }, admin)).total, 3);
  await refused(h.call("runs.list", { scope: "all" }, alice), "permission.role_lacks_permission", "manage_required");
  const p1 = await h.call("runs.list", { scope: "all", limit: 2 }, admin);
  assert.equal(p1.runs.length, 2);
  assert.equal(p1.total, 3);
  const p2 = await h.call("runs.list", { scope: "all", limit: 2, cursor: p1.next }, admin);
  assert.deepEqual(ids(p2), [r1]);
  assert.equal(p2.next, undefined);
});

test("count by status for badges", async () => {
  const h = harness({ authorize: managers(admin.id) });
  const a = await mk(h);
  await mk(h);
  await mk(h, { owner: bob.id });
  tasks(h);
  await h.call("runs.finish", { runId: a, status: "failed", error: { code: "x.y", message: "no" } }, engine);
  assert.equal((await h.call("runs.count", { scope: "mine" }, alice)).count, 2);
  assert.equal((await h.call("runs.count", { scope: "mine", statuses: ["failed"] }, alice)).count, 1);
  assert.equal((await h.call("runs.count", { scope: "all", statuses: ["queued"] }, admin)).count, 2);
});

// ---- step log ----

test("record_step writes the log, is idempotent by (run, step, attempt), and never moves a finished step", async () => {
  const h = harness();
  const id = await mk(h);
  assert.equal((await get(h, id)).status, "queued");
  await step(h, id, "draft", 1, "running");
  assert.equal((await get(h, id)).status, "running", "the first running step starts the Run");
  await step(h, id, "draft", 1, "running");
  await step(h, id, "draft", 1, "succeeded", { outputRef: "out:1", branch: "main" });
  await step(h, id, "draft", 1, "succeeded", { outputRef: "out:1", branch: "main" });
  await refused(step(h, id, "draft", 1, "failed", { error: { code: "a.b", message: "late" } }), "validation.precondition_failed", "step_terminal");
  await step(h, id, "draft", 2, "failed", { error: { code: "a.b", message: "boom" }, traceSpan: "span1" });
  await step(h, id, "send", 1, "pending");
  const rows = (await h.call("runs.steps", { runId: id }, engine)).steps;
  assert.deepEqual(rows.map((r: { step: string; attempt: number; state: string }) => `${r.step}#${r.attempt}:${r.state}`), ["draft#1:succeeded", "draft#2:failed", "send#1:pending"]);
  assert.equal(rows[0].branch, "main");
  assert.deepEqual(rows[1].error, { code: "a.b", message: "boom" });
  assert.equal(rows[1].traceSpan, "span1");
  assert.ok(rows[0].startedAt && rows[0].endedAt, "times are kept");
  assert.equal(rows[2].startedAt, undefined, "a pending step has not started");
  const page = await h.call("runs.steps", { runId: id, limit: 2 }, engine);
  assert.equal(page.steps.length, 2);
  assert.equal(page.total, 3);
  assert.equal((await h.call("runs.steps", { runId: id, limit: 2, cursor: page.next }, engine)).steps.length, 1);
  assert.equal(allSteps(h.db, id).length, 3);
});

test("record_step is refused on a finished Run, except to close the step that was in flight at a stop", async () => {
  const h = harness();
  const id = await mk(h);
  await step(h, id, "a", 1, "running");
  await h.call("runs.stop", { runId: id }, alice);
  await step(h, id, "a", 1, "succeeded");
  const done = await mk(h);
  await h.call("runs.finish", { runId: done, status: "succeeded" }, engine);
  await refused(step(h, done, "a", 1, "running"), "validation.precondition_failed", "run_finished");
});

// ---- finish ----

test("finish: succeeded keeps cost and summary; failed lands in Needs you once, with the count of failures in a row", async () => {
  const h = harness();
  const made = tasks(h);
  const ok = await mk(h, { name: "Nightly" });
  const r = await h.call("runs.finish", { runId: ok, status: "succeeded", summary: "12 sent", costMicros: 4500 }, engine);
  assert.equal(r.run.status, "succeeded");
  assert.equal(r.run.summary, "12 sent");
  assert.equal(r.run.costMicros, 4500);
  assert.equal(r.run.endedAt, NOW);
  assert.deepEqual(names(h), ["run.succeeded"]);
  assert.deepEqual(h.events[0]!.payload, { runId: ok, kind: "automation", summary: "12 sent", costMicros: 4500 });
  await h.call("runs.finish", { runId: ok, status: "succeeded" }, engine);
  assert.deepEqual(names(h), [], "the same finish twice emits nothing");
  await refused(h.call("runs.finish", { runId: ok, status: "failed" }, engine), "validation.precondition_failed", "run_finished");

  h.advance(MINUTE);
  const f1 = await mk(h, { name: "Nightly", subject: { type: "record", id: "rec_c" } });
  await h.call("runs.finish", { runId: f1, status: "failed", error: { code: "provider.rate_limited", message: "Slow down.", step: "mail" } }, engine);
  assert.equal(made.length, 1);
  assert.equal(made[0].kind, "unblock");
  assert.equal(made[0].title, "Nightly failed");
  assert.equal(made[0].recordId, "rec_c");
  assert.equal(made[0].idempotencyKey, `run-failed:${f1}`);
  const ev = h.events.find((e) => e.name === "run.failed")!;
  assert.deepEqual({ ...ev.payload }, { runId: f1, kind: "automation", step: "mail", code: "provider.rate_limited", message: "Slow down.", owner: alice.id, consecutive: 1 });
  h.advance(MINUTE);
  const f2 = await mk(h, { name: "Nightly" });
  await h.call("runs.finish", { runId: f2, status: "failed" }, engine);
  assert.equal(h.events.find((e) => e.name === "run.failed")!.payload.consecutive, 2);
  assert.equal(readExtra(h.db, f2).errorCode, "run.failed");
});

test("a failed Run still fails when tasks is down, and a test Run stays out of Needs you", async () => {
  const h = harness();
  h.callee("tasks.create", () => { throw new Error("down"); });
  const a = await mk(h);
  assert.equal((await h.call("runs.finish", { runId: a, status: "failed" }, engine)).run.status, "failed");
  const calls = h.calls.length;
  const t = await mk(h, { kind: "automation_test" });
  await h.call("runs.finish", { runId: t, status: "failed" }, engine);
  assert.equal(h.calls.length, calls, "no task for a test");
});

// ---- stop ----

test("stop: the owner or a Manage holder stops an active Run; it is idempotent; a finished Run stays as it was", async () => {
  const h = harness({ authorize: managers(admin.id) });
  const id = await mk(h);
  await step(h, id, "a", 1, "running");
  await step(h, id, "b", 1, "pending");
  await refused(h.call("runs.stop", { runId: id }, bob), "permission.not_found");
  const r = await h.call("runs.stop", { runId: id, reason: "Wrong list" }, alice);
  assert.equal(r.run.status, "stopped");
  assert.deepEqual(names(h), ["run.stopped"]);
  assert.deepEqual(h.events[0]!.payload, { runId: id, by: alice.id, reason: "Wrong list" });
  assert.deepEqual(allSteps(h.db, id).map((s) => s.state), ["stopped", "stopped"], "unfinished steps stop with it");
  assert.equal(readExtra(h.db, id).stopReason, "Wrong list");
  await h.call("runs.stop", { runId: id }, alice);
  assert.deepEqual(names(h), [], "stopping a stopped Run does nothing");

  const two = await mk(h);
  assert.equal((await h.call("runs.stop", { runId: two }, admin)).run.status, "stopped");
  const three = await mk(h);
  await h.call("runs.finish", { runId: three, status: "succeeded" }, engine);
  await refused(h.call("runs.stop", { runId: three }, alice), "validation.precondition_failed", "run_finished");
});

test("someone who can see a Run but does not manage it cannot stop or retry it", async () => {
  const h = harness({ authorize: (who, a) => who.id === bob.id && a.level === "view" });
  const id = await mk(h);
  assert.equal((await h.call("runs.get", { runId: id }, bob)).run.id, id);
  await refused(h.call("runs.stop", { runId: id }, bob), "permission.role_lacks_permission", "manage_required");
});

// ---- retry ----

test("retry: a failed Run starts again from the start, a new Run pointing at the old one", async () => {
  const h = harness();
  tasks(h);
  const old = await mk(h, { name: "Send", subject: { type: "record", id: "rec_r" }, definitionVersion: 2 });
  await step(h, old, "a", 1, "succeeded");
  await step(h, old, "b", 1, "failed", { error: { code: "x.y", message: "no" } });
  await h.call("runs.finish", { runId: old, status: "failed" }, engine);
  const r = await h.call("runs.retry", { runId: old }, alice);
  assert.deepEqual(names(h), ["run.started", "run.retried"]);
  const retried = h.events[1]!;
  const next = await get(h, r.runId);
  assert.equal(next.parentRun, old);
  assert.equal(next.name, "Send");
  assert.equal(next.definitionVersion, 2);
  assert.equal(next.status, "queued");
  assert.deepEqual(next.subject, { type: "record", id: "rec_r" });
  assert.equal(allSteps(h.db, r.runId).length, 0, "nothing carried over");
  assert.equal(readExtra(h.db, r.runId).retryOf, old);
  assert.deepEqual(retried.payload, { runId: old, newRunId: r.runId });
});

test("retry from a step keeps the results of the steps before it", async () => {
  const h = harness();
  tasks(h);
  const old = await mk(h);
  await step(h, old, "a", 1, "succeeded");
  await step(h, old, "b", 1, "succeeded");
  await step(h, old, "c", 1, "failed", { error: { code: "x.y", message: "no" } });
  await h.call("runs.finish", { runId: old, status: "failed" }, engine);
  const r = await h.call("runs.retry", { runId: old, fromStep: "c" }, alice);
  const rows = allSteps(h.db, r.runId);
  assert.deepEqual(rows.map((s) => `${s.step}#${s.attempt}:${s.state}`), ["a#1:succeeded", "b#1:succeeded"]);
  assert.deepEqual(rows.map((s) => s.idemKey), [`${r.runId}:a:1`, `${r.runId}:b:1`], "the copies carry the new Run's keys");
  assert.equal(readExtra(h.db, r.runId).fromStep, "c");
  await refused(h.call("runs.retry", { runId: old, fromStep: "zzz" }, alice), "validation.precondition_failed", "unknown_step");
});

test("retry is for failed or stopped Runs, by the owner or a Manage holder", async () => {
  const h = harness();
  const id = await mk(h);
  await refused(h.call("runs.retry", { runId: id }, alice), "validation.precondition_failed", "not_retryable");
  await h.call("runs.stop", { runId: id }, alice);
  await refused(h.call("runs.retry", { runId: id }, bob), "permission.not_found");
  assert.ok((await h.call("runs.retry", { runId: id }, alice)).runId);
});

// ---- replay ----

test("replay starts a sandbox Run that points at the original; same keeps the version, current takes the live one", async () => {
  const h = harness();
  const id = await mk(h, { name: "Intake", definitionVersion: 4, subject: { type: "record", id: "rec_p" } });
  const same = await h.call("runs.replay", { runId: id }, alice);
  const a = await get(h, same.runId);
  assert.equal(a.kind, "replay");
  assert.equal(a.parentRun, id);
  assert.equal(a.definitionVersion, 4);
  assert.equal(a.owner, alice.id);
  assert.equal(a.name, "Replay of Intake");
  assert.deepEqual(readExtra(h.db, same.runId), { replayOf: id, replayVersion: "same" });
  const cur = await h.call("runs.replay", { runId: id, version: "current" }, alice);
  assert.equal((await get(h, cur.runId)).definitionVersion, undefined);
  assert.equal(readExtra(h.db, cur.runId).replayVersion, "current");
  await refused(h.call("runs.replay", { runId: id }, bob), "permission.not_found");
});

// ---- keys, waiting, resume ----

test("record_key keeps the key and model; a fallback says so on the Run chat", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("runs.record_key", { runId: id, keyUsed: "key_a", modelUsed: "m1" }, engine);
  assert.deepEqual(names(h), []);
  const r = await h.call("runs.record_key", { runId: id, step: "ai", keyUsed: "key_b", fellBackFrom: "key_a", reason: "refused" }, engine);
  assert.equal(r.run.keyUsed, "key_b");
  assert.equal(r.run.modelUsed, "m1");
  assert.deepEqual(h.events[0]!.payload, { runId: id, step: "ai", fromKey: "key_a", toKey: "key_b", reason: "refused" });
});

test("mark_waiting and resume: approval waits on a task; a lost key waits in the starter's Needs you; wrong or repeated calls are refused", async () => {
  const h = harness();
  const made = tasks(h);
  const id = await mk(h);
  await step(h, id, "ok", 1, "running");
  const w = await h.call("runs.mark_waiting", { runId: id, reason: "approval", taskId: "tsk_gate9" }, engine);
  assert.equal(w.run.status, "waiting");
  assert.equal(w.run.waitReason, "approval");
  assert.deepEqual(h.events[0]!.payload, { runId: id, reason: "approval", taskId: "tsk_gate9" });
  assert.equal(readWait(h.db, id)?.taskId, "tsk_gate9");
  assert.equal(made.length, 0, "the Gate made the task");
  await h.call("runs.mark_waiting", { runId: id, reason: "approval", taskId: "tsk_gate9" }, engine);
  assert.equal(h.events.length, 0, "waiting twice for the same thing is one wait");
  await refused(h.call("runs.resume", { runId: id, reason: "key" }, engine), "validation.precondition_failed", "wrong_wait");
  const r = await h.call("runs.resume", { runId: id, reason: "approval" }, engine);
  assert.equal(r.run.status, "running");
  assert.equal(r.run.waitReason, undefined);
  assert.equal(readWait(h.db, id), undefined);
  assert.ok(names(h).includes("run.resumed"));
  await refused(h.call("runs.resume", { runId: id, reason: "approval" }, engine), "validation.precondition_failed", "not_waiting");

  const k = await mk(h, { name: "Draft replies" });
  await h.call("runs.mark_waiting", { runId: k, reason: "key", on: "a working key" }, engine);
  assert.equal(made.length, 1);
  assert.equal(made[0].kind, "unblock");
  assert.deepEqual(made[0].assigned, { kind: "person", id: alice.id }, "the owner when a service started the Run");
  assert.equal(readWait(h.db, k)?.taskId, "tsk_n1");
  const fin = await mk(h);
  await h.call("runs.finish", { runId: fin, status: "succeeded" }, engine);
  await refused(h.call("runs.mark_waiting", { runId: fin, reason: "background" }, engine), "validation.precondition_failed", "run_finished");
});

test("finishing a waiting Run clears its wait", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("runs.mark_waiting", { runId: id, reason: "background" }, engine);
  assert.ok(readWait(h.db, id));
  await h.call("runs.finish", { runId: id, status: "succeeded" }, engine);
  assert.equal(readWait(h.db, id), undefined);
});

// ---- status ----

test("status: healthy when Runs move, degraded when one has stopped moving or the queue is old", async () => {
  const h = harness();
  assert.deepEqual({ ...(await h.call("runs.status", {}, engine)), latencyMs: 0 }, { state: "healthy", queued: 0, stuck: 0, latencyMs: 0 });
  const id = await mk(h);
  await step(h, id, "a", 1, "running");
  await mk(h);
  let s = await h.call("runs.status", {}, engine);
  assert.equal(s.state, "healthy");
  assert.equal(s.queued, 1);
  h.advance(20 * MINUTE);
  s = await h.call("runs.status", {}, engine);
  assert.equal(s.state, "degraded");
  assert.equal(s.stuck, 1);
  assert.match(s.detail, /stopped moving/);
  await h.call("runs.stop", { runId: id }, alice);
  s = await h.call("runs.status", {}, engine);
  assert.equal(s.state, "degraded", "the queued Run has waited too long");
  assert.match(s.detail, /queued/);
});

// run on the final commit
