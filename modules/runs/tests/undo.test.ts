// "Undo this run" (spec 4.5, ARCH 4.7): the inverse of a Run's writes is replayed for events still at the Run's version; the rest is reported. Sent messages and deployments are not undoable.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine, newRun, MINUTE } from "../fixtures/seed.ts";
import { readExtra } from "../projections.ts";

interface Logged { seq: number; id: string; type: string; at: number; subject?: { type: string; id: string }; runId?: string; payload: Record<string, unknown> }

/** A stand-in for the event log and the records module: events.list reads the log in pages of two; records.* calls are kept and, like the real ones, write events (with no run id). */
function world(h: Harness) {
  const log: Logged[] = [];
  const done: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  let seq = 0;
  const add = (type: string, over: Partial<Logged> & { payload?: Record<string, unknown> } = {}): Logged => {
    const e: Logged = { seq: ++seq, id: `evt_e${seq}`, type, at: h.now(), payload: {}, ...over };
    log.push(e);
    h.advance(1);
    return e;
  };
  h.callee("events.list", (input) => {
    let rows = log.filter((e) => (input.runId === undefined || e.runId === input.runId)
      && (input.subject === undefined || (e.subject?.type === input.subject.type && e.subject.id === input.subject.id))
      && (input.from === undefined || e.at >= input.from));
    rows = rows.sort((a, b) => a.seq - b.seq);
    const start = input.cursor ? Number(input.cursor) : 0;
    const out: { events: Logged[]; next?: string } = { events: rows.slice(start, start + 2) };
    if (start + 2 < rows.length) out.next = String(start + 2);
    return out;
  });
  const fail = new Map<string, Error>();
  for (const cap of ["records.update", "records.delete", "records.restore"]) {
    h.callee(cap, (input) => {
      const boom = fail.get(`${cap}:${input.recordId}`);
      if (boom) throw boom;
      done.push({ cap, input });
      add(cap === "records.update" ? "record.updated" : cap === "records.delete" ? "record.deleted" : "record.restored", { subject: { type: "record", id: input.recordId }, payload: { recordId: input.recordId } });
      return {};
    });
  }
  h.callee("records.create", () => ({}));
  return { log, done, add, fail };
}
const refusal = (code: string): Error => Object.assign(new Error(code), { error: { code, message: code, retryable: false } });

async function aRun(h: Harness, who = alice): Promise<string> {
  const id = (await h.call("runs.start", newRun({ owner: who.id }), engine)).runId as string;
  await h.call("runs.finish", { runId: id, status: "succeeded" }, engine);
  return id;
}
const upd = (recordId: string, fields: Record<string, unknown>, prev: Record<string, unknown>) => ({ subject: { type: "record", id: recordId }, payload: { recordId, type: "contact", fields, prev, version: 2 } });
const rec = (recordId: string, extra: Record<string, unknown> = {}) => ({ subject: { type: "record", id: recordId }, payload: { recordId, type: "contact", ...extra } });

test("undo puts back the old values of what the Run updated and says so", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  const e = w.add("record.updated", { runId: run, ...upd("rec_1", { status: "active" }, { status: "new" }) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(w.done, [{ cap: "records.update", input: { recordId: "rec_1", patch: { status: "new" } } }]);
  assert.equal(r.undone.length, 1);
  assert.equal(r.undone[0].eventId, e.id);
  assert.match(r.undone[0].summary, /Put back status on contact rec_1/);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(h.events.map((x) => x.name), ["run.undone"]);
  assert.deepEqual(h.events[0]!.payload, { runId: run, undone: 1, skipped: 0 });
  assert.ok(readExtra(h.db, run).undoneAt, "the undo is recorded on the Run");
});

test("created records are removed, deleted ones restored, and the inverses run newest first", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  w.add("record.created", { runId: run, ...rec("rec_new", { fields: { name: "A" } }) });
  w.add("record.deleted", { runId: run, ...rec("rec_old", { prev: { name: "B" } }) });
  w.add("record.updated", { runId: run, ...upd("rec_mid", { n: 2 }, { n: 1 }) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(w.done.map((d) => `${d.cap}:${d.input.recordId}`), ["records.update:rec_mid", "records.restore:rec_old", "records.delete:rec_new"]);
  assert.equal(r.undone.length, 3);
});

test("a record the Run changed twice goes back to where it started; the Run's own later writes are not 'changed since'", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  w.add("record.updated", { runId: run, ...upd("rec_1", { n: 2 }, { n: 1 }) });
  w.add("record.updated", { runId: run, ...upd("rec_1", { n: 3 }, { n: 2 }) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(w.done.map((d) => d.input.patch), [{ n: 2 }, { n: 1 }]);
  assert.equal(r.undone.length, 2);
  assert.deepEqual(r.skipped, []);
});

test("a write by anyone else after the Run's keeps that row as it is and is reported", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  const mine = w.add("record.updated", { runId: run, ...upd("rec_1", { status: "active" }, { status: "new" }) });
  h.advance(MINUTE);
  w.add("record.updated", upd("rec_1", { status: "won" }, { status: "active" }));
  w.add("record.updated", { runId: run, ...upd("rec_2", { status: "active" }, { status: "new" }) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(w.done.map((d) => d.input.recordId), ["rec_2"]);
  assert.equal(r.undone.length, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].eventId, mine.id);
  assert.equal(r.skipped[0].reason, "changed_since");
  assert.match(r.skipped[0].summary, /contact rec_1 changed after the run/);
});

test("sent messages, deployments and unknown writes are listed as not undoable; bookkeeping events are left out", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  const sent = w.add("message.sent", { runId: run, subject: { type: "message", id: "msg_1" } });
  const sig = w.add("signature.sent", { runId: run });
  const dep = w.add("site.deployed", { runId: run, subject: { type: "site", id: "sit_1" } });
  const other = w.add("memory.fact_added", { runId: run });
  w.add("run.waiting", { runId: run, payload: { runId: run } });
  w.add("task.created", { runId: run });
  const noPrev = w.add("record.updated", { runId: run, ...upd("rec_9", { a: 1 }, {}) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(w.done, []);
  const by = Object.fromEntries(r.skipped.map((s: { eventId: string; reason: string }) => [s.eventId, s.reason]));
  assert.deepEqual(by, { [sent.id]: "sent", [sig.id]: "sent", [dep.id]: "deployed", [other.id]: "not_undoable", [noPrev.id]: "not_undoable" });
  assert.deepEqual(r.undone, []);
  assert.deepEqual(h.events[0]!.payload, { runId: run, undone: 0, skipped: 5 });
});

test("preview shows the same split without writing anything", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  w.add("record.created", { runId: run, ...rec("rec_a") });
  w.add("message.sent", { runId: run });
  const p = await h.call("runs.preview_undo", { runId: run }, alice);
  assert.equal(p.undone.length, 1);
  assert.equal(p.skipped.length, 1);
  assert.equal(p.skipped[0].reason, "sent");
  assert.deepEqual(w.done, []);
  assert.deepEqual(h.events, []);
  assert.equal(readExtra(h.db, run).undoneAt, undefined);
  const real = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(real.undone.map((u: { eventId: string }) => u.eventId), p.undone.map((u: { eventId: string }) => u.eventId));
});

test("an inverse that fails does not stop the rest: a version conflict is 'changed since', anything else 'not undoable'", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  w.add("record.updated", { runId: run, ...upd("rec_a", { n: 2 }, { n: 1 }) });
  w.add("record.updated", { runId: run, ...upd("rec_b", { n: 2 }, { n: 1 }) });
  w.add("record.updated", { runId: run, ...upd("rec_c", { n: 2 }, { n: 1 }) });
  w.fail.set("records.update:rec_b", refusal("validation.version_conflict"));
  w.fail.set("records.update:rec_a", refusal("permission.no_grant"));
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.deepEqual(r.undone.map((u: { summary: string }) => u.summary.includes("rec_c")), [true]);
  const reasons = Object.fromEntries(r.skipped.map((s: { summary: string; reason: string }) => [s.summary.match(/rec_[a-z]/)![0], s.reason]));
  assert.deepEqual(reasons, { rec_b: "changed_since", rec_a: "not_undoable" });
  assert.deepEqual(h.events[0]!.payload, { runId: run, undone: 1, skipped: 2 });
});

test("undoing twice does nothing the second time: the first undo's own writes are later writes", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  w.add("record.updated", { runId: run, ...upd("rec_1", { n: 2 }, { n: 1 }) });
  assert.equal((await h.call("runs.undo", { runId: run }, alice)).undone.length, 1);
  const again = await h.call("runs.undo", { runId: run }, alice);
  assert.equal(again.undone.length, 0);
  assert.equal(again.skipped[0].reason, "changed_since");
  assert.equal(w.done.length, 1);
});

test("a long log is read in pages", async () => {
  const h = harness();
  const w = world(h);
  const run = await aRun(h);
  for (let i = 0; i < 5; i++) w.add("record.created", { runId: run, ...rec(`rec_${i}`) });
  const r = await h.call("runs.undo", { runId: run }, alice);
  assert.equal(r.undone.length, 5);
});

test("who may undo: the owner or a Manage holder; not while the Run is still going; not without the log", async () => {
  const h = harness({ authorize: (who, a) => who.id === bob.id && a.level === "view" });
  const w = world(h);
  const run = await aRun(h);
  w.add("record.created", { runId: run, ...rec("rec_a") });
  await assert.rejects(h.call("runs.undo", { runId: run }, bob), (e) => { assert.equal(codeOf(e), "permission.role_lacks_permission"); assert.equal(reasonOf(e), "manage_required"); return true; });
  assert.equal((await h.call("runs.preview_undo", { runId: run }, bob)).undone.length, 1, "seeing is enough to preview");
  const live = (await h.call("runs.start", newRun(), engine)).runId as string;
  await assert.rejects(h.call("runs.undo", { runId: live }, alice), (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), "run_active"); return true; });
  await assert.rejects(h.call("runs.undo", { runId: "run_nothere" }, alice), (e) => codeOf(e) === "permission.not_found");
  assert.deepEqual(w.done, []);
});
