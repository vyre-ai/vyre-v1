// A question and a plan are tasks (DESIGN-chat-system, the rule): they reach Needs you, the count and the notifications, and answering anywhere resumes the agent that asked. A booted daemon, a scripted model,
// and a person who answers from Needs you or from the card in the chat. A press on something already decided hears so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";

type Msg = { body?: string; author?: { kind?: string }; blocks?: { type: string; id?: string; state?: string; data?: Record<string, unknown> }[] };
const needs = async (d: Parameters<typeof call>[0]) => (await call(d, "tasks.needs_you", {})).data.items as { task: { id: string; kind: string; title: string; threadId?: string; state: string; actions: { key: string }[] } }[];
const count = async (d: Parameters<typeof call>[0]) => (await call(d, "tasks.count_needs_you", {})).data.count as number;
const messages = async (d: Parameters<typeof call>[0], threadId: string) => (await call(d, "chat.messages.list", { threadId })).data.messages as Msg[];
const block = async (d: Parameters<typeof call>[0], threadId: string, type: string) => waitFor(async () => {
  for (const m of (await messages(d, threadId)).reverse()) for (const b of m.blocks ?? []) if (b.type === type && b.state !== "done") return b;
  return null;
});
const heard = (d: Parameters<typeof call>[0], threadId: string, re: RegExp) => waitFor(async () => ((await messages(d, threadId)).some((m) => m.author?.kind === "agent" && re.test(m.body ?? "")) ? true : null));
const script = (run: RunTool, input: any, heardFrom: (s: string) => void) => (async function* () {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const use = makeUse(run, { calls: 0, log: [] });
  const last = String(input.trigger?.body ?? "");
  heardFrom(last);
  if (/^ask$/.test(last)) { yield* use("ask_question", { threadId: input.threadId, prompt: "Which date?\nThe file has two.", mode: "single", options: [{ key: "a", label: "5 May" }, { key: "b", label: "6 May" }] }); return; }
  if (/^ask free$/.test(last)) { yield* use("ask_question", { threadId: input.threadId, prompt: "Who signed?", mode: "free" }); return; }
  if (/^plan$/.test(last)) { yield* use("plan_propose", { threadId: input.threadId, title: "Move the files", steps: [{ text: "List them" }, { text: "Move them" }] }); return; }
  yield { type: "text", text: `Heard: ${last}` };
})();

test("a question and a plan wait in Needs you, and the answer reaches the agent from either door", async () => {
  const dir = seededDir();
  const turns: string[] = [];
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) { yield* script(run, input, (s) => turns.push(s)); }));
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Asker");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "na-start" });
    const threadId = started.data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "na-auto" });
    const say = (body: string, key: string) => call(d, "chat.post", { threadId, body, idempotencyKey: key });

    // the question is a task, in Needs you and in the count, and the card names it
    await say("ask", "na-1");
    const q = await block(d, threadId, "question");
    await d.hooks?.pump?.();
    const row = (await needs(d)).find((i) => i.task.kind === "answer")!;
    assert.ok(row, "the question is in Needs you");
    assert.equal(row.task.title, "Which date?", "the first line is the title");
    assert.equal(row.task.threadId, threadId, "a question lives in its chat, with no second thread");
    assert.equal(q.data?.["taskId"], row.task.id, "the card holds a reference to the task");
    assert.equal(await count(d), 1);
    const notes = (await call(d, "notifications.list", {})).data.notifications as { subject?: { id?: string } }[];
    assert.ok(notes.some((n) => n.subject?.id === row.task.id), "the person is notified");

    // a bare press from a list cannot answer: an Answer needs words or a pick
    assert.equal((await call(d, "tasks.act", { taskId: row.task.id, action: "answer", idempotencyKey: "na-bare" })).status, 422);

    // answered from Needs you: the card closes, the count falls, the agent hears it and runs once
    const before = turns.length;
    const acted = await call(d, "tasks.act", { taskId: row.task.id, action: "answer", note: "5 May", idempotencyKey: "na-act" });
    assert.equal(acted.status, 200, JSON.stringify(acted.data));
    assert.equal(acted.data.task.state, "done");
    await heard(d, threadId, /Heard: Answered: 5 May \(a\)/);
    assert.equal(turns.length, before + 1, "one wake, one turn");
    assert.equal(await count(d), 0);
    const answered = (await messages(d, threadId)).flatMap((m) => m.blocks ?? []).find((b) => b.id === q.id)!;
    assert.equal(answered.state, "done", "the card follows");

    // a press behind the truth hears it was decided
    const stale = await call(d, "tasks.act", { taskId: row.task.id, action: "answer", note: "6 May", idempotencyKey: "na-stale" });
    assert.equal(stale.status, 422);
    assert.match(JSON.stringify(stale.data), /Already decided/);
    const staleCard = await call(d, "chat.answer_block", { threadId, blockId: q.id, answer: { keys: ["b"] }, idempotencyKey: "na-stale-card" });
    assert.match(JSON.stringify(staleCard.data), /Already decided/);

    // answered on the card: the task closes behind it
    await say("ask free", "na-2");
    const free = await block(d, threadId, "question");
    await call(d, "chat.answer_block", { threadId, blockId: free.id, answer: "Dana Fox", idempotencyKey: "na-card" });
    await heard(d, threadId, /Heard: Answered: Dana Fox/);
    await waitFor(async () => { await d.hooks?.pump?.(); return (await count(d)) === 0 ? true : null; });

    // a plan is an Approve task: approved from Needs you, the agent goes on
    await call(d, "threads.set_mode", { threadId, mode: "plan", idempotencyKey: "na-plan-mode" });
    await say("plan", "na-3");
    await block(d, threadId, "plan");
    await d.hooks?.pump?.();
    const plan = (await needs(d)).find((i) => i.task.kind === "approve")!;
    assert.equal(plan.task.title, "Move the files");
    const approved = await call(d, "tasks.act", { taskId: plan.task.id, action: "approve", idempotencyKey: "na-approve" });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    await heard(d, threadId, /Heard: Plan approved/);
    const thread = (await call(d, "threads.get", { threadId })).data.thread as { mode?: string };
    assert.equal(thread.mode, "auto", "approving ends plan mode");

    // sent back from Needs you: the note reaches the agent, and nothing waits any more
    await call(d, "threads.set_mode", { threadId, mode: "plan", idempotencyKey: "na-plan-mode2" });
    await say("plan", "na-4");
    await block(d, threadId, "plan");
    await d.hooks?.pump?.();
    const second = (await needs(d)).find((i) => i.task.kind === "approve")!;
    const back = await call(d, "tasks.act", { taskId: second.task.id, action: "reject", note: "Too broad", idempotencyKey: "na-reject" });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.equal(back.data.task.state, "canceled");
    await heard(d, threadId, /Heard: Plan sent back: Too broad/);
    assert.equal(await count(d), 0);

    // a plan approved on its card closes its task
    await say("plan", "na-5");
    const third = await block(d, threadId, "plan");
    await call(d, "chat.approve_plan", { threadId, planId: third.data?.["planId"], idempotencyKey: "na-card-plan" });
    await waitFor(async () => { await d.hooks?.pump?.(); return (await count(d)) === 0 ? true : null; });
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
