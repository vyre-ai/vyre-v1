// A person undoing a Run an agent made teaches that agent: runs.undo tells memory (memory.corrections.record, how "reverse") for each agent whose writes the Run holds, with the chat the Run came from
// (so a chat other people read keeps nothing without the person's own words). A Run no agent wrote, a Run nothing of which was undone, and a failing memory change nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, engine, newRun } from "../fixtures/seed.ts";

interface Logged { seq: number; id: string; type: string; at: number; actor: string; subject?: { type: string; id: string }; runId?: string; payload: Record<string, unknown> }

function world(h: Harness) {
  const log: Logged[] = [];
  let seq = 0;
  const add = (type: string, actor: string, over: Partial<Logged> = {}): Logged => { const e: Logged = { seq: ++seq, id: `evt_e${seq}`, type, at: h.now(), actor, payload: {}, ...over }; log.push(e); h.advance(1); return e; };
  h.callee("events.list", (input) => ({ events: log.filter((e) => (input.runId === undefined || e.runId === input.runId) && (input.subject === undefined || (e.subject?.type === input.subject.type && e.subject.id === input.subject.id))) }));
  h.callee("records.update", () => ({}));
  h.callee("records.delete", () => ({}));
  return { add };
}
async function aRun(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  const id = (await h.call("runs.start", newRun({ owner: alice.id, ...over }), engine)).runId as string;
  await h.call("runs.finish", { runId: id, status: "succeeded" }, engine);
  return id;
}
const upd = (recordId: string) => ({ subject: { type: "record", id: recordId }, payload: { recordId, type: "contact", fields: { status: "active" }, prev: { status: "new" }, version: 2 } });
const taught = (h: Harness) => h.calls.filter((c) => c.cap === "memory.corrections.record").map((c) => c.input as Record<string, unknown>);

test("undoing a Run an agent wrote keeps a lesson for that agent, with what was put back and the chat of the Run", async () => {
  const h = harness();
  const w = world(h);
  h.callee("memory.corrections.record", () => ({ kept: true }));
  const run = await aRun(h, { threadId: "thr_1" });
  h.callee("runs.get", () => ({ run: { threadId: "thr_1" } }));
  w.add("record.updated", "agt_bot", { runId: run, ...upd("rec_1") });
  w.add("record.updated", "agt_bot", { runId: run, ...upd("rec_2") });
  await h.call("runs.undo", { runId: run }, alice);
  const c = taught(h);
  assert.equal(c.length, 1);
  assert.equal(c[0]!["agentId"], "agt_bot");
  assert.equal(c[0]!["how"], "reverse");
  assert.equal(c[0]!["threadId"], "thr_1");
  assert.match(String(c[0]!["was"]), /Put back status on contact rec_/);
  assert.equal(c[0]!["ref"], `reverse:run:${run}`);
});

test("two agents in one Run are each taught; an automation or a person alone teaches nothing", async () => {
  const h = harness();
  const w = world(h);
  h.callee("memory.corrections.record", () => ({ kept: true }));
  h.callee("runs.get", () => ({ run: {} }));
  const run = await aRun(h);
  w.add("record.updated", "agt_a", { runId: run, ...upd("rec_1") });
  w.add("record.updated", "agt_b", { runId: run, ...upd("rec_2") });
  await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(taught(h).map((x) => x["agentId"]).sort(), ["agt_a", "agt_b"]);
  assert.equal(taught(h)[0]!["threadId"], undefined);
  const h2 = harness();
  const w2 = world(h2);
  h2.callee("memory.corrections.record", () => ({ kept: true }));
  const run2 = await aRun(h2);
  w2.add("record.updated", "svc_0123456789abcdef0123456789abcdef", { runId: run2, ...upd("rec_1") });
  w2.add("record.updated", "usr_alice", { runId: run2, ...upd("rec_2") });
  await h2.call("runs.undo", { runId: run2 }, alice);
  assert.equal(taught(h2).length, 0);
});

test("nothing undone teaches nothing, and a memory that fails does not hold the undo up", async () => {
  const h = harness();
  const w = world(h);
  h.callee("memory.corrections.record", () => { throw new Error("memory is down"); });
  h.callee("runs.get", () => ({ run: {} }));
  const run = await aRun(h);
  w.add("record.updated", "agt_bot", { runId: run, ...upd("rec_1") });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.equal(r.undone.length, 1, "the undo happened");
  const h2 = harness();
  const w2 = world(h2);
  h2.callee("memory.corrections.record", () => ({ kept: true }));
  h2.callee("runs.get", () => ({ run: {} }));
  const run2 = await aRun(h2);
  w2.add("record.updated", "agt_bot", { runId: run2, subject: { type: "record", id: "rec_9" }, payload: { recordId: "rec_9", type: "contact", fields: { status: "active" }, version: 2 } });   // no old values: not undoable
  const r2 = await h2.call("runs.undo", { runId: run2 }, alice);
  assert.equal(r2.undone.length, 0);
  assert.equal(taught(h2).length, 0);
});
