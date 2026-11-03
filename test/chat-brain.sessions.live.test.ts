// The turn on a booted daemon, its second file (the first is chat-brain.live.test.ts): long sessions keep a transcript and a summary, API chats apply the agent's deny list and plan mode,
// and the reviewer seat answers once. Nothing inside the daemon is faked; both files boot through test/support/live.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { defaultPrompt } from "../agent/src/drivers/cli/prompt.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { boot, call, connect, hostLog, makeAgent, post, sayAuto, scriptedModel, seededDir, waitFor } from "./support/live.ts";

const brief: OpenSession = async () => ({
  warm: true,
  async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
    const body = input.trigger?.body ?? "";
    yield { type: "text", text: body.startsWith("show") ? defaultPrompt(input, true) : `ok ${body.slice(0, 20)}` };
    yield { type: "done" };
  },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
} as EngineSession);

test("long sessions: every turn is written to the transcript, older turns stand as a summary, the recent twenty stay word for word, and a model switch carries the summary", async () => {
  const d = await boot(seededDir(), brief);
  try {
    await connect(d);
    const id = await makeAgent(d, "Intake");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [id], idempotencyKey: "long-start" });
    const threadId = started.data.thread.threadId as string;
    for (let i = 1; i <= 16; i++) await post(d, threadId, id, `message number ${i} about the Smith matter`, `long${i}`);
    const rows = (await call(d, "chat.transcript.read", { threadId })).data.markdown as string;
    assert.match(rows, /message number 1 about the Smith matter/);
    assert.match(rows, /ok message number 16/);
    const sum = (await call(d, "chat.transcript.summary", { threadId })).data;
    assert.ok(sum.summary.length > 0 && sum.upToIdx > 0, JSON.stringify(sum));
    const shown = await post(d, threadId, id, "show me what you were sent", "long-show");
    const front = shown.slice(0, shown.indexOf("</vyre-context>"));
    assert.match(front, /Earlier in this chat \(a summary of turns before the recent ones/);
    assert.match(front, /transcript_search finds an exact line/);
    const verbatim = shown.slice(shown.indexOf("</vyre-context>"));
    assert.doesNotMatch(verbatim, /message number 1 about/, "the oldest message is in the summary, not word for word");
    assert.match(verbatim, /message number 16 about the Smith matter/);
    const sw = await call(d, "engine.switch", { threadId, agentId: id, driver: "codex", model: "gpt-5" });
    assert.equal(sw.status, 200, JSON.stringify(sw.data));
    const after = await post(d, threadId, id, "show me again", "long-show2");
    assert.match(after.slice(0, after.indexOf("</vyre-context>")), /You are taking over this chat:\nThis chat was running on .* and moved to Codex\./);
    const again = await post(d, threadId, id, "show me once more", "long-show3");
    assert.doesNotMatch(again.slice(0, again.indexOf("</vyre-context>")), /You are taking over this chat/, "the handoff is told once");
  } finally { await d.stop(); }
});

test("API chats apply the agent's deny list and plan mode to their tools, as the asker", async () => {
  const model = scriptedModel(async function* (input, run) {
    const text = input.trigger?.body ?? "";
    const r = yield* run("records_create", { type: "contact", fields: { name: text }, idempotencyKey: `rc-${text}` });
    yield { type: "text", text: r.ok ? "created" : `refused ${(r.content as { error?: { code?: string } }).error?.code}` };
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const open = await makeAgent(d, "Open");
    const closed = await makeAgent(d, "Closed", "You may not write records.", { toolsDenied: ["records_create"] });
    assert.equal((await sayAuto(d, open, "Ada Open", "dl1")).reply, "created");
    assert.match((await sayAuto(d, closed, "Bea Closed", "dl2")).reply, /^refused /, "the deny list is applied");
    const rows = (await call(d, "records.query", { type: "contact", limit: 50 })).data.rows as Array<{ fields: { name: string } }>;
    assert.ok(rows.some((r) => r.fields.name === "Ada Open") && !rows.some((r) => r.fields.name === "Bea Closed"));
    // plan mode: the agent reads and plans, and changes nothing
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [open], idempotencyKey: "pm-start" });
    const threadId = started.data.thread.threadId as string;
    assert.equal((await call(d, "threads.set_plan_mode", { threadId, planMode: true, idempotencyKey: "pm-on" })).status, 200);
    assert.equal(await post(d, threadId, open, "Cy Planned", "pm1"), "refused permission.plan_mode");
  } finally { await d.stop(); }
});

test("the reviewer seat: an agent reviewer is asked in the chat after the lead's turn and answers once; a person reviewer gets a Review task", async () => {
  const model: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const reviewing = /^Asking .* to check this\./.test(input.trigger?.body ?? "");
      yield { type: "text", text: reviewing ? `Approved by ${input.agent.id.slice(-4)}.` : `Done: ${input.trigger?.body ?? ""}` };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const lead = await makeAgent(d, "Drafter", "You draft.");
    const rev = await makeAgent(d, "Checker", "You check.");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: "rv-start" });
    const threadId = started.data.thread.threadId as string;
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "agent", id: lead } })).status, 422, "the lead cannot review itself");
    const set = await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "agent", id: rev } });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual((await call(d, "engine.reviewer.get", { threadId })).data.reviewer, { kind: "agent", id: rev });
    await post(d, threadId, lead, "draft the letter", "rv1");
    const approved = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
      return ms.find((m) => m.author.id === rev && /^Approved/.test(m.body)) ?? null;
    }, 20_000, () => hostLog(d));
    assert.ok(approved);
    const all = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
    assert.ok(all.some((m) => m.author.id === lead && m.body === "Done: draft the letter"));
    assert.equal(all.filter((m) => /^Asking .* to check this\.$/.test(m.body) && m.author.id === lead).length, 1, "asked once, not again after the reviewer's own verdict");
    assert.match(all.find((m) => /^Asking /.test(m.body))!.body, /^Asking Checker to check this\.$/, "by name, in one quiet line");
    await new Promise<void>((r) => setTimeout(r, 1500));
    await d.hooks?.pump?.();
    const later = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author: { id: string }; body: string }>;
    assert.deepEqual(later.map((m) => m.body), all.map((m) => m.body), "the verdict is addressed to the person, so the lead does not answer it");
    // a person reviewer gets a task and the chat is not interrupted
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: { kind: "person", id: "usr_mia" } })).status, 200);
    await post(d, threadId, lead, "draft the second letter", "rv2");
    const tasks = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await call(d, "tasks.list", { scope: "assigned_by_me" });
      const rows = (r.data.tasks ?? []) as Array<{ kind?: string; title?: string; assigned?: { id?: string } }>;
      const mine = rows.filter((t) => /Review Drafter/.test(t.title ?? ""));
      return mine.length > 0 ? mine : null;
    }, 20_000, () => hostLog(d));
    assert.equal(tasks[0]!.assigned?.id, "usr_mia");
    assert.equal((await call(d, "engine.reviewer.set", { threadId, reviewer: null })).status, 200);
    assert.equal((await call(d, "engine.reviewer.get", { threadId })).data.reviewer, null);
  } finally { await d.stop(); }
});
