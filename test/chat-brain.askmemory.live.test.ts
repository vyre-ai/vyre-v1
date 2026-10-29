// Chat-brain live test, third file (see chat-brain.live.test.ts): what a person says in an Ask thread and memory keeps is theirs. It lands in the asker's own layer, never in the agent's shared memory.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("a fact learned in an Ask thread lands in the asker's layer, not in the agent's shared memory", async () => {
  const model = scriptedModel(async function* () { yield { type: "text", text: "noted" }; });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Keeper", "You answer questions about the page.", { captureMode: "auto_low_risk" });
    const contact = (await call(d, "records.create", { type: "contact", fields: { name: "Ask Subject" }, idempotencyKey: "am-rec" })).data.record.id as string;
    const started = await call(d, "chat.start", { kind: "ask", agentIds: [agent], scopeType: "contact", scopeId: contact, idempotencyKey: "am-start" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const threadId = started.data.thread.threadId as string;
    const posted = await call(d, "chat.post", { threadId, body: "I prefer teal folders for client invoices.", mentions: [{ kind: "agent", id: agent }], idempotencyKey: "am-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { kind: string }; body: string }>;
      return ms.some((m) => m.author.kind === "agent" && m.body === "noted") ? true : null;
    }, 20_000, () => hostLog(d));
    assert.equal((await call(d, "threads.close", { threadId, idempotencyKey: "am-close" })).status, 200);
    const mine = await waitFor(async () => {
      await d.hooks?.pump?.();
      const f = (await call(d, "memory.facts.list", { layer: "person", fromMe: true, status: ["current", "proposed"] })).data.facts as Array<{ text: string; layer: string }> | undefined;
      return f && f.some((x) => x.text.includes("teal folders")) ? f : null;
    }, 20_000, () => hostLog(d));
    assert.ok(mine.every((f) => f.layer === "person"));
    const shared = (await call(d, "memory.facts.list", { layer: "agent", agentId: agent, status: ["current", "proposed"] })).data.facts as Array<{ text: string }>;
    assert.ok(!shared.some((f) => f.text.includes("teal folders")), "the agent's shared memory did not learn it");
    const space = (await call(d, "memory.facts.list", { layer: "space", status: ["current", "proposed"] })).data.facts as Array<{ text: string }>;
    assert.ok(!space.some((f) => f.text.includes("teal folders")), "nor did the Space's");
  } finally { await d.stop(); }
});
