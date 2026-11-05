// connection_change and signin_change always stop for a person with the right role, in every mode, even from a task or an automation. A person pressing it themselves is let through by the capability's own `when`, before the rule is read.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, as, bot } from "../fixtures/seed.ts";
import { effectiveRule, ACTS } from "../impl.ts";
import { putRule } from "../projections.ts";

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
