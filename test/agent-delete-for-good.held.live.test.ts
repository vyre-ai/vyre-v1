// F77: an agent that asks to delete another agent for good is held for a person's Allow (nothing is deleted until a person allows it); on itself it is refused (unit test). A booted Team daemon, a
// scripted model that makes the agent's tool call.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/agentpc-world.ts";
import { waitFor } from "./support/eco-live.ts";

test("an agent deleting another agent for good is held for a person (on itself it is refused: modules/agents/tests/erase.test.ts)", async () => {
  const w = await world();
  try {
    const other = (await w.owner.call("agents.create", { name: "Spare", role: "Spare." })).data.agent.agentId as string;
    assert.equal((await w.owner.call("agents.delete", { agentId: other })).status, 200);
    // the agent asks: the call stops at the Gate and waits for a person, so the turn does not finish; the hold is what is looked at
    const chat = await w.owner.call("chat.start", { kind: "chat", agentIds: [w.agent] });
    const threadId = chat.data.thread.threadId as string;
    await w.owner.call("threads.set_mode", { threadId, mode: "auto" });
    const steps = [{ tool: { name: "agents_delete_for_good", input: { agentId: other } } }];
    await w.owner.call("chat.post", {
      threadId,
      body: `RUN held-1 ${JSON.stringify(steps)}`,
      mentions: [{ kind: "agent", id: w.agent }],
    });
    const hold = await waitFor(async () => {
      await w.d.hooks?.pump?.();
      const list = await w.owner.call("gate.holds.list", { states: ["held"] });
      const rows = (list.data.holds ?? list.data.rows ?? []) as Array<Record<string, unknown>>;
      return rows.find((r) => JSON.stringify(r).includes("delete_for_good")) ?? null;
    }, 120_000);
    assert.ok(hold, "the call is held for a person's Allow");
    const row = (
      (await w.owner.call("agents.trash.list", {})).data.agents as Array<{ agentId: string; deleting: boolean }>
    ).find((a) => a.agentId === other);
    assert.ok(row && row.deleting === false, "nothing was deleted before a person allowed it");
  } finally {
    await w.close();
  }
});
