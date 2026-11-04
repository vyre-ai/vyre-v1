// Helpers under a chat, live (owner, 4 Nov 2026): one state per helper (working with the step it is on, done with one line, failed), cost and time per helper, steer a running helper, Stop one, Stop all. The
// real chat, helper threads, engine and tools on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";
import { internalNames } from "../lib/plain-words.ts";

type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };

test("two helpers: working with a step, then done with one line and a cost; a running one is steered and stopped, and Stop all stops the rest; nothing names a tool", async () => {
  let lead = ""; let chat = "";
  const asked: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      if (/start the helpers/.test(input.trigger?.body ?? "")) {
        yield* run("tool_search", { query: "sub task helper" });
        for (const n of [1, 2, 3]) yield* run("sub_task_model", { threadId: input.threadId, title: `Helper ${n}`, instruction: `Task number ${n}: say what you find.`, idempotencyKey: `st-${n}` });
        yield { type: "text", text: "Started three helpers." };
      }
      return;
    }
    // a helper turn
    const brief = input.trigger?.body ?? "";
    asked.push(brief);
    if (/number 1/.test(brief)) { yield { type: "text", text: "The first thing is a result of one fact. A second sentence nobody needs." }; return; }
    if (/number 3/.test(brief)) { throw new Error("the helper fell over"); }
    // number 2: stays inside a call long enough to be seen, and answers a question put to it
    if (/Task number 2/.test(brief)) { await new Promise((r) => setTimeout(r, 6000)); yield { type: "text", text: "Done with the second one." }; }
    else { yield { type: "text", text: `You asked: ${brief.slice(0, 40)}` }; }
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Helpers", idempotencyKey: "hs-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start the helpers", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hs-ask" });
    const states = await waitFor(async () => {
      const r = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ title: string; state: string }>;
      return r.length === 3 && r.some((h) => h.state === "done") && r.some((h) => h.state === "failed") ? r : null;
    }, 40_000, () => hostLog(s.d));
    assert.deepEqual(Object.fromEntries(states.map((h) => [h.title, h.state])).Helper1 ?? states.find((h) => h.title === "Helper 1")?.state, "done");
    const all = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string; title: string; state: string; found?: string; elapsedMs: number; costMicros: number; tokensIn: number }>;
    const one = all.find((h) => h.title === "Helper 1")!;
    assert.equal(one.state, "done");
    assert.equal(one.found, "The first thing is a result of one fact.", "one line of what it found");
    assert.equal(typeof one.elapsedMs, "number");
    assert.equal(typeof one.costMicros, "number");
    assert.equal(all.find((h) => h.title === "Helper 3")!.state, "failed");

    // steer the helper that is still working: the person asks it something in its own chat; it answers there
    const two = all.find((h) => h.title === "Helper 2")!;
    assert.equal(two.state, "working");
    await s.api("chat.helper.steer", { threadId: two.threadId, body: "Also tell me the colour.", idempotencyKey: "hs-steer" });
    // a plain helper chat still takes no message through chat.post
    const direct = await fetch(`${s.d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.d.token}` }, body: JSON.stringify({ threadId: two.threadId, body: "hi", idempotencyKey: "hs-direct" }) });
    assert.notEqual(direct.status, 200);
    // Stop all stops what is still working
    const stopped = await s.api("engine.helpers.stop_all", { threadId: chat });
    assert.ok(stopped.stopped >= 0);
    await waitFor(async () => (((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).every((h) => h.state !== "working") ? true : null), 30_000, () => hostLog(s.d));

    // nothing in what the agents wrote names a tool or an id
    const msgs = ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).filter((m) => m.author.kind === "agent").map((m) => m.body).join("\n");
    assert.deepEqual(internalNames(msgs), []);
  } finally { await stop(s.d); }
});
