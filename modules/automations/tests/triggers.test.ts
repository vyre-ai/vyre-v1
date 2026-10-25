// Starting Runs and the trigger consumer (spec 2.12, 3.7): self-trigger dropped unless allowed, chain depth limit 8, matching and payloads, test mode, manual runs, stop, retry.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, engine, goodDefinition, node } from "../fixtures/seed.ts";
import { consumeEvent, loadRunPlan } from "../impl.ts";
import type { LoggedEvent } from "../handlers/triggers.ts";
import { findRunLink } from "../projections.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const live = async (h: Harness, over: Record<string, unknown> = {}): Promise<string> => {
  const id = (await h.call("automations.create", create(over), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  return id;
};
const fire = (h: Harness, id: string, over: Record<string, unknown> = {}): Promise<any> =>   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.call("automations.fire", { automationId: id, trigger: "record_change", eventId: "evt_one", payload: { recordId: "rec_abc" }, depth: 0, ...over }, engine);
const change = (over: Partial<LoggedEvent> = {}): LoggedEvent => ({
  id: "evt_c1", type: "record.updated", payload: { recordId: "rec_1", type: "contact", fields: { status: "won" }, prev: { status: "new" }, version: 3 }, depth: 0, ...over,
});

// ---- self-trigger and chain depth ----

test("an Automation does not trigger itself: an event it caused is dropped and says why", async () => {
  const h = harness();
  const id = await live(h);
  const r = await fire(h, id, { origin: `automation:${id}`, depth: 1, eventId: "evt_self" });
  assert.deepEqual(r, { dropped: "self_trigger" });
  assert.deepEqual(h.events.map((e) => e.name), ["automation.trigger_dropped"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, eventId: "evt_self", reason: "self_trigger" });
  assert.equal(h.runs.length, 0);
});

test("a Run caused by another Automation, or by a person, does start", async () => {
  const h = harness();
  const id = await live(h);
  const other = await fire(h, id, { origin: "automation:aut_other", depth: 1, eventId: "evt_a" });
  assert.ok(other.runId);
  const person = await fire(h, id, { origin: "user", depth: 0, eventId: "evt_b" });
  assert.ok(person.runId);
  assert.equal(h.runs.length, 2);
  assert.deepEqual(h.events.map((e) => e.name), ["automation.run_started"]);
});

test("self-trigger is allowed when the definition says so", async () => {
  const h = harness();
  const id = await live(h, { definition: goodDefinition({ allowSelfTrigger: true }) });
  const r = await fire(h, id, { origin: `automation:${id}`, depth: 1 });
  assert.ok(r.runId);
  assert.equal(findRunLink(h.db, r.runId)!.origin, `automation:${id}`);
});

test("the chain stops at depth 8: events from the eighth hop on do not start a Run", async () => {
  const h = harness();
  const a = await live(h);
  const b = await live(h, { definition: goodDefinition({ allowSelfTrigger: true }) });
  assert.ok((await fire(h, a, { depth: 7, eventId: "evt_d7" })).runId, "the eighth Run is the last");
  assert.deepEqual(await fire(h, a, { depth: 8, eventId: "evt_d8" }), { dropped: "depth_limit" });
  assert.deepEqual(await fire(h, b, { depth: 8, origin: `automation:${b}`, eventId: "evt_d8b" }), { dropped: "depth_limit" }, "allowing self-trigger does not lift the limit");
  assert.deepEqual(await fire(h, a, { depth: 40, eventId: "evt_d40" }), { dropped: "depth_limit" });
  assert.equal(h.events[0]!.payload.reason, "depth_limit");
  assert.equal(h.runs.length, 1);
});

test("the Space can lower the limit but never raise it above 8", async () => {
  const h = harness();
  const id = await live(h);
  h.policy("automations.max_chain_depth", 3);
  assert.ok((await fire(h, id, { depth: 2, eventId: "evt_e2" })).runId);
  assert.deepEqual(await fire(h, id, { depth: 3, eventId: "evt_e3" }), { dropped: "depth_limit" });
  h.policy("automations.max_chain_depth", 50);
  assert.deepEqual(await fire(h, id, { depth: 8, eventId: "evt_e8" }), { dropped: "depth_limit" });
});

test("a chain of Automations ends at the limit when each one's events trigger the next", async () => {
  const h = harness();
  const id = await live(h, { definition: goodDefinition({ allowSelfTrigger: true }) });
  let started = 0;
  let depth = 0;
  for (let i = 0; i < 20; i++) {
    const out = await consumeEvent(h.ctxFor(null, engine), change({ id: `evt_chain${i}`, origin: depth ? `automation:${id}` : "user", depth }));
    if (!("runId" in out[0]!.result)) break;
    started += 1;
    depth += 1;
  }
  assert.equal(started, 8);
});

test("an Automation that is off, paused or in draft does not fire", async () => {
  const h = harness();
  const draft = (await h.call("automations.create", create(), alice)).automation.id as string;
  assert.deepEqual(await fire(h, draft), { dropped: "paused" });
  const id = await live(h);
  await h.call("automations.set_enabled", { automationId: id, enabled: false }, alice);
  assert.deepEqual(await fire(h, id, { eventId: "evt_off" }), { dropped: "paused" });
  assert.equal(h.events[0]!.payload.reason, "paused");
  await refused(fire(h, id, { trigger: "teleport" }), "validation.bad_input");
  await refused(fire(h, id, { trigger: "schedule" }), "validation.precondition_failed", "no_such_trigger");
});

test("the same event fires an Automation once", async () => {
  const h = harness();
  const id = await live(h);
  const a = await fire(h, id, { eventId: "evt_dup" });
  const b = await fire(h, id, { eventId: "evt_dup" });
  assert.equal(a.runId, b.runId);
  assert.equal(h.runs.length, 1);
  assert.deepEqual(h.events, [], "the repeat said nothing");
});

// ---- the consumer ----

test("the consumer starts a Run for each enabled Automation whose trigger matches, with the record change reshaped", async () => {
  const h = harness();
  const hit = await live(h, { name: "Contacts", definition: goodDefinition({ triggers: [{ key: "record_change", filter: { type: "contact", op: "updated", fields: ["status"] } }] }) });
  await live(h, { name: "Deals", definition: goodDefinition({ triggers: [{ key: "record_change", filter: { type: "deal" } }] }) });
  await h.call("automations.create", create({ name: "Draft" }), alice);
  const res = await h.consumer(engine, (ctx) => consumeEvent(ctx, change()));
  assert.equal(res.length, 1);
  assert.equal(res[0]!.automationId, hit);
  const runId = (res[0]!.result as { runId: string }).runId;
  const plan = loadRunPlan({ db: h.db }, runId)!;
  assert.equal(plan.link.trigger, "record_change");
  assert.equal(plan.link.eventId, "evt_c1");
  assert.equal(plan.link.depth, 0);
  assert.deepEqual(plan.link.payload, { record: { status: "won" }, recordId: "rec_1", type: "contact", op: "updated", fields: ["status"], changed: { status: "won" }, version: 3 });
  assert.deepEqual(h.events.map((e) => e.name), ["automation.run_started"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: hit, runId, trigger: "record_change", version: 1, test: false, depth: 0 });
});

test("the filter narrows by type, operation, changed field and values", async () => {
  const h = harness();
  const mk = (filter: unknown) => live(h, { name: JSON.stringify(filter), definition: goodDefinition({ triggers: [{ key: "record_change", filter }] }) });
  const created = await mk({ type: "contact", op: "created" });
  const field = await mk({ type: "contact", fields: ["email"] });
  const where = await mk({ type: "contact", where: { status: "won" } });
  const wrongWhere = await mk({ type: "contact", where: { status: "lost" } });
  const any = await mk({ type: "contact" });
  const fired = (await h.consumer(engine, (ctx) => consumeEvent(ctx, change()))).map((r) => r.automationId).sort();
  assert.deepEqual(fired, [where, any].sort());
  const made = (await h.consumer(engine, (ctx) => consumeEvent(ctx, change({ id: "evt_c2", type: "record.created", payload: { recordId: "rec_2", type: "contact", fields: { email: "a@b.c", status: "won" } } })))).map((r) => r.automationId).sort();
  assert.deepEqual(made, [created, field, where, any].sort(), "a new record matches a field filter when it sets one of the fields");
  assert.ok(!made.includes(wrongWhere));
});

test("a broken filter is reported, not guessed", async () => {
  const h = harness();
  const id = await live(h, { definition: goodDefinition({ triggers: [{ key: "record_change", filter: { type: "contact", fields: "status" } }] }) });
  const res = await h.consumer(engine, (ctx) => consumeEvent(ctx, change()));
  assert.deepEqual(res, [{ automationId: id, result: { dropped: "filter_error" } }]);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, eventId: "evt_c1", reason: "filter_error" });
});

test("a paused Automation reports each event it ignores; one that is off stays silent", async () => {
  const h = harness();
  const id = await live(h);
  const off = await live(h, { name: "Off" });
  await h.call("automations.set_enabled", { automationId: off, enabled: false }, alice);
  await h.call("automations.stop", { automationId: id }, alice);
  const res = await h.consumer(engine, (ctx) => consumeEvent(ctx, change()));
  assert.deepEqual(res, [{ automationId: id, result: { dropped: "paused" } }]);
  assert.equal(h.events[0]!.payload.reason, "paused");
});

test("the consumer drops what an Automation caused itself and what is too deep", async () => {
  const h = harness();
  const id = await live(h);
  const own = await h.consumer(engine, (ctx) => consumeEvent(ctx, change({ id: "evt_own", origin: `automation:${id}`, depth: 1 })));
  assert.deepEqual(own[0]!.result, { dropped: "self_trigger" });
  const deep = await h.consumer(engine, (ctx) => consumeEvent(ctx, change({ id: "evt_deep", origin: "automation:aut_x", depth: 8 })));
  assert.deepEqual(deep[0]!.result, { dropped: "depth_limit" });
  assert.equal(h.runs.length, 0);
});

test("what an importer or a sync backfill writes does not fire Automations unless the Space turns that on", async () => {
  const h = harness();
  await live(h);
  assert.deepEqual(await h.consumer(engine, (ctx) => consumeEvent(ctx, change({ id: "evt_imp", imported: true }))), []);
  h.policy("automations.run_automations_on_import", true);
  assert.equal((await h.consumer(engine, (ctx) => consumeEvent(ctx, change({ id: "evt_imp2", imported: true })))).length, 1);
});

test("other triggers match by event name and payload", async () => {
  const h = harness();
  const form = await live(h, { definition: { triggers: [{ key: "form_submit", filter: { formId: "frm_one" } }], nodes: [] } });
  await live(h, { definition: { triggers: [{ key: "email_received" }], nodes: [] } });
  const ev: LoggedEvent = { id: "evt_f", type: "form.submitted", payload: { formId: "frm_one", recordId: "rec_1", type: "contact", matched: true } };
  const res = await h.consumer(engine, (ctx) => consumeEvent(ctx, ev));
  assert.deepEqual(res.map((r) => r.automationId), [form]);
  const other = await h.consumer(engine, (ctx) => consumeEvent(ctx, { ...ev, id: "evt_g", payload: { ...ev.payload, formId: "frm_two" } }));
  assert.deepEqual(other, []);
  const mail = await h.consumer(engine, (ctx) => consumeEvent(ctx, { id: "evt_m", type: "sms.received", payload: { messageId: "m1" } }));
  assert.equal(mail.length, 1, "email_received covers texts too");
});

// ---- test, run, stop, retry ----

test("test mode starts a test Run with the trigger's sample, reading for real and stubbing writes; any status", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create(), alice)).automation.id as string;
  const r = await h.call("automations.test", { automationId: id }, alice);
  assert.equal(h.runs[0]!.kind, "automation_test");
  const link = findRunLink(h.db, r.runId)!;
  assert.equal(link.test, true);
  assert.equal(link.trigger, "record_change");
  assert.equal((link.payload as { recordId: string }).recordId, "rec_a1b2c3", "the trigger's sample");
  assert.deepEqual(link.principal, { kind: "person", id: alice.id });
  assert.deepEqual(h.events[0]!.payload, { automationId: id, runId: r.runId, trigger: "record_change", version: 1, test: true, depth: 0 });
  const mine = await h.call("automations.test", { automationId: id, trigger: "manual", sample: { startedBy: "usr_x" } }, alice);
  assert.deepEqual(findRunLink(h.db, mine.runId)!.payload, { startedBy: "usr_x" });
  await refused(h.call("automations.test", { automationId: id, trigger: "teleport" }, alice), "validation.bad_input");
});

test("run starts by hand: the manual trigger, the caller's payload, once per key", async () => {
  const h = harness();
  const id = await live(h);
  const a = await h.call("automations.run", { automationId: id, payload: { note: "go" }, idempotencyKey: "k1" }, alice);
  const link = findRunLink(h.db, a.runId)!;
  assert.equal(link.trigger, "manual");
  assert.deepEqual(link.payload, { startedBy: alice.id, input: { note: "go" } });
  assert.equal(h.runs[0]!.kind, "automation");
  assert.equal(h.runs[0]!.owner, alice.id);
  assert.deepEqual(h.runs[0]!.subject, { type: "automation", id });
  const again = await h.call("automations.run", { automationId: id, idempotencyKey: "k1" }, alice);
  assert.equal(again.runId, a.runId);
  assert.equal(h.runs.length, 1);
  const button = await h.call("automations.run", { automationId: id, trigger: "button", payload: { label: "Go" } }, alice);
  assert.deepEqual(findRunLink(h.db, button.runId)!.payload, { pressedBy: alice.id, label: "Go" });
  await refused(h.call("automations.run", { automationId: id, trigger: "schedule" }, alice), "validation.precondition_failed", "not_manual");
});

test("run is refused for a paused Automation and for a definition with errors", async () => {
  const h = harness();
  const id = await live(h);
  await h.call("automations.stop", { automationId: id }, alice);
  await refused(h.call("automations.run", { automationId: id }, alice), "validation.precondition_failed", "paused");
  const bad = (await h.call("automations.create", create({ definition: goodDefinition({ nodes: [node("a", "records.update", {})] }) }), alice)).automation.id as string;
  await refused(h.call("automations.run", { automationId: bad }, alice), "validation.precondition_failed", "invalid_definition");
});

test("stop ends one Run, or every active Run and pauses the Automation", async () => {
  const h = harness();
  const id = await live(h);
  const r1 = await h.call("automations.run", { automationId: id }, alice);
  await h.call("automations.run", { automationId: id }, alice);
  await h.call("automations.run", { automationId: id }, alice);
  h.runs[2]!.status = "succeeded";
  const one = await h.call("automations.stop", { automationId: id, runId: r1.runId }, alice);
  assert.equal(one.stopped, 1);
  assert.equal(h.runs[0]!.status, "stopped");
  assert.equal((await h.call("automations.get", { automationId: id }, alice)).automation.status, "on", "one Run stopped, the Automation keeps going");
  assert.deepEqual(h.events, []);
  const all = await h.call("automations.stop", { automationId: id }, alice);
  assert.equal(all.stopped, 1, "r2 only: r1 is already stopped and r3 finished");
  assert.equal(h.runs[1]!.status, "stopped");
  const a = (await h.call("automations.get", { automationId: id }, alice)).automation;
  assert.equal(a.status, "paused");
  assert.equal(a.pausedReason, `Stopped by ${alice.id}`);
  await refused(h.call("automations.stop", { automationId: id, runId: "run_t99" }, alice), "validation.precondition_failed", "not_a_run_of_this");
});

test("stop with pause false only stops the Runs; the event for a pause says why", async () => {
  const h = harness();
  const id = await live(h);
  await h.call("automations.run", { automationId: id }, alice);
  await h.call("automations.stop", { automationId: id, pause: false }, alice);
  assert.equal((await h.call("automations.get", { automationId: id }, alice)).automation.status, "on");
  await h.call("automations.stop", { automationId: id, pause: true }, alice);
  assert.deepEqual(h.events.map((e) => e.name), ["automation.disabled"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, reason: `Stopped by ${alice.id}` });
});

test("retry starts the failed Run again on its own version and payload; it must be this Automation's Run", async () => {
  const h = harness();
  const id = await live(h);
  const other = await live(h, { name: "Other" });
  const first = await h.call("automations.run", { automationId: id, payload: { n: 1 } }, alice);
  await h.call("automations.update", { automationId: id, definition: goodDefinition({ allowSelfTrigger: true }) }, alice);
  h.runs[0]!.status = "failed";
  const r = await h.call("automations.retry", { automationId: id, runId: first.runId, fromStep: "a" }, alice);
  assert.notEqual(r.runId, first.runId);
  const link = findRunLink(h.db, r.runId)!;
  assert.equal(link.version, 1, "the retry keeps the version of the Run it retries");
  assert.equal(link.parentRun, first.runId);
  assert.deepEqual(link.payload, { startedBy: alice.id, input: { n: 1 } });
  assert.equal(h.calls.filter((c) => c.cap === "runs.retry").length, 1);
  assert.deepEqual(h.calls.find((c) => c.cap === "runs.retry")!.input, { runId: first.runId, fromStep: "a" });
  assert.deepEqual(h.events.map((e) => e.name), ["automation.run_started"]);
  await refused(h.call("automations.retry", { automationId: other, runId: first.runId }, alice), "validation.precondition_failed", "not_a_run_of_this");
});
