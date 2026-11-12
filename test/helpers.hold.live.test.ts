// A helper's held call never waits where nobody looks (release gate blocker, 12 Nov; lane f-gate saw it with a real model in test/helpers.real.live.test.ts). In an Auto chat the person asks the
// Assistant to use helpers; a helper opens a link it put together itself, which the Gate holds (automations.read_link, links.is_composed). The hold must show in the chat where the person asked:
// the helper's row says what it waits for and the approval card is there, with the same task Needs you holds; Allow lets the helper go on and report; the lead chat never sits with no card.
// The real chat, helper threads, engine, Gate and tools on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };

test("a helper's composed link waits for the person in the chat they asked in: its row says what for, the card is there, and Allow lets it finish", async () => {
  let lead = ""; let chat = "";
  const reads: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      if (/look up the rates/.test(input.trigger?.body ?? "")) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Rates on the web", instruction: "Look up the current Harbor rates on the web.", idempotencyKey: "hh-1" });
        yield { type: "text", text: "I'll give you the answer as soon as the helper reports." };
      }
      return;
    }
    if (!/Look up the current Harbor rates/.test(input.trigger?.body ?? "") && !input.resumed) { yield { type: "text", text: "Reported above." }; return; }
    // the wake after the person's answer carries the held call's result, as a model gets it
    if (input.resumed) { reads.push(JSON.stringify(input.resumed).slice(0, 300)); yield { type: "text", text: input.resumed.approved ? "Here is what the rates page says." : "I could not open the rates page." }; return; }
    // the helper: a link it put together itself
    yield* run("tool_search", { query: "read link" });
    // the first link it puts together goes through (nothing outside read yet); the page it read marks the chain, so the next one, to another host, waits for the person (lead, 12 Nov)
    yield* run("read_link", { url: "https://www.other-rates.example/compare" });
    const out = yield* run("read_link", { url: "https://www.harborquotes.example/rates" });
    reads.push(JSON.stringify(out).slice(0, 300));
    yield { type: "text", text: "I could not open the rates page, so I have nothing to add." };
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Rates", idempotencyKey: "hh-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hh-auto" });
    await s.api("chat.post", { threadId: chat, body: "look up the rates with a helper", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hh-ask" });
    // the helper waits: its row in the lead chat says what for, and carries the hold's task
    const held = await waitFor(async () => {
      const r = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string; state: string; holdTaskId?: string; step?: string }>;
      return r.find((h) => h.state === "needs_you" && h.holdTaskId) ?? null;
    }, 40_000, async () => `${JSON.stringify((await s.api("engine.helpers.status", { threadId: chat })).helpers)}\n${hostLog(s.d)}`);
    assert.match(held.step ?? "", /^Needs your OK to open /, `the row says what it waits for: ${held.step}`);
    // the approval card is in the chat the person asked in: the helper's message there carries the waiting turn with the hold's task, and opens the helper's thread
    const raised = ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).filter((m) => m.author.kind === "agent" && m.blocks.some((x) => x.type === "turn_status" && x.data?.["state"] === "waiting" && x.data?.["taskId"] === held.holdTaskId));
    assert.equal(raised.length, 1, "one approval card in the lead chat");
    assert.ok(raised[0]!.blocks.some((x) => x.type === "from_thread" && x.data?.["threadId"] === held.threadId), "and it opens the helper's thread");
    assert.doesNotMatch(held.step ?? "", /automations|read link|read_link/);
    // the same task is in Needs you
    const task = (await s.api("tasks.get", { taskId: held.holdTaskId })).task as { kind?: string; title?: string; state?: string };
    assert.equal(task.kind, "approve");
    assert.doesNotMatch(task.title ?? "", /automations|read link|read_link/, `the task reads in plain words: ${task.title}`);
    // Allow: the helper goes on and reports back in the lead chat
    await s.api("tasks.act", { taskId: held.holdTaskId, action: "approve", idempotencyKey: "hh-allow" });
    let seen = "";
    await waitFor(async () => {
      const hs = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>;
      seen = `${JSON.stringify(hs)} TASK ${JSON.stringify((await s.api("tasks.get", { taskId: held.holdTaskId })).task).slice(0, 400)} HELPER ${JSON.stringify(((await s.api("chat.messages.list", { threadId: held.threadId })).messages as Msg[]).map((m) => [m.author.kind, m.body.slice(0, 60), m.blocks.map((x) => `${x.type}:${String(x.data?.["state"] ?? "")}`)]))} READS ${reads.join("|")}`;
      return hs.every((h) => h.state === "done") ? true : null;
    }, 40_000, () => seen);
    assert.equal(reads.length, 1, "the helper's call ran once it was allowed");
    const msgs = (await s.api("chat.messages.list", { threadId: chat })).messages as Msg[];
    assert.ok(msgs.some((m) => m.author.kind === "agent"), "the lead chat has the lead's words");
  } finally { await stop(s.d); }
});
