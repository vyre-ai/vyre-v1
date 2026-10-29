// The turn context on a booted daemon (CHAT-DESIGN "The turn"): what an agent is told before it answers. Nothing inside the daemon is faked; the model vendor stand-in answers with the prompt
// a CLI engine is sent for the turn (agent/src/drivers/cli/prompt.ts), so what the engine put in front of the model is what the reply says.
import test from "node:test";
import assert from "node:assert/strict";
import { defaultPrompt } from "../agent/src/drivers/cli/prompt.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { boot, call, connect, hostLog, makeAgent, post, say, scriptedModel, seededDir, waitFor } from "./support/live.ts";

const standIn: OpenSession = async () => ({
  warm: true,
  async *send(input: TurnInput): AsyncGenerator<DriverEvent> { yield { type: "text", text: defaultPrompt(input, true) }; yield { type: "done" }; },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
} as EngineSession);

test("turn context: identity, where, skills, what the agent can do here and the time reach the engine, with real names", async () => {
  const d = await boot(seededDir(), standIn);
  try {
    await connect(d);
    const id = await makeAgent(d, "Intake", "You answer intake questions.");
    const { reply, threadId } = await say(d, id, "hello", "ctx1");
    const front = /<vyre-context>\n([\s\S]*?)\n<\/vyre-context>/.exec(reply)?.[1] ?? "";
    assert.ok(front !== "", reply);
    assert.match(front, new RegExp(`^You are Intake \\(agentId ${id}\\), an agent in Vyre\\. You answer intake questions\\.`));
    assert.match(front, /Your AGENT\.md:\n# Intake/);
    assert.match(front, /Where you are:\nSpace: Core \(team\)\./);
    assert.match(front, new RegExp(`threadId ${threadId}\\. This is a chat\\.`));
    assert.match(front, /You are talking with Olivia Park \(usr_olivia; /, "the person is named, not only an id");
    assert.match(front, /Working in Vyre \(always loaded\):\n# Working in Vyre/, "the manual is in front of the agent");
    assert.match(front, /Other skills, by name\. Load one with agents_builtin_skill_get[^\n]*:\n- agent-computer: /);
    assert.match(front, /agents_routine_save/);
    assert.match(front, /Vault: no items are set for you/);
    assert.match(front, /\nIt is \w+day, \d+ \w+ 20\d\d, \d\d:\d\d \([A-Za-z/_]+\)\.$/);
    assert.ok(reply.endsWith("hello"), "the person's words come last");
    assert.doesNotMatch(reply, /sk-ant-/, "no key in the context");
  } finally { await d.stop(); }
});

test("loops: an agent sets, lists, changes and stops its own schedules and watchers from chat, and they show on its page", async () => {
  // The model reads the context (it must name the routine tools), finds the tool with tool_search and acts for itself. Each branch is what a model does for that ask.
  type Routine = { routineId: string; title: string; cron?: string; kind?: string; enabled: boolean; watch?: { channelId: string } };
  const model = scriptedModel(async function* (input, run) {
    const text = input.trigger?.body ?? "";
    const can = input.context?.sections.find((x) => x.id === "can")?.text ?? "";
    if (!/agents_routine_save/.test(can) || !/agents_routines_list/.test(can)) { yield { type: "text", text: "the context did not name the routine tools" }; return; }
    yield* run("tool_search", { query: "routine schedule watcher for myself" });
    const agentId = input.agent.id;
    if (/every Monday/.test(text)) {
      const r = yield* run("agents_routine_save", { agentId, title: "Overdue invoices", cron: "0 9 * * 1", prompt: "Send the asker the list of overdue invoices.", idempotencyKey: "rt-1" });
      yield { type: "text", text: r.ok ? "scheduled" : `FAILED ${JSON.stringify(r.content)}` };
    } else if (/^watch /.test(text)) {
      const channelId = /(chn_[a-z0-9]+)/.exec(text)?.[1] ?? "";
      const r = yield* run("agents_routine_save", { agentId, title: "Triage intake", kind: "watch", watch: { on: "message", channelId }, prompt: "Read the new message and tag it.", idempotencyKey: "rt-2" });
      yield { type: "text", text: r.ok ? "watching" : `FAILED ${JSON.stringify(r.content)}` };
    } else if (/Tuesday/.test(text)) {
      const list = yield* run("agents_routines_list", { agentId });
      const rows = ((list.content as { data?: { routines?: Array<{ routineId: string; title: string }> } }).data?.routines) ?? [];
      const mine = rows.find((x) => x.title === "Overdue invoices");
      const r = yield* run("agents_routine_save", { agentId, routineId: mine?.routineId, title: "Overdue invoices", cron: "0 9 * * 2", prompt: "Send the asker the list of overdue invoices.", idempotencyKey: "rt-3" });
      yield { type: "text", text: r.ok ? "moved to Tuesday" : `FAILED ${JSON.stringify(r.content)}` };
    } else if (/stop the watcher/.test(text)) {
      const list = yield* run("agents_routines_list", { agentId });
      const rows = ((list.content as { data?: { routines?: Array<{ routineId: string; kind?: string }> } }).data?.routines) ?? [];
      const w = rows.find((x) => x.kind === "watch");
      const r = yield* run("agents_routine_delete", { agentId, routineId: w?.routineId });
      yield { type: "text", text: r.ok ? "stopped" : `FAILED ${JSON.stringify(r.content)}` };
    }
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const id = await makeAgent(d, "Biller", "You chase invoices.");
    const chan = await call(d, "channels.create", { name: "intake", visibility: "invite", idempotencyKey: "cb-chan" });
    assert.equal(chan.status, 200, JSON.stringify(chan.data));
    const channelId = chan.data.channel.channelId as string;
    const list = async (): Promise<Routine[]> => (await call(d, "agents.routines.list", { agentId: id })).data.routines as Routine[];

    const first = await say(d, id, "every Monday 9am send me the overdue invoices", "loop1");
    assert.equal(first.reply, "scheduled");
    assert.deepEqual((await list()).map((r) => [r.title, r.cron, r.enabled]), [["Overdue invoices", "0 9 * * 1", true]]);

    const second = await post(d, first.threadId, id, `watch ${channelId} for new messages and tag them`, "loop2");
    assert.equal(second.trim(), "watching");
    const both = await list();
    assert.equal(both.length, 2);
    assert.ok(both.some((r) => r.kind === "watch" && r.watch?.channelId === channelId), JSON.stringify(both));

    const third = await post(d, first.threadId, id, "make the invoices go out on Tuesday instead", "loop3");
    assert.equal(third.trim(), "moved to Tuesday");
    const after = await list();
    assert.equal(after.length, 2, "changed in place, not copied");
    assert.equal(after.find((r) => r.title === "Overdue invoices")?.cron, "0 9 * * 2");

    const fourth = await post(d, first.threadId, id, "stop the watcher", "loop4");
    assert.equal(fourth.trim(), "stopped");
    assert.deepEqual((await list()).map((r) => r.title), ["Overdue invoices"]);
  } finally { await d.stop(); }
});

test("screen context: what the person had open reaches the agent with the focus skill of the place, only for the message that carried it", async () => {
  const d = await boot(seededDir(), standIn);
  try {
    await connect(d);
    const id = await makeAgent(d, "Intake");
    const first = await say(d, id, "hello", "scr0");
    assert.doesNotMatch(first.reply, /On the person's screen/, "a plain chat has no screen");
    assert.doesNotMatch(first.reply, /Focus for this place/);
    const screen = { place: "records", title: "Contacts", open: [{ type: "record", id: "rec_demo1", title: "Maya Chen" }], filters: { stage: "New" }, rows: { shown: 25, total: 137, sample: ["Maya Chen, New"] }, actions: ["records.update"] };
    const reply = await post(d, first.threadId, id, "who is this?", "scr1", { screen });
    assert.match(reply, /On the person's screen:\nThe person is in records, on "Contacts"\./);
    assert.match(reply, /Open: record rec_demo1 "Maya Chen"\./);
    assert.match(reply, /Rows on screen: 25 of 137\./);
    assert.match(reply, /Focus for this place:\nfocus-records\n/);
    assert.match(reply, /Call `schema_describe` for the type\./);
    const loaded = await call(d, "agents.builtin_skill.get", { name: "focus-vault" });
    assert.equal(loaded.status, 200, JSON.stringify(loaded.data));
    assert.match(loaded.data.body, /You never see a value/);
    assert.equal((await call(d, "agents.builtin_skill.get", { name: "../etc/passwd" })).status, 422);
    assert.equal((await call(d, "agents.builtin_skill.get", { name: "no-such-skill" })).status, 404);
    const next = await post(d, first.threadId, id, "thanks", "scr2");
    const head = (r: string): string => r.slice(0, r.indexOf("</vyre-context>"));
    assert.doesNotMatch(head(next), /On the person's screen/, "the next message, sent without a screen, has none");
    assert.match(head(reply), /On the person's screen/);
    const got = await call(d, "chat.screen.get", { threadId: first.threadId });
    assert.equal(got.data.screen.place, "records");
  } finally { await d.stop(); }
});

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
    assert.equal((await say(d, open, "Ada Open", "dl1")).reply, "created");
    assert.match((await say(d, closed, "Bea Closed", "dl2")).reply, /^refused /, "the deny list is applied");
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
