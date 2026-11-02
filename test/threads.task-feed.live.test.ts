// A task's feed is a thread like any other: an @agent wakes there, and a turn on a task that ends with no status change is nudged once. A reply to another person is for that person, not the lead.
// A booted daemon and a scripted model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import { as, join } from "./support/people.ts";

type D = Parameters<typeof call>[0];
const bodies = async (d: D, threadId: string) => ((await call(d, "chat.messages.list", { threadId })).data.messages as { body?: string; messageId: string; author: { kind: string; id: string } }[]);
const said = (d: D, threadId: string, re: RegExp) => waitFor(async () => { await d.hooks?.pump?.(); return (await bodies(d, threadId)).find((m) => m.author.kind === "agent" && re.test(m.body ?? "")) ?? null; });

test("a task's feed wakes the agent named and nudges once, and a reply to a person stays with people", async () => {
  const dir = seededDir();
  const seen: { threadId: string }[] = [];
  const d = await boot(dir, scriptedModel(async function* (input: any) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const body = String(input.trigger?.body ?? "");
    seen.push({ threadId: input.threadId });
    if (input.trigger === undefined || /Your turn ended/.test(body) || /^stay quiet/.test(body)) return;
    yield { type: "text", text: `Reply to: ${body.slice(0, 60)}` };
  }));
  try {
    await connect(d);
    const lead = await makeAgent(d, "Lead");
    const person = (await call(d, "access.principals.list", {})).data.principals.find((p: { kind: string; roles: string[] }) => p.kind === "person" && (p.roles.includes("rol_owner") || p.roles.includes("rol_admin"))).id as string;
    // a task's feed: an @agent wakes it in the task's thread, and being asked a question there is no baton of its own
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
