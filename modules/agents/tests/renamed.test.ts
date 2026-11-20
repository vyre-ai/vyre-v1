// An agent's access principal is made once, at birth. A rename must reach it (agent.renamed), or every reader of the people directory (mentions, share sheets, crew rows) shows the old name; a boot job
// corrects the Spaces whose agents were renamed before access heard of renames.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { announceNames } from "../handlers/crud.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

test("a rename after creation announces the new name; another change announces none", async () => {
  const hn = harness();
  const id = (await h["agents.create"]!(hn.ctx, { name: "Intake", idempotencyKey: "r1" })).agent.agentId as string;
  hn.clear();
  await h["agents.update"]!(hn.ctx, { agentId: id, patch: { model: "claude-opus-4-5" } });
  assert.equal(hn.named("agent.renamed").length, 0, "no rename, no announcement");
  await h["agents.update"]!(hn.ctx, { agentId: id, patch: { name: "Front Desk" } });
  const told = hn.named("agent.renamed");
  assert.equal(told.length, 1);
  assert.deepEqual(told[0]!.payload, { agentId: id, name: "Front Desk" });
});

test("the boot job tells access the current name of an agent whose principal is stale, once", async () => {
  const hn = harness();
  const id = (await h["agents.create"]!(hn.ctx, { name: "Intake", idempotencyKey: "r2" })).agent.agentId as string;
  // renamed before access heard of renames: the agent has its new name, the principal still has the old one
  hn.db.run(`UPDATE agents_agent SET name = ?, nameKey = ? WHERE id = ?`, "Front Desk", "front desk", id);
  let principalName = "Intake";
  let lists = 0;
  let gets = 0;
  hn.world.answer("access.principals.list", () => {
    lists++;
    return {
      principals: [{ id, kind: "agent", name: principalName, status: "active", roles: [], groups: [], createdAt: 0 }],
    };
  });
  hn.world.answer("access.principals.get", () => {
    gets++;
    throw new Error("one read per agent");
  });
  hn.clear();
  assert.deepEqual(await announceNames(hn.ctx), [id]);
  assert.equal(lists, 1, "one list of the agents' principals");
  assert.equal(gets, 0, "no read per agent");
  assert.deepEqual(hn.named("agent.renamed")[0]!.payload, { agentId: id, name: "Front Desk" });
  principalName = "Front Desk"; // access folded it
  hn.clear();
  assert.deepEqual(await announceNames(hn.ctx), [], "once the names agree nothing is announced");
  assert.equal(hn.named("agent.renamed").length, 0);
});
