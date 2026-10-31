// A new chat asks first before a change the person cares about, and does not nag for the agent's own housekeeping (rc.8, owner rule: no nagging).
// In Ask first (a chat switched to it; new chats are Auto): the agent saves, restores and forgets its own memory and asks the person for a key without a hold; a record write, a routine and a setting are held for a yes.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, newAgent, say, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const holds = async (d: Daemon): Promise<Array<{ capName: string; act: string }>> => ((await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ capName: string; act: string }> | undefined) ?? [];

test("Ask mode: memory writes and key requests run, record, routine and setting writes are held", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const keeper = await newAgent(d, "Keeper");
    const saved = await say(d, keeper.id, `TOOL memory_remember ${JSON.stringify({ text: "The office closes at five on Fridays.", idempotencyKey: "ask-rem" })}`, "ask1");
    assert.match(saved.reply, /TOOL RESULT ok/, saved.reply);
    const factId = /"factId":"(fct_[a-z0-9]+)"/.exec(saved.reply)?.[1];
    assert.ok(factId, saved.reply);
    const forgot = await say(d, keeper.id, `TOOL memory_forget ${JSON.stringify({ factIds: [factId], idempotencyKey: "ask-forget" })}`, "ask2");
    assert.match(forgot.reply, /TOOL RESULT ok/, forgot.reply);
    const restored = await say(d, keeper.id, `TOOL memory_restore ${JSON.stringify({ factId, idempotencyKey: "ask-restore" })}`, "ask3");
    assert.match(restored.reply, /TOOL RESULT ok/, restored.reply);
    assert.deepEqual(await holds(d), [], "the agent's own memory is never held");

    // a record write is held for a yes
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [keeper.id], idempotencyKey: "ask-rec-start" })).data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "ask" });
    await call(d, "chat.post", { threadId, body: `TOOL records_create ${JSON.stringify({ type: "contact", fields: { name: "Ada" }, idempotencyKey: "ask-rc" })}`, mentions: [{ kind: "agent", id: keeper.id }], idempotencyKey: "ask-rec-post" });
    const held = await waitFor(async () => { await d.hooks?.pump?.(); return (await holds(d)).find((h) => h.capName === "records.create") ?? null; });
    assert.equal(held.act, "approve");
  } finally { await d.stop(); }
});
