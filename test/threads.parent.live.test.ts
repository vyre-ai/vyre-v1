// A thread is part of a conversation (DESIGN-chat-system, one thread model): an agent in one reads the message it hangs off and the conversation around it, and an @agent in any thread wakes that agent there.
// A booted daemon and a scripted model that reads its real turn context.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";

interface Seen { threadId: string; agent: string; body: string; parent: string }
type D = Parameters<typeof call>[0];
const bodies = async (d: D, threadId: string) => ((await call(d, "chat.messages.list", { threadId })).data.messages as { body?: string; messageId: string; author: { kind: string; id: string } }[]);
const said = (d: D, threadId: string, re: RegExp) => waitFor(async () => { await d.hooks?.pump?.(); return (await bodies(d, threadId)).find((m) => m.author.kind === "agent" && re.test(m.body ?? "")) ?? null; });

test("threads carry their parent, and a mention wakes the agent named in them", async () => {
  const dir = seededDir();
  const seen: Seen[] = [];
  let handTo = "";
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const use = makeUse(run, { calls: 0, log: [] });
    const body = String(input.trigger?.body ?? "");
    const parent = String((input.context?.sections ?? []).find((s: { id: string }) => s.id === "parent")?.text ?? "");
    seen.push({ threadId: input.threadId, agent: input.agent.id, body, parent });
    if (/hand it over/.test(body)) { yield* use("handoff", { threadId: input.threadId, toAgentId: handTo, note: "Check the retainer figure" }); yield { type: "text", text: "Handed over." }; return; }
    yield { type: "text", text: `Reply to: ${body.slice(0, 60)}` };
  }));
  try {
    await connect(d);
    const lead = await makeAgent(d, "Lead");
    const second = await makeAgent(d, "Second");
    handTo = second;
    const start = await call(d, "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: "tp-start" });
    const chat = start.data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "tp-auto" });
    await call(d, "chat.post", { threadId: chat, body: "The retainer is 5000 dollars.", idempotencyKey: "tp-1" });
    const reply = await said(d, chat, /Reply to: The retainer/);

    // a person's thread under the agent's message: the agent sees what it hangs off
    const under = (await call(d, "chat.thread", { threadId: chat, messageId: reply.messageId, idempotencyKey: "tp-th" })).data.thread.threadId as string;
    await call(d, "chat.post", { threadId: under, body: "Is that per month?", idempotencyKey: "tp-2" });
    await said(d, under, /Reply to: Is that per month/);
    const inThread = seen.find((s) => s.threadId === under)!;
    assert.match(inThread.parent, /hangs off this message/);
    assert.match(inThread.parent, /Reply to: The retainer/, "the parent message");
    assert.match(inThread.parent, /The retainer is 5000 dollars/, "the conversation around it");

    // an @agent in a thread nobody brought it to: it joins that thread, wakes, and replies there
    const people = (await bodies(d, chat)).find((m) => m.author.kind === "person")!;
    const onMine = (await call(d, "chat.thread", { threadId: chat, messageId: people.messageId, idempotencyKey: "tp-th2" })).data.thread.threadId as string;
    await call(d, "chat.post", { threadId: onMine, body: "@Second what do you make of it?", mentions: [{ kind: "agent", id: second }], idempotencyKey: "tp-3" });
    await said(d, onMine, /Reply to: @Second what do you/);
    assert.match(seen.find((s) => s.threadId === onMine)!.parent, /The retainer is 5000 dollars/);
    assert.equal(seen.filter((s) => s.threadId === onMine && s.agent === lead).length, 0, "only the agent named");

    // a handoff stores what it was handed from: the next agent reads it
    await call(d, "chat.post", { threadId: chat, body: "hand it over please", idempotencyKey: "tp-4" });
    const handed = await waitFor(async () => { await d.hooks?.pump?.(); return seen.find((s) => s.agent === second && s.threadId !== onMine) ?? null; });
    const thread = (await call(d, "threads.get", { threadId: handed.threadId })).data.thread as { parentMessageId?: string; parentThreadId?: string };
    assert.equal(thread.parentThreadId, chat);
    assert.ok(thread.parentMessageId, "the handoff keeps the message it left from");
    assert.match(handed.parent, /hand it over please/);

  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
