// Approval, denial and timeout of a hold (spec 2.14, ARCH 4.6, golden 7): the sealed approval token, release exactly once, send-back and drop, timeout escalation then drop,
// the email backstop, and the sweep. The neighbours (tasks, runs, scheduler, notifications) are fakes that record their calls.
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, NOW, alice, as, bob, bot, bot2, parkInput } from "../fixtures/seed.ts";
import { recover, sweep } from "../impl.ts";
import { findHold } from "../projections.ts";

const svc = { id: "svc_host", kind: "service" as const };
const person = (p: { id: string }, device = "dev_1") => ({ id: p.id, kind: "person" as const, device });
type Parked = { holdId: string; taskId: string };

async function park(h: Harness, over: Record<string, unknown> = {}, who = as(bot)): Promise<Parked> {
  return h.call("gate.park", parkInput(over), who);
}
function claims(h: Harness, p: Parked, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { task: p.taskId, hold: p.holdId, decision: "dec_1", hash: "ph_1", by: alice.id, forPerson: null, device: "dev_1", exp: h.now() + 10 * 60_000, ...over };
}
async function release(h: Harness, p: Parked, over: Record<string, unknown> = {}, who: { id: string; kind?: "person" | "agent"; device?: string } = person(alice)): Promise<{ result: unknown }> {
  return h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: h.sealToken(claims(h, p, over)) }, who);
}
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const sent = (h: Harness): number => h.callsTo("mail.send").length;

// ---- release ----

test("a valid approval re-invokes the parked call as its original caller, once, and settles everything", async () => {
  const h = harness();
  h.callee("mail.send", () => ({ messageId: "msg_1" }));
  const p = await park(h, { runId: "run_1" });
  const before = h.calls.length;
  const r = await release(h, p);
  assert.deepEqual(r, { result: { messageId: "msg_1" } });
  const call = h.calls.slice(before).find((c) => c.cap === "mail.send")!;
  assert.deepEqual(call.input, parkInput().input, "exactly what was held");
  assert.equal(call.opts?.idempotencyKey, p.holdId);
  assert.ok(call.opts?.approvalToken?.startsWith("apv_"));
  assert.equal(call.opts?.onBehalfOf, bot.id, "as the agent that asked, not as the approver");
  const hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "approved");
  assert.equal(hold.decidedBy, alice.id);
  assert.equal(hold.sendingAt, undefined);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["gate.approved", { holdId: p.holdId, act: "send", taskId: p.taskId, by: alice.id }]]);
  assert.equal(h.callsTo("scheduler.cancel").length, 2, "both timers are canceled");
  assert.deepEqual(h.callsTo("runs.resume")[0]!.input, { runId: "run_1", reason: "approval" });
  await refused(release(h, p), "validation.precondition_failed", "not_held");
  assert.equal(sent(h), 1);
});

test("an approval that is not valid for this hold, this person and this device sends nothing", async () => {
  const h = harness();
  h.callee("mail.send", () => ({}));
  const p = await park(h);
  const bad = (name: string, over: Record<string, unknown>, code: string, reason?: string, who = person(alice)) => refused(release(h, p, over, who), code, reason).then(() => name);
  await bad("expired", { exp: h.now() - 1 }, "permission.expired");
  await bad("another task", { task: "tsk_other" }, "validation.precondition_failed", "token_mismatch");
  await bad("another hold", { hold: "hld_other" }, "validation.precondition_failed", "token_mismatch");
  await bad("another decision", { decision: "dec_x" }, "validation.precondition_failed", "token_mismatch");
  await bad("another payload", { hash: "ph_x" }, "validation.precondition_failed", "token_mismatch");
  await bad("given by someone else", { by: bob.id }, "validation.precondition_failed", "token_mismatch");
  await bad("another device", {}, "validation.precondition_failed", "device_mismatch", person(alice, "dev_2"));
  await refused(h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: "nope" }, person(alice)), "validation.precondition_failed", "bad_token");
  await refused(h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: "apv_garbage" }, person(alice)), "validation.precondition_failed", "bad_token");
  await refused(h.call("gate.release", { holdId: p.holdId, taskId: "tsk_other", approvalToken: h.sealToken(claims(h, p)) }, person(alice)), "validation.precondition_failed", "task_mismatch");
  await refused(h.call("gate.release", { holdId: "hld_nothing", taskId: p.taskId, approvalToken: h.sealToken(claims(h, p)) }, person(alice)), "permission.not_found");
  assert.equal(sent(h), 0);
  assert.equal(findHold(h.db, p.holdId)!.state, "held");
  assert.equal(findHold(h.db, p.holdId)!.sendingAt, undefined, "a refused approval leaves no half-sent mark");
});

test("a token without the device is fine for a caller with no device claim", async () => {
  const h = harness();
  h.callee("mail.send", () => ({}));
  const p = await park(h);
  await release(h, p, { device: null }, person(alice, "dev_9"));
  assert.equal(sent(h), 1);
});

test("only people approve, unless the Space names agents for a low-risk act", async () => {
  const h = harness();
  h.callee("mail.send", () => ({}));
  const p = await park(h);
  await refused(release(h, p, { by: bot2.id }, { id: bot2.id, kind: "agent", device: "dev_1" }), "validation.precondition_failed", "people_only");
  assert.equal(sent(h), 0);

  const h2 = harness();
  h2.callee("mail.send", () => ({}));
  await h2.call("gate.rules.set", { act: "send", scope: "space", mode: "hold", agentOkFor: "high" }, { id: "usr_owner" });
  const q = await park(h2);
  await release(h2, q, { by: bot2.id }, { id: bot2.id, kind: "agent", device: "dev_1" });
  assert.equal(findHold(h2.db, q.holdId)!.state, "approved");
  assert.equal(sent(h2), 1);
});

test("nobody approves what they asked for, except an asker approving her own agent", async () => {
  const h = harness();
  h.callee("campaigns.launch", () => ({ launched: true }));
  const p = await park(h, { capName: "campaigns.launch", act: "campaign_launch", principal: alice, actingFor: undefined, input: { campaignId: "cmp_1" } }, as(alice));
  assert.deepEqual(findHold(h.db, p.holdId)!.approver, { kind: "role", id: "rol_admin" });
  await refused(release(h, p, { by: alice.id }), "validation.precondition_failed", "self_approval");
  assert.equal(h.callsTo("campaigns.launch").length, 0);
  await release(h, p, { by: bob.id }, person(bob));
  assert.equal(h.callsTo("campaigns.launch").length, 1);
  // an agent's send is approved by the person it works for: that is the asker rule, not self approval
  h.callee("mail.send", () => ({}));
  const q = await park(h, { decisionId: "dec_2" });
  await release(h, q, { decision: "dec_2" });
  assert.equal(findHold(h.db, q.holdId)!.state, "approved");
});

test("a send that fails goes back to held with its error and can be approved again", async () => {
  const h = harness();
  let n = 0;
  h.callee("mail.send", () => { n += 1; if (n === 1) throw Object.assign(new Error("smtp down"), { error: { message: "The mail server did not answer." } }); return { messageId: "msg_2" }; });
  const p = await park(h);
  await assert.rejects(() => release(h, p), /smtp down/);
  let hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "held");
  assert.equal(hold.sendingAt, undefined);
  assert.equal(hold.error, "The mail server did not answer.");
  assert.equal(h.events.length, 0, "nothing was approved");
  assert.equal(h.callsTo("scheduler.cancel").length, 0, "the timers keep running");
  const r = await release(h, p);
  assert.deepEqual(r, { result: { messageId: "msg_2" } });
  hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "approved");
  assert.equal(hold.error, undefined);
});

test("two taps send once", async () => {
  const h = harness();
  h.callee("mail.send", async () => { await new Promise((r) => setTimeout(r, 5)); return { messageId: "msg_3" }; });
  const p = await park(h);
  const [a, b] = await Promise.allSettled([release(h, p), release(h, p)]);
  const ok = [a, b].filter((x) => x.status === "fulfilled");
  const no = [a, b].filter((x): x is PromiseRejectedResult => x.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(no.length, 1);
  assert.equal(codeOf(no[0]!.reason), "validation.precondition_failed");
  assert.equal(reasonOf(no[0]!.reason), "sending");
  assert.equal(sent(h), 1);
});

test("a held act that was changed in storage is not sent", async () => {
  const h = harness();
  h.callee("mail.send", () => ({}));
  const p = await park(h);
  h.sqlite.prepare("UPDATE gate_holds SET input = ? WHERE id = ?").run(JSON.stringify({ to: ["someone@else.com"] }), p.holdId);
  await refused(release(h, p), "internal.unexpected");
  assert.equal(sent(h), 0);
});

test("a hold interrupted mid-send comes back to held and can be approved after the check", async () => {
  const h = harness();
  h.callee("mail.send", () => ({ messageId: "msg_4" }));
  const p = await park(h);
  h.sqlite.prepare("UPDATE gate_holds SET sending_at = ? WHERE id = ?").run(NOW, p.holdId);
  await refused(release(h, p), "validation.precondition_failed", "sending");
  assert.deepEqual(await recover(h.ctxFor(null, svc)), [p.holdId]);
  assert.equal(findHold(h.db, p.holdId)!.possiblySent, true);
  const r = await release(h, p);
  assert.deepEqual(r, { result: { messageId: "msg_4" } });
});

// ---- deny ----

test("sending back a hold keeps the task for the requester; dropping it closes the task", async () => {
  const h = harness();
  const p = await park(h, { runId: "run_1" });
  await refused(h.call("gate.deny", { holdId: p.holdId, taskId: "tsk_other", mode: "send_back" }, person(alice)), "validation.precondition_failed", "task_mismatch");
  const r = await h.call("gate.deny", { holdId: p.holdId, taskId: p.taskId, mode: "send_back", note: "Wrong client." }, person(alice));
  assert.deepEqual(r, { ok: true });
  assert.equal(findHold(h.db, p.holdId)!.state, "denied");
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["gate.denied", { holdId: p.holdId, act: "send", taskId: p.taskId, by: alice.id, mode: "send_back", note: "Wrong client." }]]);
  assert.equal(h.callsTo("tasks.withdraw").length, 0, "tasks.act moves the task on a send-back");
  assert.equal(h.callsTo("scheduler.cancel").length, 2);
  assert.equal(h.callsTo("runs.resume").length, 1, "the waiting turn hears the note");
  await refused(h.call("gate.deny", { holdId: p.holdId, taskId: p.taskId, mode: "drop" }, person(alice)), "validation.precondition_failed", "not_held");

  const q = await park(h, { decisionId: "dec_2" });
  await h.call("gate.deny", { holdId: q.holdId, taskId: q.taskId, mode: "drop" }, person(alice));
  assert.deepEqual(h.callsTo("tasks.withdraw").map((c) => c.input), [{ taskId: q.taskId, note: "Dropped." }]);
  assert.equal(sent(h), 0);
});

// ---- timeouts: golden 7 ----

async function fireDue(h: Harness, fired: Set<string>, trace: string[]): Promise<void> {
  const canceled = new Set(h.callsTo("scheduler.cancel").map((c) => c.input.scheduleId as string));
  for (const s of [...h.schedules]) {
    if (fired.has(s.id) || canceled.has(s.id) || (s.at as number) > h.now()) continue;
    fired.add(s.id);
    if (s.cap === "gate.expire") {
      const r = await h.call("gate.expire", s.input, svc);
      trace.push(`${hours(h)}: timer ${s.id} gate.expire -> ${JSON.stringify(r)}`);
    } else {
      await h.ctxFor(null, svc).call!(s.cap, s.input);
      trace.push(`${hours(h)}: timer ${s.id} ${s.cap} ${s.input.kind ?? ""}`.trim());
    }
  }
}
let t0 = NOW;
const hours = (h: Harness): string => `t+${Math.round((h.now() - t0) / HOUR)}h`;

test("golden 7: a hold waits, one backstop email at 4 hours, escalation at the timeout, drop at the second timeout", async (t: TestContext) => {
  const h = harness();
  t0 = h.now();
  h.callee("notifications.send", () => ({ outcome: "interrupt" }));
  h.callee("mail.send", () => ({ messageId: "never" }));
  const trace: string[] = [];
  const fired = new Set<string>();
  const p = await park(h, { runId: "run_1" });
  trace.push(`${hours(h)}: agent send held -> <hold>, task <task>, approver usr_alice, timers ${h.schedules.map((s) => `${s.cap}@${Math.round(((s.at as number) - t0) / HOUR)}h`).join(", ")}`);
  assert.deepEqual(h.schedules.map((s) => [s.cap, Math.round(((s.at as number) - t0) / HOUR)]), [["gate.expire", 24], ["notifications.send", 4]]);

  h.advance(3 * HOUR);
  await fireDue(h, fired, trace);
  assert.equal(h.callsTo("notifications.send").length, 0, "nothing at 3 hours");
  trace.push(`${hours(h)}: no timer is due`);

  h.advance(1 * HOUR);
  await fireDue(h, fired, trace);
  const mails = h.callsTo("notifications.send");
  assert.equal(mails.length, 1, "one email at 4 hours");
  assert.deepEqual(mails[0]!.input, { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: p.taskId }, title: "Send a message via mail.send to 1 recipient", collapseKey: `approval.backstop:${p.taskId}` });
  await fireDue(h, fired, trace);
  assert.equal(h.callsTo("notifications.send").length, 1, "and only one");
  trace.push(`${hours(h)}: the email went out once, a second look finds nothing new`);

  await refused(h.call("gate.expire", { holdId: p.holdId }, svc), "validation.precondition_failed", "not_due");

  h.advance(20 * HOUR);
  await fireDue(h, fired, trace);
  let hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "held", "escalated, not dropped");
  assert.deepEqual(hold.approver, { kind: "person", id: "usr_delegate" });
  assert.equal(hold.expiresAt, t0 + 48 * HOUR);
  assert.deepEqual(h.callsTo("tasks.escalate")[0]!.input, { taskId: p.taskId, reason: "timeout" });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload.outcome, e.payload.escalatedTo]), [["gate.expired", "escalated", "usr_delegate"]]);
  assert.equal(h.schedules.at(-1)!.cap, "gate.expire");
  assert.equal(h.schedules.at(-1)!.at, t0 + 48 * HOUR, "a second timeout is set");
  trace.push(`${hours(h)}: hold still held, approver usr_delegate, second timeout at t+48h`);

  h.advance(24 * HOUR);
  await fireDue(h, fired, trace);
  hold = findHold(h.db, p.holdId)!;
  assert.equal(hold.state, "expired");
  assert.match(String(h.callsTo("tasks.withdraw")[0]!.input.note), /Timed out/);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload.outcome]), [["gate.expired", "dropped"]]);
  assert.equal(h.callsTo("runs.resume").length, 1);
  trace.push(`${hours(h)}: hold expired, task withdrawn, the act was never sent`);

  await refused(release(h, p), "validation.precondition_failed", "not_held");
  assert.equal(sent(h), 0, "an expired hold is never sent");
  trace.push(`${hours(h)}: approving now is refused (not_held), nothing sent`);
  // the trace is the proof of golden 7: it must equal the recorded one
  assert.equal(`${trace.join("\n")}\n`, readFileSync(new URL("../fixtures/golden7.trace.txt", import.meta.url), "utf8"));
  t.diagnostic(`golden 7 trace\n${trace.join("\n")}`);
});

test("escalating to the role above instead of a delegate", async () => {
  const h = harness();
  await h.call("gate.rules.set", { act: "send", scope: "space", mode: "hold", escalateTo: "role" }, { id: "usr_owner" });
  const p = await park(h);
  h.advance(24 * HOUR);
  const r = await h.call("gate.expire", { holdId: p.holdId }, svc);
  assert.deepEqual(r, { outcome: "escalated", escalatedTo: "rol_admin" });
  assert.deepEqual(h.callsTo("tasks.assign")[0]!.input, { taskId: p.taskId, slot: "approver", to: { kind: "role", id: "rol_admin" } });
  assert.equal(h.callsTo("tasks.escalate").length, 0);
  // admins who already had it pass it to the owner
  await h.call("gate.rules.set", { act: "campaign_launch", scope: "space", mode: "hold", escalateTo: "role" }, { id: "usr_owner" });
  const q = await park(h, { decisionId: "dec_2", act: "campaign_launch", capName: "campaigns.launch" });
  h.advance(24 * HOUR);
  assert.deepEqual(await h.call("gate.expire", { holdId: q.holdId }, svc), { outcome: "escalated", escalatedTo: "rol_owner" });
});

test("when nobody can take it, the timeout drops the act instead of sending it", async () => {
  const h = harness();
  h.callee("tasks.escalate", () => { throw Object.assign(new Error("nobody"), { error: { code: "validation.precondition_failed" } }); });
  const p = await park(h);
  h.advance(24 * HOUR);
  assert.deepEqual(await h.call("gate.expire", { holdId: p.holdId }, svc), { outcome: "dropped" });
  assert.equal(findHold(h.db, p.holdId)!.state, "expired");
  assert.equal(sent(h), 0);
});

test("a rule that drops on timeout never escalates", async () => {
  const h = harness();
  await h.call("gate.rules.set", { act: "send", scope: "space", mode: "hold", onTimeout: "drop", afterHours: 2 }, { id: "usr_owner" });
  const p = await park(h);
  assert.equal(findHold(h.db, p.holdId)!.expiresAt, NOW + 2 * HOUR);
  h.advance(2 * HOUR);
  assert.deepEqual(await h.call("gate.expire", { holdId: p.holdId }, svc), { outcome: "dropped" });
  assert.equal(h.callsTo("tasks.escalate").length, 0);
});

test("a decided hold cannot be expired", async () => {
  const h = harness();
  h.callee("mail.send", () => ({}));
  const p = await park(h);
  await release(h, p);
  h.advance(30 * HOUR);
  await refused(h.call("gate.expire", { holdId: p.holdId }, svc), "validation.precondition_failed", "not_held");
});

test("the sweep applies the timeouts a scheduler missed, oldest first, and only once", async () => {
  const h = harness({ noScheduler: true });
  const a = await park(h, { decisionId: "dec_a" });
  h.advance(10 * HOUR);
  const b = await park(h, { decisionId: "dec_b" });
  const ctx = () => h.ctxFor(null, svc);
  h.advance(15 * HOUR);   // 25 h after a, 15 h after b
  assert.deepEqual(await sweep(ctx()), [{ holdId: a.holdId, outcome: "escalated" }]);
  assert.deepEqual(await sweep(ctx()), [], "nothing else is due");
  h.advance(10 * HOUR);   // 35 h after a, 25 h after b
  assert.deepEqual(await sweep(ctx()), [{ holdId: b.holdId, outcome: "escalated" }]);
  h.advance(15 * HOUR);   // 50 h after a: its second timeout (49 h)
  assert.deepEqual(await sweep(ctx()), [{ holdId: a.holdId, outcome: "dropped" }]);
  h.advance(10 * HOUR);
  assert.deepEqual(await sweep(ctx()), [{ holdId: b.holdId, outcome: "dropped" }]);
  assert.equal(sent(h), 0);
});

// ---- ordinary human sends skip the Gate ----

test("ordinary human sends skip the Gate; the acts that always ask do not", async () => {
  const h = harness();
  const rule = (principal: unknown, act: string) => h.call("gate.effective_rule", { principal, act }, { id: alice.id });
  for (const act of ["send", "post", "pay", "delete", "signature_send", "spend_raise"]) assert.equal((await rule(alice, act)).hold, false, `${act} by a person`);
  for (const act of ["push_protected", "campaign_launch", "secret_export", "site_promote"]) assert.equal((await rule(alice, act)).hold, true, `${act} by a person`);
  assert.equal((await rule(bot, "send")).hold, true, "the same send by an agent waits");
  // a Space that lets agent sends through changes nothing for people, and the owner's floor still catches them
  await h.call("gate.rules.set", { act: "send", scope: "space", mode: "allow" }, { id: "usr_owner" });
  assert.equal((await rule(bot, "send")).hold, false);
  await h.call("gate.rules.set", { act: "send", scope: "floor", mode: "hold" }, { id: "usr_owner" });
  assert.equal((await rule(bot, "send")).hold, true);
  assert.equal((await rule(alice, "send")).hold, false, "but never a person's own send");
});
// ok
// ok2
