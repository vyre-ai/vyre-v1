// Property: an agent never holds owner or admin (ARCH 4.5 "Agents"). Worlds hand the agent owner and admin roles directly and through groups; the kernel must still strip them.
// Also: the agent's decision is never wider than the person it acts for, an agent without a person is refused, and a service never gets more than its owner.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, rankOf } from "../src/authorize/index.ts";
import { buildWorld, rng, NOW, PERSONS, AGENT, SVC, LEVELS } from "../src/authorize/fixture.ts";

const CASES = 200;

test(`an agent never holds owner or admin, in ${CASES} worlds that try to give it both`, () => {
  let elevatedTried = 0, agentAllowed = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const { snap, rows } = buildWorld(seed, { agentElevated: true });
    const r = rng(seed * 104729);
    // force the attempt: the agent holds owner and admin directly and owner through both groups
    snap.addPrincipalRole({ holder: AGENT, role: "owner" }); snap.addPrincipalRole({ holder: AGENT, role: "admin" });
    snap.addMember({ group: "g1", member: AGENT }); snap.addPrincipalRole({ holder: "g1", role: "owner" });
    elevatedTried++;
    const info = snap.info(AGENT)!;
    assert.ok(!info.keys.has("role:owner") && !info.keys.has("role:admin"), `seed ${seed}: elevated role keys survived`);
    assert.ok(!info.perms.has("access.manage"), `seed ${seed}: agent holds access.manage (only owner and admin carry it)`);
    assert.ok(!info.perms.has("access.view_as"), `seed ${seed}: agent holds access.view_as`);
    for (const person of PERSONS) {
      const d = authorize(snap, { principal: AGENT, actingFor: person, action: { perm: "access.manage", level: "manage" }, resource: { type: "folder", id: "root" }, now: NOW });
      assert.equal(d.effect, "deny", `seed ${seed}: agent passed an owner/admin-only permission for ${person}`);
      assert.ok(d.reason === "role_lacks_permission" || d.reason === "suspended", `seed ${seed}: reason ${d.reason}`);
    }
    // never wider than the person it acts for
    const person = r.pick(PERSONS), level = r.pick(LEVELS);
    for (const row of rows) {
      const req = { action: { perm: "records.read", level }, resource: { type: "deal", id: row.id }, row, now: NOW } as const;
      const a = authorize(snap, { ...req, principal: AGENT, actingFor: person });
      const p = authorize(snap, { ...req, principal: person });
      if (a.effect === "allow") {
        agentAllowed++;
        assert.equal(p.effect, "allow", `seed ${seed}: agent allowed where ${person} is denied (${p.reason})`);
        assert.ok(rankOf(a.scope!.level) <= rankOf(p.scope!.level), `seed ${seed}: agent level ${a.scope!.level} above person ${p.scope!.level}`);
        assert.ok(a.scope!.labelCeiling <= p.scope!.labelCeiling, `seed ${seed}: agent label ceiling above person`);
      }
    }
    const row = rows[0]!;
    const req = { action: { perm: "records.read", level }, resource: { type: "deal", id: row.id }, row, now: NOW } as const;
    // no person, or a non-person, to act for: refused
    assert.equal(authorize(snap, { ...req, principal: AGENT }).reason, "agent_needs_actor");
    assert.equal(authorize(snap, { ...req, principal: AGENT, actingFor: AGENT }).reason, "agent_needs_actor");
    assert.equal(authorize(snap, { ...req, principal: AGENT, actingFor: SVC }).reason, "agent_needs_actor");
    // a service is capped by its owner (p2)
    const sv = authorize(snap, { ...req, principal: SVC });
    if (sv.effect === "allow") {
      const o = authorize(snap, { ...req, principal: "p2" });
      assert.equal(o.effect, "allow", `seed ${seed}: service allowed where its owner is denied`);
      assert.ok(rankOf(sv.scope!.level) <= rankOf(o.scope!.level), `seed ${seed}: service level above owner`);
    }
  }
  assert.equal(elevatedTried, CASES);
  assert.ok(agentAllowed >= 40, `agent allows exercised: ${agentAllowed}`);
  console.log(`agent rules: ${CASES} worlds with owner/admin forced onto the agent, ${agentAllowed} agent allows checked against the person`);
});

test("a person with the same owner role keeps it (the strip is for agents only)", () => {
  const { snap } = buildWorld(1);
  snap.addPrincipalRole({ holder: "p1", role: "owner" });
  assert.ok(snap.info("p1")!.perms.has("access.manage"));
});
