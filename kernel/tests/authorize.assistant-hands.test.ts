// A person's own Assistant is their hands on a project they own and, for the Space's owner, on the Space (owner ruling 4 Nov 2026). Another Space agent asked by the same person is not, and what only a person
// does (handing out access, moving or ending the Space's ownership, removing people) is never done through it.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/authorize/index.ts";
import { buildWorld, NOW, AGENT } from "../src/authorize/fixture.ts";

test("the Assistant of a project's owner manages it; a Space agent acting for the same person does not", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    snap.putResource({ id: "prj_p1", type: "project", parent_id: "root", label: 0, owner_id: "p1", holds: 0 });
    const asAgent = (cap?: string, acting = "p1") => authorize(snap, { principal: AGENT, actingFor: acting, action: { perm: null, level: "manage" }, resource: { type: "project", id: "prj_p1" }, ...(cap ? { cap } : {}), now: NOW }).effect;
    const before = asAgent();
    snap.setAssistant(AGENT, true);
    assert.equal(asAgent(), "allow", `seed ${seed}: the Assistant manages its person's project`);
    assert.equal(asAgent("projects.teammates.create"), "allow");
    assert.equal(asAgent(undefined, "p2"), "deny", `seed ${seed}: not for someone else's project`);
    for (const cap of ["access.share", "access.transfer_ownership", "spaces.delete", "members.remove", "agents.set_owner"]) assert.equal(asAgent(cap), "deny", `seed ${seed}: ${cap} stays with a person`);
    snap.setAssistant(AGENT, false);
    assert.equal(asAgent(), before, `seed ${seed}: an agent that is not the Assistant is back where it was`);
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});
