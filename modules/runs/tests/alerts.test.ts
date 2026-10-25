// Run alerts (spec 3.7, 2.13): who is told when a Run fails, after how many failures, where, the escalation chain, and the failed-run queue.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine, newRun, HOUR, MINUTE } from "../fixtures/seed.ts";
import { failedQueue, findAlert, onRunFailed, sweepEscalations } from "../handlers/alerts.ts";

const migration = readFileSync(new URL("../migrations/0002_run_alerts.sql", import.meta.url), "utf8");
const AUT = "aut_" + "a".repeat(32);
const maya = { kind: "person", id: "usr_maya" };
const admins = { kind: "role", id: "rol_admins" };
const base = { who: [] as { kind: string; id: string }[], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] as unknown[] };

interface World { h: Harness; tasks: { key: string; assigned: { kind: string; id: string }; title: string }[]; posts: { cap: string; input: any }[] }   // eslint-disable-line @typescript-eslint/no-explicit-any
/** A harness with the migration applied and the modules alerts talk to as stand-ins. */
function world(alerts: unknown = base): World {
  const h = harness();
  h.sqlite.exec(migration);
  const tasks: World["tasks"] = [];
  const posts: World["posts"] = [];
  h.callee("tasks.create", (i) => { tasks.push({ key: i.idempotencyKey, assigned: i.assigned, title: i.title }); return { task: { id: `tsk_n${tasks.length}` } }; });
  h.callee("automations.alerts.get", () => ({ alerts }));
  h.callee("tasks.list", () => ({ tasks: [] }));
  h.callee("chat.start", (i) => { posts.push({ cap: "chat.start", input: i }); return { thread: { id: "thr_" + "1".repeat(32) } }; });
  h.callee("channels.get", () => ({ channel: { mainThreadId: "thr_" + "2".repeat(32) } }));
  h.callee("chat.post", (i) => { posts.push({ cap: "chat.post", input: i }); return { message: {} }; });
  return { h, tasks, posts };
}
/** Start a Run (an Automation's by default, owned by Alice) and fail it. */
async function failRun(h: Harness, over: Record<string, unknown> = {}, message = "The mailbox was not connected."): Promise<string> {
  const input = { subject: { type: "automation", id: AUT }, name: "Welcome email", ...over };
  for (const k of Object.keys(input)) if ((input as Record<string, unknown>)[k] === undefined) delete (input as Record<string, unknown>)[k];   // an absent subject is absent, not undefined
  const id = (await h.call("runs.start", newRun(input), engine)).runId as string;
  await h.call("runs.finish", { runId: id, status: "failed", error: { code: "step.failed", message } }, engine);
  return id;
}
const handle = (w: World, runId: string) => w.h.engineRun(engine, (ctx) => onRunFailed(ctx, { runId }));
const sweep = (w: World) => w.h.engineRun(engine, (ctx) => sweepEscalations(ctx));

test("a failure goes to the people in the settings and then up the chain, each link when its hours have passed", async () => {
  const w = world({ ...base, who: [maya, admins], escalation: [{ to: maya, afterHours: 1 }, { to: admins, afterHours: 4 }] });
  const id = await failRun(w.h);
  w.tasks.length = 0;   // the engine's own task for the owner is not what is under test
  const r = await handle(w, id);
  assert.equal(r.alerted, true);
  assert.deepEqual(r.told, ["needs_you:person:usr_maya", "needs_you:role:rol_admins"]);
  assert.deepEqual(w.tasks.map((t) => [t.key, t.assigned]), [[`run-alert:${id}:person:usr_maya`, maya], [`run-alert:${id}:role:rol_admins`, admins]]);
  assert.equal(findAlert(w.h.db, id)?.state, "open");

  w.h.advance(HOUR - MINUTE);
  assert.deepEqual(await sweep(w), []);
  w.h.advance(MINUTE);
  const first = await sweep(w);
  assert.deepEqual(first.map((e) => [e.runId, e.stage, e.to.id, e.afterHours]), [[id, 0, "usr_maya", 1]]);
  assert.deepEqual(w.tasks.at(-1), { key: `run-escalated:${id}:0`, assigned: maya, title: "Welcome email is still failing" });
  assert.equal(findAlert(w.h.db, id)?.state, "open");

  w.h.advance(3 * HOUR);
  const second = await sweep(w);
  assert.deepEqual(second.map((e) => [e.stage, e.to.id]), [[1, "rol_admins"]]);
  assert.equal(w.tasks.at(-1)!.key, `run-escalated:${id}:1`);
  assert.equal(findAlert(w.h.db, id)?.state, "done", "the chain is used up");
  assert.deepEqual(await sweep(w), []);
});

test("every link that is due is used in one sweep, in order (the server was down)", async () => {
  const w = world({ ...base, escalation: [{ to: admins, afterHours: 4 }, { to: maya, afterHours: 1 }] });
  const id = await failRun(w.h);
  await handle(w, id);
  w.h.advance(10 * HOUR);
  assert.deepEqual((await sweep(w)).map((e) => e.to.id), ["usr_maya", "rol_admins"], "sorted by hours, not by the order they were typed");
  assert.equal(findAlert(w.h.db, id)?.state, "done");
});

test("a Run somebody dealt with stops escalating: a retry, or an Unblock task that is done", async () => {
  const w = world({ ...base, escalation: [{ to: maya, afterHours: 1 }] });
  const retried = await failRun(w.h);
  await handle(w, retried);
  await w.h.call("runs.retry", { runId: retried }, alice);
  const asked = await failRun(w.h, { name: "Other" });
  await handle(w, asked);
  w.h.callee("tasks.list", (i) => ({ tasks: i.runId === asked ? [{ state: "done" }] : [] }));
  w.h.advance(HOUR);
  const before = w.tasks.length;
  assert.deepEqual(await sweep(w), []);
  assert.equal(w.tasks.length, before, "no escalation task for either");
  assert.equal(findAlert(w.h.db, retried)?.state, "resolved");
  assert.equal(findAlert(w.h.db, asked)?.state, "resolved");
  assert.equal(findAlert(w.h.db, asked)?.nextAt, undefined);
});

test("a failure is alerted once, however many times its event is seen", async () => {
  const w = world({ ...base, who: [maya], escalation: [{ to: maya, afterHours: 2 }] });
  const id = await failRun(w.h);
  assert.equal((await handle(w, id)).alerted, true);
  const n = w.tasks.length;
  assert.deepEqual(await handle(w, id), { alerted: false, reason: "already", told: [], failed: [] });
  assert.equal(w.tasks.length, n);
  w.h.advance(2 * HOUR);
  assert.equal((await sweep(w)).length, 1);
  assert.equal((await sweep(w)).length, 0, "and a link escalates once");
});

test("when = after N in a row: the first failures are kept quietly and never escalate; the Nth alerts", async () => {
  const w = world({ ...base, who: [maya], when: { mode: "after_n", n: 3 }, escalation: [{ to: admins, afterHours: 1 }] });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await failRun(w.h));
    w.h.advance(MINUTE);
  }
  w.tasks.length = 0;
  assert.equal((await handle(w, ids[0]!)).reason, "quiet");
  assert.equal((await handle(w, ids[1]!)).reason, "quiet");
  assert.equal(w.tasks.length, 0);
  assert.equal(findAlert(w.h.db, ids[0]!)?.state, "quiet");
  const third = await handle(w, ids[2]!);
  assert.equal(third.alerted, true);
  assert.deepEqual(w.tasks.map((t) => t.assigned), [maya]);
  w.h.advance(HOUR);
  assert.deepEqual((await sweep(w)).map((e) => e.runId), [ids[2]], "only the Run that alerted escalates");
});

test("a success in between starts the count again", async () => {
  const w = world({ ...base, who: [maya], when: { mode: "after_n", n: 2 } });
  const a = await failRun(w.h);
  w.h.advance(MINUTE);
  const ok = (await w.h.call("runs.start", newRun({ subject: { type: "automation", id: AUT }, name: "Welcome email" }), engine)).runId as string;
  await w.h.call("runs.finish", { runId: ok, status: "succeeded" }, engine);
  w.h.advance(MINUTE);
  const b = await failRun(w.h);
  assert.equal((await handle(w, a)).reason, "quiet");
  assert.equal((await handle(w, b)).reason, "quiet", "one failure since the success");
});

test("the owner is not given a second task; the engine's own is the one in their Needs you", async () => {
  const w = world({ ...base, who: [{ kind: "person", id: alice.id }, maya] });
  const id = await failRun(w.h);
  assert.deepEqual(w.tasks.map((t) => t.key), [`run-failed:${id}`], "the engine's task, made when the Run failed");
  const r = await handle(w, id);
  assert.deepEqual(r.told, ["needs_you:person:usr_maya"]);
  assert.deepEqual(w.tasks.map((t) => t.key), [`run-failed:${id}`, `run-alert:${id}:person:usr_maya`]);
});

test("Runs with no Automation settings (a routine, a deployment) and settings that cannot be read fall back to the owner alone", async () => {
  const w = world({ ...base, who: [maya], escalation: [{ to: maya, afterHours: 1 }] });
  const routine = await failRun(w.h, { kind: "routine", subject: undefined, name: "Morning inbox" });
  const r = await handle(w, routine);
  assert.deepEqual([r.alerted, r.told], [true, []]);
  assert.equal(w.h.calls.filter((c) => c.cap === "automations.alerts.get").length, 0);
  assert.equal(findAlert(w.h.db, routine)?.state, "done", "no chain, nothing to escalate");

  w.h.callee("automations.alerts.get", () => { throw new Error("automations is down"); });
  const id = await failRun(w.h);
  const again = await handle(w, id);
  assert.deepEqual([again.alerted, again.told], [true, []]);
});

test("test mode, replay and wait Runs never alert", async () => {
  const w = world({ ...base, who: [maya] });
  for (const kind of ["automation_test", "replay", "wait"]) {
    const id = await failRun(w.h, { kind });
    assert.equal((await handle(w, id)).reason, "not_tracked", kind);
    assert.equal(findAlert(w.h.db, id), undefined, kind);
  }
  const live = (await w.h.call("runs.start", newRun({ name: "Still going" }), engine)).runId as string;
  assert.equal((await handle(w, live)).reason, "not_failed");
  assert.equal((await handle(w, "run_" + "0".repeat(32))).reason, "not_failed");
});

test("where: a direct message to each person and a post in the channel; one that fails does not stop the others", async () => {
  const channelId = "chn_" + "c".repeat(32);
  const w = world({ ...base, who: [maya, admins], where: { needsYou: false, dm: true, channelId } });
  const id = await failRun(w.h);
  w.tasks.length = 0;
  w.h.callee("chat.start", () => { throw new Error("chat is down"); });
  const r = await handle(w, id);
  assert.equal(w.tasks.length, 0, "needsYou was off");
  assert.deepEqual(r.told, [`channel:${channelId}`]);
  assert.deepEqual(r.failed, [{ target: "dm:usr_maya", error: "chat is down" }]);
  assert.deepEqual(w.posts, [{ cap: "chat.post", input: { threadId: "thr_" + "2".repeat(32), body: "Welcome email failed: The mailbox was not connected.", idempotencyKey: `run-alert:${id}:channel:${channelId}` } }]);
  assert.deepEqual(findAlert(w.h.db, id)?.notified, [`channel:${channelId}`]);

  const ok = world({ ...base, who: [maya], where: { needsYou: false, dm: true } });
  const id2 = await failRun(ok.h);
  await handle(ok, id2);
  assert.deepEqual(ok.posts[0]!.input, { kind: "chat", agentIds: [], personId: "usr_maya", first: "Welcome email failed: The mailbox was not connected." });
});

test("a chain link that cannot take a task (a service) is passed over", async () => {
  const w = world({ ...base, escalation: [{ to: { kind: "service", id: "svc_x" }, afterHours: 1 }, { to: maya, afterHours: 2 }] });
  const id = await failRun(w.h);
  await handle(w, id);
  w.h.advance(2 * HOUR);
  assert.deepEqual((await sweep(w)).map((e) => e.to.id), ["usr_maya"]);
});

test("failed runs: listed once, newest first; a retried run is replaced by its retry; test runs, waits, successes and other people's runs are not in it", async () => {
  const w = world();
  const first = await failRun(w.h, { name: "A" });
  w.h.advance(MINUTE);
  const second = await failRun(w.h, { name: "B" });
  w.h.advance(MINUTE);
  const third = await failRun(w.h, { name: "C" });
  assert.deepEqual(failedQueue(w.h.db, alice.id).map((r) => r.id), [third, second, first]);

  w.h.advance(MINUTE);
  const retry = (await w.h.call("runs.retry", { runId: first }, alice)).runId as string;
  assert.deepEqual(failedQueue(w.h.db, alice.id).map((r) => r.id), [third, second], "the retry is queued, not failed; the original left the queue");
  w.h.advance(MINUTE);
  await w.h.call("runs.finish", { runId: retry, status: "failed", error: { code: "step.failed", message: "again" } }, engine);
  assert.deepEqual(failedQueue(w.h.db, alice.id).map((r) => r.id), [retry, third, second], "the failed retry is listed, the first run is not");

  await failRun(w.h, { kind: "automation_test" });
  await failRun(w.h, { kind: "wait" });
  await failRun(w.h, { owner: bob.id });
  const ok = (await w.h.call("runs.start", newRun(), engine)).runId as string;
  await w.h.call("runs.finish", { runId: ok, status: "succeeded" }, engine);
  assert.deepEqual(failedQueue(w.h.db, alice.id).map((r) => r.id), [retry, third, second]);
  assert.equal(failedQueue(w.h.db, bob.id).length, 1);
});
