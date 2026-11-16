// F77: a person's memory is the person's. Deleting an agent for good deletes the agent's own layer; a person-layer fact that carried the agent's id keeps its row, is still recalled for that person, and loses
// only the agent scope.
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls } from "../impl.ts";
import { harness, seedFact } from "../fixtures/harness.ts";

const erase = hostCalls["memory.erase_agent"] as (ctx: unknown, i: unknown) => unknown;

test("the agent's own layer goes; a person-layer fact scoped to the agent survives, unscoped, and is still there for that person", () => {
  const h = harness();
  seedFact(h, { id: "fct_own", layer: "agent", agentId: "agt_desk", text: "Desk keeps the invoices list." });
  seedFact(h, { id: "fct_mine", layer: "person", agentId: "agt_desk", text: "I prefer short answers." });
  erase(h.ctx, { agentId: "agt_desk", dry: false });
  const rows = h.db.all("SELECT id, agent_id, status FROM memory_facts ORDER BY id") as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((r) => r["id"]),
    ["fct_mine"],
    "only the person's fact is left",
  );
  assert.equal(rows[0]!["agent_id"], null, "it lost the agent scope and kept its row");
  assert.notEqual(rows[0]!["status"], "removed");
});
