// An agent's composed link in a plain Auto chat, allowed by the person, runs once: the wake carries the held call's result and nothing is held again (gate blocker, 12 Nov).
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };
test("a composed link in a plain Auto chat, allowed, runs once", async () => {
  let lead = ""; const reads: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    // the wake after the person's answer carries the held call's result, as a model gets it
    if (input.resumed) { reads.push(JSON.stringify(input.resumed).slice(0, 300)); yield { type: "text", text: input.resumed.approved ? "Here is what the rates page says." : "I could not open the rates page." }; return; }
    yield* run("tool_search", { query: "read link" });
    reads.push(JSON.stringify(yield* run("read_link", { url: "https://www.harborquotes.example/rates" })).slice(0, 200));
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "p-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "p-auto" });
    await s.api("chat.post", { threadId: chat, body: "look up the rates", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "p-ask" });
    const card = async () => ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).flatMap((m) => m.blocks).filter((b) => b.type === "turn_status" && b.data?.["state"] === "waiting").map((b) => String(b.data?.["taskId"]));
    const t1 = await waitFor(async () => (await card())[0] ?? null, 30_000, () => "no card");
    await s.api("tasks.act", { taskId: t1, action: "approve", idempotencyKey: "p-allow" });
    let seen = "";
    await waitFor(async () => { const c = await card(); seen = `${c.join(",")} READS ${reads.join("|")}`; return reads.length > 0 ? true : null; }, 30_000, () => seen);
    assert.equal((await card()).length, 1, `no second hold: ${seen}`);
  } finally { await stop(s.d); }
});
