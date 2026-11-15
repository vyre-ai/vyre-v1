// F77: an agent that asks to delete another agent for good is held for a person's Allow (nothing is deleted until a person allows it); on itself it is refused in one plain sentence. A booted Team daemon, a
// scripted model that makes the agent's tool call.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/agentpc-world.ts";

test("an agent deleting another agent for good is held; on itself it is refused", async () => {
  const w = await world();
  try {
    const other = (await w.owner.call("agents.create", { name: "Spare", role: "Spare." })).data.agent.agentId as string;
    assert.equal((await w.owner.call("agents.delete", { agentId: other })).status, 200);
    const got = await w.turn(w.owner, "held-1", [
      { tool: { name: "agents_delete_for_good", input: { agentId: other } } },
    ]);
    assert.match(got[0]?.text ?? "", /held|waiting|Allow|approve/i, `the call is held: ${got[0]?.text}`);
    const still = await w.owner.call("agents.trash.list", {});
    const row = (still.data.agents as Array<{ agentId: string; deleting: boolean }>).find((a) => a.agentId === other);
    assert.ok(row && row.deleting === false, "nothing was deleted before a person allowed it");
    const self = await w.turn(w.owner, "held-2", [
      { tool: { name: "agents_delete_for_good", input: { agentId: w.agent } } },
    ]);
    assert.match(self[0]?.text ?? "", /cannot delete itself/i, `on itself it is refused: ${self[0]?.text}`);
  } finally {
    await w.close();
  }
});
