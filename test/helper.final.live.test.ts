// The parent's closing answer waits for the crew (owner, 5 Nov 2026): while one helper still works, another's result is kept in the chat but does not wake the lead; the lead answers once, after the last one is back.
// Real chat, helpers, engine and bridge on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };

test("a helper that finishes first does not wake the lead; one answer comes after the last helper", async () => {
  let lead = ""; let chat = "";
  const wakes: string[] = [];
  let slowDone = false;
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      const body = input.trigger?.body ?? "";
      if (/start the helpers/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        for (const n of [1, 2]) yield* run("sub_task_model", { threadId: input.threadId, title: `Helper ${n}`, instruction: `Task number ${n}: say what you find.`, idempotencyKey: `fa-${n}` });
        yield { type: "text", text: "Two helpers are on it." };
      } else if (input.trigger?.author.kind === "agent") {
        wakes.push(body.slice(0, 40));
        yield { type: "text", text: "Both are back: one and two found their facts." };
      }
      return;
    }
    const brief = input.trigger?.body ?? "";
    if (/number 1/.test(brief)) { yield { type: "text", text: "The first fact." }; return; }
    await new Promise((r) => setTimeout(r, 9000));
    slowDone = true;
    yield { type: "text", text: "The second fact." };
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Final", idempotencyKey: "fa-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start the helpers", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "fa-ask" });
    // the first helper is done while the second still works: its result is in the chat, and the lead has not been woken
    await waitFor(async () => {
      const h = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ title: string; state: string }>;
      return h.find((x) => x.title === "Helper 1")?.state === "done" && h.find((x) => x.title === "Helper 2")?.state === "working" ? true : null;
    }, 40_000, () => hostLog(s.d));
    await new Promise((r) => setTimeout(r, 2500));
    const early = ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]);
    assert.ok(early.some((m) => /Helper "Helper 1" found/.test(m.body)), "the first result is kept in the chat");
    assert.equal(wakes.length, 0, "the lead is not woken while a helper still works");
    assert.ok(!early.some((m) => /Both are back/.test(m.body)), "no closing answer yet");
    // the last helper is back: the lead answers once
    await waitFor(async () => (((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).some((m) => /Both are back/.test(m.body)) ? true : null), 40_000, () => hostLog(s.d));
    assert.equal(slowDone, true);
    assert.equal(wakes.length, 1, "one wake, after the last helper");
    const answers = ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).filter((m) => /Both are back/.test(m.body));
    assert.equal(answers.length, 1);
  } finally { await stop(s.d); }
});
