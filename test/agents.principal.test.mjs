// P-GF_07: an agent made with agents.create is a principal of the Space in the same call. Before this, only seeded agents were: the engine's calls as a new agent (the Vault read for its asker's account,
// the post of its reply) were refused as "not a member" (auth.unauthenticated), so no new agent could ever answer. Booted on the flow's Space, through the gateway, as the owner.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace } from "../golden/steps/02-space.ts";

test("agents.create makes the agent a principal of the Space, owned by its maker, with the Member role", async () => {
  const s = await bootFlowSpace(["agents", "files", "access"]);
  try {
    const admin = s.d.token;
    const made = await s.call("agents.create", admin, { idempotencyKey: "pr-agent", name: "Helper Two", role: "Answers questions" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const agentId = made.body.data.agent.agentId;
    assert.match(agentId, /^agt_[a-z0-9]+$/);
    const got = await s.call("access.principals.get", admin, { principal: agentId });
    assert.equal(got.status, 200, `access.principals.get: ${JSON.stringify(got.body)}`);
    const p = got.body.data.principal;
    assert.equal(p.kind, "agent");
    assert.equal(p.owner, "usr_olivia");
    assert.equal(p.status, "active");
    assert.deepEqual(p.roles, ["rol_member"]);

    // it acts for a person: the agent acting for its owner may use the Space, the way the engine calls as it
    const acting = await s.call("access.check", admin, { principal: agentId, actingFor: "usr_olivia", action: { level: "view" }, resource: { type: "space", id: "spc_core" } });
    assert.equal(acting.status, 200, `access.check: ${JSON.stringify(acting.body)}`);
    assert.equal(acting.body.data.decision.effect, "allow", JSON.stringify(acting.body.data.decision));

    // an agent that does not exist is still no member
    const stranger = await s.call("access.check", admin, { principal: "agt_nobodyhere", actingFor: "usr_olivia", action: { level: "view" }, resource: { type: "space", id: "spc_core" } });
    assert.ok(stranger.status >= 400 || stranger.body?.data?.decision?.effect === "deny", `an unknown agent is refused: ${JSON.stringify(stranger.body).slice(0, 300)}`);
  } finally { await s.stop(); }
});
