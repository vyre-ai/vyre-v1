// The link rule in a plain Auto chat (lead, 12 Nov): a link the agent put together is a read until something a stranger wrote has been read in the chat since the person last spoke. The first composed
// link goes through with no card; once that page was read, a composed link to another host waits for the person; allowed, it runs once (the wake carries its result, nothing is held again); the
// person's next message clearing the mark is proven in modules/gate/tests/grants.test.ts. Real daemon, Gate and tools; the model is scripted. (The pages do not resolve here; a read that fails still read what came back.)
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };

test("a composed link: free first, held after outside content was read, allowed once", async () => {
  let lead = ""; const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.resumed) { results.push(`resumed:${input.resumed.approved}`); yield { type: "text", text: "Done." }; return; }
    yield* run("tool_search", { query: "read link" });
    if (/first/.test(input.trigger?.body ?? "")) {
      results.push(JSON.stringify(yield* run("read_link", { url: "https://www.harborquotes.example/rates" })).slice(0, 120));
      results.push(JSON.stringify(yield* run("read_link", { url: "https://www.other-rates.example/compare" })).slice(0, 120));
    } else {
      results.push(JSON.stringify(yield* run("read_link", { url: "https://www.third-rates.example/" })).slice(0, 120));
    }
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "p-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "p-auto" });
    const cards = async () => ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).flatMap((m) => m.blocks).filter((b) => b.type === "turn_status" && b.data?.["state"] === "waiting").map((b) => String(b.data?.["taskId"]));
    await s.api("chat.post", { threadId: chat, body: "look up the rates, first pass", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "p-ask" });
    const t1 = await waitFor(async () => (await cards())[0] ?? null, 30_000, () => `no card: ${results.join(" | ")}`);
    assert.equal(results.length, 1, "the first composed link went through with no card; the second, after that page was read, waits");
    assert.doesNotMatch(results[0]!, /needs_approval|held/);
    await s.api("tasks.act", { taskId: t1, action: "approve", idempotencyKey: "p-allow" });
    await waitFor(async () => (results.some((r) => r.startsWith("resumed:true")) ? true : null), 30_000, () => results.join(" | "));
    assert.equal((await cards()).length, 1, "allowed once, it ran once: nothing was held again");
  } finally { await stop(s.d); }
});
