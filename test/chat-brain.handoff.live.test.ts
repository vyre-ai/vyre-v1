// Chat-brain live test, fifth file: the lead pulls another agent in with an @mention, the chat shows one quiet line, "Asking Billing to look at this", and that agent answers once.
import test from "node:test";
import assert from "node:assert/strict";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { boot, call, connect, hostLog, makeAgent, post, seededDir, waitFor } from "./support/live.ts";

test("a lead that @mentions another agent shows one quiet hand-off line and that agent answers once", async () => {
  let billingRuns = 0;
  let billingId = "";
  const model: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      if (input.agent.id === billingId) { billingRuns++; yield { type: "text", text: "Invoice 12 is fine." }; } else yield { type: "text", text: input.trigger?.author.kind === "person" ? "@Billing can you look at invoice 12?" : "Thanks." };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const lead = await makeAgent(d, "Desk", "You run the desk.");
    const billing = await makeAgent(d, "Billing", "You check invoices.");
    billingId = billing;
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: "ho-start" })).data.thread.threadId as string;
    assert.equal((await call(d, "threads.add_agent", { threadId, agentId: billing, idempotencyKey: "ho-add" })).status, 200);
    await post(d, threadId, lead, "please check invoice 12", "ho1").catch(() => undefined);
    type Msg = { author: { id: string }; body: string; kind: string };
    const msgs = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Msg[];
      return ms.some((m) => m.author.id === billing && /Invoice 12 is fine/.test(m.body)) ? ms : null;
    }, 25_000, () => hostLog(d));
    const lines = msgs.filter((m) => /^Asking Billing to look at this\.$/.test(m.body));
    assert.equal(lines.length, 1, JSON.stringify(msgs.map((m) => [m.kind, m.body])));
    assert.equal(lines[0]!.kind, "quiet");
    assert.equal(lines[0]!.author.id, lead);
    await new Promise<void>((r) => setTimeout(r, 1500));
    await d.hooks?.pump?.();
    assert.equal(billingRuns, 1, "the hand-off line woke nobody a second time");
  } finally { await d.stop(); }
});
