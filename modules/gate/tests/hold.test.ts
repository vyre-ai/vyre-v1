// Holds (spec 2.14, ARCH 4.6): parking a held call, who approves, the fixed summary line, the effective rule (Auto cannot suppress a hold), requester scoping, crash recovery,
// and rejecting what a removed person asked to send.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, NOW, alice, as, bob, bot, bot2, cara, parkInput } from "../fixtures/seed.ts";
import { consumers, effectiveRule, recover, rejectAllOf, summaryLine, ACTS } from "../impl.ts";
import { findHold, holdsWhere } from "../projections.ts";

const svc = { id: "svc_host", kind: "service" as const };
const agent = as(bot);
async function park(h: Harness, over: Record<string, unknown> = {}, who = agent): Promise<{ holdId: string; taskId: string; runId?: string }> {
  return h.call("gate.park", parkInput(over), who);
}
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}

test("an agent's send is parked as a hold and an Approve task with the exact preview", async () => {
  const h = harness();
  const r = await park(h, { runId: "run_1" });
  assert.match(r.holdId, /^hld_[a-z0-9]+$/);
  assert.equal(r.runId, "run_1");
  const hold = findHold(h.db, r.holdId)!;
  assert.equal(hold.state, "held");
  assert.equal(hold.taskId, r.taskId);
  assert.deepEqual(hold.approver, { kind: "person", id: alice.id }, "the asker approves: the person the agent works for");

  const create = h.callsTo("tasks.create")[0]!.input;
  assert.equal(create.kind, "approve");
  assert.deepEqual(create.assigned, { kind: "person", id: alice.id });
  assert.deepEqual(create.source, { kind: "gate", id: r.holdId });
  assert.equal(create.expiresAt, NOW + 24 * HOUR);
  assert.equal(create.blocks[0].type, "doc_excerpt");
  assert.equal(create.blocks[0].data.input.subject, "Retainer", "the approver sees the whole act");
  assert.deepEqual(h.callsTo("tasks.working_notes.set").map((c) => [c.input.key, c.input.value]), [["decision_id", "dec_1"], ["payload_hash", "ph_1"]]);
  assert.deepEqual(h.callsTo("runs.mark_waiting")[0]!.input, { runId: "run_1", reason: "approval", taskId: r.taskId });

  assert.deepEqual(h.events.map((e) => e.name), ["gate.requested"]);
  assert.deepEqual(h.events[0]!.payload, { holdId: r.holdId, act: "send", capName: "mail.send", taskId: r.taskId, principal: bot, actingFor: alice.id, runId: "run_1", expiresAt: NOW + 24 * HOUR });

  // two timers: the timeout, and one reminder at the backstop hour
  assert.deepEqual(h.schedules.map((s) => [s.cap, s.at]), [["gate.expire", NOW + 24 * HOUR], ["notifications.send", NOW + 4 * HOUR]]);
  assert.deepEqual(h.schedules[0]!.input, { holdId: r.holdId });
  assert.deepEqual(h.schedules[1]!.input, { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: r.taskId }, title: hold.summary, collapseKey: `approval.backstop:${r.taskId}` });
  assert.equal(hold.expireSchedule, "sch_1");
  assert.equal(hold.backstopSchedule, "sch_2");
});

test("the same decision parked twice is one hold; a failed task leaves no orphan", async () => {
  const h = harness();
  const a = await park(h);
  const b = await park(h);
  assert.deepEqual(b, a);
  assert.equal(h.callsTo("tasks.create").length, 1);
  assert.equal(holdsWhere(h.db).length, 1);

  const h2 = harness();
  h2.callee("tasks.create", () => { throw Object.assign(new Error("tasks are down"), { error: { code: "internal.unavailable" } }); });
  await assert.rejects(() => park(h2), /tasks are down/);
  assert.equal(holdsWhere(h2.db).length, 0, "the hold row is removed with the failed task");
});

test("a Space without a scheduler still parks; the sweep applies the timeout later", async () => {
  const h = harness({ noScheduler: true });
  const r = await park(h);
  assert.equal(h.schedules.length, 0);
  assert.equal(findHold(h.db, r.holdId)!.expireSchedule, undefined);
});

test("who approves follows the act and the strictest rule", async () => {
  const h = harness();
  const approverOf = async (over: Record<string, unknown>, who = agent): Promise<unknown> => {
    const r = await park(h, { decisionId: `dec_${h.calls.length}`, ...over }, who);
    return findHold(h.db, r.holdId)!.approver;
  };
  assert.deepEqual(await approverOf({ act: "pay" }), { kind: "role", id: "rol_owner" });
  assert.deepEqual(await approverOf({ act: "campaign_launch" }), { kind: "role", id: "rol_admin" });
  assert.deepEqual(await approverOf({ act: "delete" }), { kind: "person", id: alice.id });
  // no acting-for: the agent's owner is the asker
  assert.deepEqual(await approverOf({ actingFor: undefined }), { kind: "person", id: alice.id });
  // no asker at all: the admins
  h.callee("access.principals.get", () => ({ principal: {} }));
  assert.deepEqual(await approverOf({ actingFor: undefined }), { kind: "role", id: "rol_admin" });
  // the owner's floor names the owner for every send
  await h.call("gate.rules.set", { act: "send", scope: "floor", mode: "hold", approvers: "owner" }, { id: "usr_owner" });
  assert.deepEqual(await approverOf({}), { kind: "role", id: "rol_owner" });
  // a role approver gets no backstop email (a role cannot be emailed)
  const before = h.schedules.length;
  await park(h, { act: "pay", decisionId: "dec_pay_2" });
  assert.equal(h.schedules.slice(before).filter((s) => s.cap === "notifications.send").length, 0);
});

test("the summary line is fixed: act, capability, how many people or how much, never the words", () => {
  const send = ACTS.find((a) => a.key === "send")!, pay = ACTS.find((a) => a.key === "pay")!;
  assert.equal(summaryLine(send, "mail.send", { to: ["a@x.com", "b@x.com"], cc: "c@x.com", subject: "Secret merger", body: "words" }), "Send a message via mail.send to 3 recipients");
  assert.equal(summaryLine(send, "mail.send", { to: "a@x.com" }), "Send a message via mail.send to 1 recipient");
  assert.equal(summaryLine(pay, "stripe.charge", { amount: 1200, currency: "usd", memo: "for the Lee matter" }), "Send money or submit a card via stripe.charge for 1200 USD");
  assert.equal(summaryLine(send, "mail.send", null), "Send a message via mail.send");
  assert.ok(summaryLine(send, "x".repeat(300), {}).length <= 120);
});

test("the summary on the task and in the hold never carries the draft", async () => {
  const h = harness();
  const r = await park(h);
  const hold = findHold(h.db, r.holdId)!;
  assert.equal(hold.summary, "Send a message via mail.send to 1 recipient");
  assert.equal(h.callsTo("tasks.create")[0]!.input.summary, hold.summary);
  assert.doesNotMatch(JSON.stringify(h.events), /Retainer|Dear Lee|client@example.com/, "events say that something is held, never what");
});

// ---- the effective rule ----

test("the effective rule: agents wait, a person's own send does not, human-too acts always do", async () => {
  const h = harness();
  const rule = (principal: unknown, act: string, who = { id: alice.id }) => h.call("gate.effective_rule", { principal, act }, who);
  const a = await rule(bot, "send");
  assert.deepEqual(a, { hold: true, reason: "Acts of this kind wait for approval.", approvers: "asker", peopleOnly: true, afterHours: 24, onTimeout: "escalate", sources: { space: "hold" } });
  const p = await rule(alice, "send");
  assert.equal(p.hold, false, "ordinary human sends skip the Gate");
  assert.match(p.reason, /own act/);
  for (const act of ["push_protected", "campaign_launch", "secret_export", "site_promote"]) assert.equal((await rule(alice, act)).hold, true, `${act} by a person`);
  for (const act of ["pay", "delete", "post", "signature_send", "spend_raise"]) assert.equal((await rule(alice, act)).hold, false, `${act} by a person`);
  assert.equal((await rule({ kind: "service", id: "svc_job" }, "send")).hold, true);
  assert.equal((await rule({ kind: "actor", id: "act_outside" }, "send")).hold, true);
});

test("Auto cannot suppress a Gate hold: nothing below the Space can loosen it", async () => {
  const h = harness();
  const hold = async (principal: unknown = bot) => (await h.call("gate.effective_rule", { principal, act: "send" }, { id: alice.id })).hold;
  // an agent's own rule cannot say allow while the Space holds
  await refused(h.call("gate.rules.set", { act: "send", scope: "agent", agentId: bot.id, mode: "allow" }, { id: "usr_owner" }), "validation.precondition_failed", "would_loosen");
  // and if such a row got in some other way, the evaluation still holds
  h.sqlite.prepare("INSERT INTO gate_rules (act, scope, agent_id, mode, updated_at) VALUES ('send', 'agent', ?, 'allow', 1)").run(bot.id);
  assert.equal(await hold(), true);
  // the Space may let sends through; the owner's floor and the agent's own rule can still ask first
  await h.call("gate.rules.set", { act: "send", scope: "space", mode: "allow" }, { id: "usr_owner" });
  assert.equal(await hold(bot2), false, "an agent with no rule of its own passes when the Space allows");
  assert.equal(await hold(), false, "an allow from the agent's own rule is not a hold either");
  await h.call("gate.rules.set", { act: "send", scope: "agent", agentId: bot2.id, mode: "hold" }, { id: "usr_owner" });
  assert.equal(await hold(bot2), true, "an agent's own rule can only tighten");
  await h.call("gate.rules.set", { act: "send", scope: "floor", mode: "hold" }, { id: "usr_owner" });
  const withFloor = await h.call("gate.effective_rule", { principal: bot, act: "send" }, { id: alice.id });
  assert.equal(withFloor.hold, true);
  assert.equal(withFloor.reason, "The owner always asks first.");
  assert.deepEqual(withFloor.sources, { space: "allow", floor: "hold", agent: "allow" });
  assert.equal(effectiveRule(h.db, bot, "send").hold, true);
});

test("approvers, timing and the low-risk exception take the strictest level", async () => {
  const h = harness();
  const owner = { id: "usr_owner" };
  const eff = (principal: unknown = bot, act = "send") => h.call("gate.effective_rule", { principal, act }, owner);
  await h.call("gate.rules.set", { act: "send", scope: "space", mode: "hold", approvers: "role:admin", afterHours: 48, onTimeout: "escalate", agentOkFor: "high" }, owner);
  let e = await eff();
  assert.deepEqual([e.approvers, e.afterHours, e.peopleOnly], ["role:admin", 48, false]);
  await h.call("gate.rules.set", { act: "send", scope: "floor", mode: "hold", approvers: "owner", afterHours: 36 }, owner);
  await h.call("gate.rules.set", { act: "send", scope: "agent", agentId: bot.id, mode: "hold", afterHours: 12, agentOkFor: "medium", onTimeout: "drop" }, owner);
  e = await eff();
  assert.equal(e.approvers, "owner", "the owner's floor is the strictest");
  assert.equal(e.afterHours, 12, "the shortest timeout wins");
  assert.equal(e.onTimeout, "drop", "drop is stricter than escalate");
  assert.equal(e.peopleOnly, false, "an agent may approve a medium act when the Space and the agent's rule both say so");
  assert.equal((await eff(bot, "pay")).peopleOnly, true, "but never a high one by default");
  assert.equal((await eff(bot2)).peopleOnly, false, "other agents follow the Space rule");
  // out of the box nothing is agent-approved: send is medium and the default exception is low
  const fresh = harness();
  assert.equal((await fresh.call("gate.effective_rule", { principal: bot, act: "send" }, owner)).peopleOnly, true);
});

test("rules: scope checks, never loosening, the defaults list, one event", async () => {
  const h = harness();
  const owner = { id: "usr_owner" };
  const set = (input: Record<string, unknown>) => h.call("gate.rules.set", { act: "send", mode: "hold", ...input }, owner);
  await refused(set({ scope: "agent" }), "validation.precondition_failed", "agent_required");
  await refused(set({ scope: "space", agentId: bot.id }), "validation.precondition_failed", "agent_not_allowed");
  await refused(set({ scope: "floor", mode: "allow" }), "validation.precondition_failed", "floor_holds_only");
  await refused(set({ scope: "space", approvers: "everyone" }), "validation.precondition_failed", "bad_approvers");
  await refused(set({ act: "pay", scope: "floor", approvers: "role:admin" }), "validation.precondition_failed", "would_loosen");
  await refused(set({ scope: "agent", agentId: bot.id, afterHours: 100 }), "validation.precondition_failed", "would_loosen");
  await refused(set({ scope: "agent", agentId: bot.id, agentOkFor: "medium" }), "validation.precondition_failed", "would_loosen");
  const r = await set({ scope: "space", mode: "hold", afterHours: 8, approvers: "role:admin" });
  assert.deepEqual(r.rule, { act: "send", mode: "hold", approvers: "role:admin", peopleOnly: true, agentOkFor: "low", afterHours: 8, onTimeout: "escalate", escalateTo: "delegate", emailBackstopHours: 4, scope: "space" });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["gate.rule_changed", { act: "send", scope: "space", by: owner.id }]]);
  await refused(set({ scope: "agent", agentId: bot.id, afterHours: 9 }), "validation.precondition_failed", "would_loosen");
  await set({ scope: "agent", agentId: bot.id, afterHours: 4 });
  const all = (await h.call("gate.rules.list", {}, owner)).rules;
  assert.equal(all.filter((x: { scope: string }) => x.scope === "space").length, 10, "every act has a Space rule, stored or default");
  assert.equal(all.find((x: { act: string; scope: string }) => x.act === "send" && x.scope === "space").afterHours, 8);
  assert.equal(all.find((x: { act: string; scope: string }) => x.act === "pay" && x.scope === "space").approvers, "owner");
  assert.deepEqual((await h.call("gate.rules.list", { scope: "agent" }, owner)).rules.map((x: { agentId: string }) => x.agentId), [bot.id]);
  assert.deepEqual((await h.call("gate.rules.list", { scope: "agent", agentId: bot2.id }, owner)).rules, []);
  assert.equal((await h.call("gate.acts.list", {}, owner)).acts.length, 10);
});

test("the gate settings change the defaults", async () => {
  const h = harness();
  h.policy("gate.timeout_hours", 6);
  h.policy("gate.email_backstop_hours", 2);
  const r = await park(h);
  assert.deepEqual(h.schedules.map((s) => s.at), [NOW + 6 * HOUR, NOW + 2 * HOUR]);
  assert.equal(findHold(h.db, r.holdId)!.expiresAt, NOW + 6 * HOUR);
});

// ---- requester scoping ----

test("a hold belongs to its requester and its approver; a role holder sees it through the task", async () => {
  const h = harness({ authorize: (who, _a, r) => who.id === "usr_admin" && r.type === "task" });
  const mine = await park(h, { decisionId: "dec_mine" });                                                          // agent bot for alice, alice approves
  const owners = await park(h, { decisionId: "dec_pay", act: "pay", principal: bot2, actingFor: cara.id }, as(bot2));   // agent bot2 for cara, the owner role approves
  const ids = async (who: { id: string; kind?: "person" | "agent" | "service" }, input: Record<string, unknown> = {}): Promise<string[]> => (await h.call("gate.holds.list", input, who)).holds.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(await ids({ id: alice.id }), [mine.holdId], "the asker sees what her agent asked for and approves it");
  assert.deepEqual(await ids({ id: bot.id, kind: "agent" }), [mine.holdId], "the requester sees what it asked for");
  assert.deepEqual(await ids({ id: bot2.id, kind: "agent" }), [owners.holdId]);
  assert.deepEqual(await ids({ id: cara.id }), [owners.holdId]);
  assert.deepEqual(await ids({ id: bob.id }), [], "nobody else does");
  assert.deepEqual(await ids({ id: "usr_admin" }), [owners.holdId], "the holder of the approving role sees it through the grant on the task, and not alice's");
  assert.deepEqual(await ids(svc), [mine.holdId, owners.holdId].sort());
  await refused(h.call("gate.holds.get", { holdId: mine.holdId }, { id: bob.id }), "permission.not_found");
  assert.equal((await h.call("gate.holds.get", { holdId: mine.holdId }, { id: alice.id })).hold.state, "held");
  assert.deepEqual((await h.call("gate.holds.list", { act: "pay" }, svc)).holds.map((x: { id: string }) => x.id), [owners.holdId]);
  assert.equal((await h.call("gate.holds.list", { states: ["approved"] }, svc)).holds.length, 0);
  assert.deepEqual((await h.call("gate.holds.list", { runId: "run_9" }, svc)).holds, []);
  const page = await h.call("gate.holds.list", { limit: 1 }, svc);
  assert.equal(page.holds.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.next, "1");
});

// ---- crash recovery ----

test("a crash mid-send puts the hold back to held and marks it possibly sent", async () => {
  const h = harness();
  const r = await park(h);
  const t = h.calls.length;
  h.sqlite.prepare("UPDATE gate_holds SET sending_at = ? WHERE id = ?").run(NOW, r.holdId);
  assert.equal(findHold(h.db, r.holdId)!.sendingAt, NOW);
  const again = await recover(h.ctxFor(null, svc));
  assert.deepEqual(again, [r.holdId]);
  const hold = findHold(h.db, r.holdId)!;
  assert.equal(hold.state, "held");
  assert.equal(hold.sendingAt, undefined);
  assert.equal(hold.possiblySent, true);
  assert.match(hold.error ?? "", /may have gone out/);
  const note = h.calls.slice(t).find((c) => c.cap === "tasks.working_notes.set")!;
  assert.deepEqual([note.input.taskId, note.input.key], [r.taskId, "possibly_sent"]);
  assert.deepEqual(await recover(h.ctxFor(null, svc)), [], "nothing left to recover");
});

// ---- member removal ----

test("everything a removed person asked to send is rejected and never sent", async () => {
  const h = harness();
  const a = await park(h, { decisionId: "dec_a" });                                             // agent for alice
  const b = await park(h, { decisionId: "dec_b", principal: alice, actingFor: undefined }, as(alice));   // alice herself (a human-too act would hold)
  const c = await park(h, { decisionId: "dec_c", actingFor: bob.id });                            // agent for bob
  const sending = await park(h, { decisionId: "dec_d" });
  h.sqlite.prepare("UPDATE gate_holds SET sending_at = ? WHERE id = ?").run(NOW, sending.holdId);
  const done = await rejectAllOf(h.ctxFor(null, svc), alice.id, "Alice was removed.");
  assert.deepEqual(done.sort(), [a.holdId, b.holdId].sort());
  for (const id of [a.holdId, b.holdId]) assert.equal(findHold(h.db, id)!.state, "denied");
  assert.equal(findHold(h.db, c.holdId)!.state, "held", "other people's holds stand");
  assert.equal(findHold(h.db, sending.holdId)!.state, "held", "a hold mid-send is left to recover()");
  const withdraws = h.callsTo("tasks.withdraw").map((x) => [x.input.taskId, x.input.note]);
  assert.deepEqual(withdraws.sort(), [[a.taskId, "Alice was removed."], [b.taskId, "Alice was removed."]].sort());
  assert.equal(h.callsTo("mail.send").length, 0, "nothing was sent");
  assert.deepEqual(h.events.filter((e) => e.name === "gate.denied").map((e) => e.payload.mode), ["drop", "drop"]);
  assert.deepEqual(h.callsTo("scheduler.cancel").map((x) => x.input.scheduleId).length, 4, "both timers of both holds are canceled");
});

test("the member.removed consumer rejects the person's holds", async () => {
  const h = harness();
  const a = await park(h, { decisionId: "dec_a" });
  const spec = consumers["gate.member_removed"];
  assert.deepEqual(spec.on, ["member.removed"]);
  const done = await spec.run(h.ctxFor(null, svc), { payload: { personId: alice.id, reason: "left" } });
  assert.deepEqual(done, [a.holdId]);
  assert.equal(findHold(h.db, a.holdId)!.state, "denied");
  assert.deepEqual(await spec.run(h.ctxFor(null, svc), { payload: { personId: alice.id } }), []);
});

test("cara and bob are strangers to a hold they did not ask for or approve", async () => {
  const h = harness();
  const r = await park(h);
  for (const who of [bob, cara]) await refused(h.call("gate.holds.get", { holdId: r.holdId }, as(who)), "permission.not_found");
});
// ok
// ok2

test("gate.park is the pipeline's call: a direct call from a person or an agent is refused and writes no hold", async () => {
  const h = harness();
  for (const who of [as(alice, { depth: 0 }), as(bot, { depth: 0 }), as(bob, { depth: 0, origin: "user" })]) {
    await refused(h.call("gate.park", parkInput({ principal: alice, actingFor: undefined }), who), "permission.role_lacks_permission", "system_only");
  }
  assert.equal(holdsWhere(h.db, "1 = 1").length, 0);
  assert.deepEqual(h.events, []);
});

test("gate.park from the Gate hook (origin gate), the host and a nested call parks as before", async () => {
  const h = harness();
  await park(h, { decisionId: "dec_a" }, as(alice, { depth: 0, origin: "gate" }));
  await park(h, { decisionId: "dec_b" }, { ...svc, depth: 0 });
  await park(h, { decisionId: "dec_c" }, as(alice, { depth: 1 }));
  assert.equal(holdsWhere(h.db, "1 = 1").length, 3);
});
