// A thread is part of a conversation (DESIGN-chat-system, one thread model): an agent in one reads the message it hangs off and the conversation around it, an @agent in any thread wakes that agent there, a task's
// feed is a thread like any other, and a turn on a task that ends with no status change is nudged once. A reply to a person is for that person. A booted daemon and a scripted model that reads its real turn context.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";
import { as, join } from "./support/people.ts";

interface Seen { threadId: string; agent: string; body: string; parent: string }
type D = Parameters<typeof call>[0];
const bodies = async (d: D, threadId: string) => ((await call(d, "chat.messages.list", { threadId })).data.messages as { body?: string; messageId: string; author: { kind: string; id: string } }[]);
const said = (d: D, threadId: string, re: RegExp) => waitFor(async () => { await d.hooks?.pump?.(); return (await bodies(d, threadId)).find((m) => m.author.kind === "agent" && re.test(m.body ?? "")) ?? null; });

test("threads carry their parent, mentions wake agents in them, a task feed nudges once, and a reply to a person stays with people", async () => {
  const dir = seededDir();
  const seen: Seen[] = [];
  let handTo = "";
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const use = makeUse(run, { calls: 0, log: [] });
    const body = String(input.trigger?.body ?? "");
    const parent = String((input.context?.sections ?? []).find((s: { id: string }) => s.id === "parent")?.text ?? "");
    seen.push({ threadId: input.threadId, agent: input.agent.id, body, parent });
    if (/hand it over/.test(body)) { yield* use("handoff", { threadId: input.threadId, toAgentId: handTo, note: "Check the retainer figure" }); yield { type: "text", text: "Handed over." }; return; }
    if (/^stay quiet/.test(body)) return;
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

    // a task's feed: an @agent wakes it in the task's thread, and being asked a question there is no baton of its own
    const person = people.author.id;
    const mine = (await call(d, "tasks.create", { title: "Draft the letter", assigned: { kind: "person", id: person }, idempotencyKey: "tp-t1" })).data.task;
    await call(d, "chat.post", { threadId: mine.threadId, body: "@Lead any thoughts?", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "tp-5" });
    await said(d, mine.threadId, /Reply to: @Lead any thoughts/);

    // an agent's task: a turn that ends with no status change is nudged once, then left for the clock
    const theirs = (await call(d, "tasks.create", { title: "stay quiet about this", assigned: { kind: "agent", id: lead }, idempotencyKey: "tp-t2" })).data.task;
    const nudge = await waitFor(async () => { await d.hooks?.pump?.(); const t = (await call(d, "tasks.get", { taskId: theirs.id })).data.task; return t.threadId ? ((await bodies(d, t.threadId)).find((m) => /Your turn ended without handing the task on/.test(m.body ?? "")) ?? null) : null; });
    assert.ok(nudge);
    const threadOfTask = (await call(d, "tasks.get", { taskId: theirs.id })).data.task.threadId as string;
    const count = async () => (await bodies(d, threadOfTask)).filter((m) => /Your turn ended without handing/.test(m.body ?? "")).length;
    await waitFor(async () => { await d.hooks?.pump?.(); return seen.filter((s) => s.threadId === threadOfTask).length >= 2 ? true : null; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await count(), 1, "one nudge, however the turn after it ended");

    // two people in a chat with a lead: a reply to the other person does not wake the lead; a plain message does
    const O = as(d, d.token!);
    const bea = await join(d, O, "Member", "bea", "Bea Baker");
    const B = as(d, bea.token);
    const channel = await O("channels.create", { name: "Retainers", visibility: "invite", memberIds: [bea.id], agentIds: [lead] });
    assert.equal(channel.status, 200, JSON.stringify(channel.data));
    const group = channel.data.channel.mainThreadId as string;
    const led = await O("engine.set_mode", { threadId: group, agentId: lead, mode: "lead" });
    assert.equal(led.status, 200, JSON.stringify(led.data));
    const q = (await O("chat.post", { threadId: group, body: "@Bea can you check this?", mentions: [{ kind: "person", id: bea.id }] })).data.message.messageId as string;
    const before = seen.filter((s) => s.threadId === group).length;
    const replied = await B("chat.post", { threadId: group, body: "Yes, on it.", replyTo: q });
    assert.equal(replied.status, 200, JSON.stringify(replied.data));
    await d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 500));
    await d.hooks?.pump?.();
    assert.equal(seen.filter((s) => s.threadId === group).length, before, "the lead stays out of it");
    await O("chat.post", { threadId: group, body: "Thanks all, what next?" });
    await said(d, group, /Reply to: Thanks all/);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
