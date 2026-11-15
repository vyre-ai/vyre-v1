// Building by asking, on a booted daemon (AUTOMATIONS-BUILD-RC29 phase 2): an agent in a chat puts steps on the page with its own tool call, through the real invoke path.
// The steps are a proposal: the Automation stays empty and off. The agent cannot accept it; the person can, and then the steps are the Automation's, still off.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

let n = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ap-${cap}-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const step = (id: string, title: string, next?: string): Record<string, unknown> => ({
  id,
  key: "create_task",
  title,
  input: { title, assigned: { kind: "person", id: "usr_olivia" } },
  ...(next ? { next: [next] } : {}),
});
const NAME = "New lead follow-up";
const found = async (d: Daemon): Promise<{ id: string } | null> =>
  ((await call(d, "automations.list", {})).data.automations as Array<{ id: string; name: string }> | undefined)?.find(
    (a) => a.name === NAME,
  ) ?? null;

test("propose live: an agent's own tool call puts three steps on the page as a proposal; it cannot accept; the person accepts and nothing is turned on", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Builder");
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    const definition = {
      triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }],
      nodes: [
        step("call", "Call the new lead", "quote"),
        step("quote", "Send the quote", "thank"),
        step("thank", "Thank them a week later"),
      ],
    };
    await ok(d, "chat.post", {
      threadId,
      body: `TOOL automations_draft_propose ${JSON.stringify({
        name: NAME,
        definition,
        summary: "When a contact is added: call them, send the quote, thank them a week later.",
        idempotencyKey: "ap-propose",
      })}`,
      mentions: [{ kind: "agent", id: agent.id }],
    });
    const made = await waitFor(
      async () => {
        await d.hooks?.pump?.();
        return found(d);
      },
      40_000,
      () => hostLog(d),
    );
    const first = await ok(d, "automations.get", { automationId: made.id });
    assert.equal(first.automation.status, "draft", "nothing is turned on");
    assert.equal(first.automation.definition.nodes.length, 0, "nothing proposed is saved as the definition");
    assert.equal(first.proposal.steps, 3, "three actions are three steps");
    assert.equal(first.proposal.by, agent.id);
    assert.deepEqual(
      first.proposal.definition.nodes.map((x: { id: string }) => x.id),
      ["call", "quote", "thank"],
      "in the order said",
    );

    // the agent tries to accept its own proposal: refused, and nothing moves
    const before = ((await call(d, "chat.messages.list", { threadId })).data.messages as unknown[]).length;
    await ok(d, "chat.post", {
      threadId,
      body: `TOOL automations_proposal_accept ${JSON.stringify({ automationId: made.id, idempotencyKey: "ap-accept-agent" })}`,
      mentions: [{ kind: "agent", id: agent.id }],
    });
    await waitFor(
      async () => {
        await d.hooks?.pump?.();
        const now = ((await call(d, "chat.messages.list", { threadId })).data.messages as unknown[]).length;
        return now >= before + 2 ? true : null;
      },
      40_000,
      () => hostLog(d),
    );
    const still = await ok(d, "automations.get", { automationId: made.id });
    assert.equal(still.automation.definition.nodes.length, 0, "the agent's accept wrote nothing");
    assert.equal(still.proposal.steps, 3, "the proposal is still waiting for the person");

    // the person accepts: the steps are the Automation's now, and it is still off
    const done = await ok(d, "automations.proposal.accept", { automationId: made.id });
    assert.equal(done.automation.definition.nodes.length, 3);
    assert.equal(done.automation.status, "draft");
    assert.equal(done.proposal, undefined);
    const again = await ok(d, "automations.proposal.accept", { automationId: made.id });
    assert.equal(again.automation.definition.nodes.length, 3, "a second press changes nothing");
  } finally {
    await d.stop();
  }
});
