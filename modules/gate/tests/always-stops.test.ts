// connection_change and signin_change always stop for a person with the right role, in every mode, even from a task or an automation. A person pressing it themselves is let through by the capability's own `when`, before the rule is read.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, as, bob, bot } from "../fixtures/seed.ts";
import { effectiveRule, ACTS } from "../impl.ts";
import { findHold, putRule } from "../projections.ts";

const owner = { id: "usr_owner", kind: "person" as const };
const ACT_KEYS = ["connection_change", "github_approval", "signin_change"] as const;

for (const act of ACT_KEYS) {
  test(`${act} holds for an agent, a service and a Run that runs as a person, with a person of the right role to decide`, () => {
    const h = harness();
    for (const who of [bot, { kind: "service" as const, id: "svc_aut" }, alice]) {
      const e = effectiveRule(h.db, who, act);
      assert.equal(e.hold, true, who.id);
      assert.equal(e.adminRule, true, "nothing a turn asked or an Always allow holds lifts it");
      assert.equal(e.peopleOnly, true);
      assert.equal(e.approvers, act === "github_approval" ? "asker" : "role:admin", "GitHub is the asker's own: the person the session acts for decides, not an admin");
    }
  });

  test(`${act}: a rule cannot let it through, a stale one does not, and only-admin mode does not skip it`, async () => {
    const h = harness();
    await assert.rejects(h.call("gate.rules.set", { act, scope: "space", mode: "allow" }, owner), (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "always_stops");
    await assert.rejects(h.call("gate.rules.set", { act, scope: "space", mode: "hold", approvers: "asker" }, owner), (e) => reasonOf(e) === "always_stops");
    await assert.rejects(h.call("gate.rules.set", { act, scope: "space", mode: "hold", agentOkFor: "high" }, owner), (e) => reasonOf(e) === "always_stops");
    putRule(h.db, { act, scope: "space", agentId: "", mode: "allow", agentOkFor: "high", updatedAt: 1 });   // written before this rule existed
    const e = effectiveRule(h.db, bot, act);
    assert.equal(e.hold, true);
    assert.equal(e.peopleOnly, true, "an agent never approves it");
    assert.equal(effectiveRule(h.db, bot, act, undefined, true).hold, true);
  });

  test(`${act}: Always allow is refused`, async () => {
    const h = harness();
    await assert.rejects(h.call("gate.allow.set", { act, target: "*", agentId: bot.id }, as(alice)), (e) => reasonOf(e) === "always_stops");
  });
}

test("the acts marked this way are the only ones, and the rest keep their rule", () => {
  assert.deepEqual(ACTS.filter((a) => a.alwaysStops).map((a) => a.key).sort(), [...ACT_KEYS].sort());
  assert.equal(effectiveRule(harness().db, alice, "send").hold, false, "a person's own send still goes");
});

test("github_approval is the asker's alone: no rule names another approver, escalates it or times it out to someone else", async () => {
  const h = harness();
  for (const change of [{ approvers: "owner" }, { approvers: "role:admin" }, { escalateTo: "role" }, { onTimeout: "escalate" }, { onTimeout: "drop" }]) {
    await assert.rejects(h.call("gate.rules.set", { act: "github_approval", scope: "space", mode: "hold", ...change }, owner), (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "person_only", JSON.stringify(change));
  }
  putRule(h.db, { act: "github_approval", scope: "space", agentId: "", mode: "hold", approvers: "role:admin", onTimeout: "escalate", escalateTo: "role", updatedAt: 1 });   // a row that got in some other way
  const e = effectiveRule(h.db, bot, "github_approval");
  assert.equal(e.approvers, "asker");
  assert.equal(e.onTimeout, "drop");
});

test("a person-only hold is released only by the person it was asked of, whatever the task's slots say", async () => {
  const h = harness();
  h.callee("github.me.approve", () => ({ approved: true }));
  const input = { capName: "github.me.approve", capVersion: 1, input: { repo: "a/b", action: "push_default", consumer: "x" }, payloadHash: "ph_1", act: "github_approval", principal: bot, actingFor: alice.id, decisionId: "dec_1" };
  const p = await h.call("gate.park", input, { id: bot.id, kind: "agent" });
  const hold = findHold(h.db, p.holdId)!;
  assert.deepEqual(hold.approver, { kind: "person", id: alice.id });
  assert.deepEqual([hold.rule.approvers, hold.rule.onTimeout], ["asker", "drop"]);
  assert.ok(h.callsTo("tasks.working_notes.set").some((c) => (c.input as { key?: string }).key === "gate.person_only"), "the task is marked");
  const token = (by: string, forPerson: string | null = null) => h.sealToken({ task: p.taskId, hold: p.holdId, decision: "dec_1", hash: "ph_1", by, forPerson, device: "dev_1", exp: h.now() + 600_000 });
  const rel = (by: string, who: { id: string; kind: "person" | "agent" | "service"; device?: string }, forPerson: string | null = null) => h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: token(by, forPerson) }, who);
  const notThePerson = (e: unknown) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "not_the_person";
  await assert.rejects(rel(bob.id, { id: bob.id, kind: "person", device: "dev_1" }), notThePerson, "another person, even an admin, with the task slot moved to them");
  await assert.rejects(rel(alice.id, { id: alice.id, kind: "person", device: "dev_1" }, bob.id), notThePerson, "alice's token minted while acting for someone");
  await assert.rejects(rel(bot.id, { id: bot.id, kind: "agent", device: "dev_1" }), (e) => codeOf(e) === "validation.precondition_failed", "the agent itself");
  assert.equal(findHold(h.db, p.holdId)!.state, "held");
  await rel(alice.id, { id: alice.id, kind: "person", device: "dev_1" });
  assert.equal(findHold(h.db, p.holdId)!.state, "approved");
});
