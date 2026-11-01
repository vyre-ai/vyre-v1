// chat.make_task: a message becomes a task with no form, assigned to the person named, with a link card left in the thread; refusals say why and leave no card.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { titleFromMessage } from "../handlers/make-task.ts";
import { DANA, INTAKE, MAYA, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `mk-${++n}`;
const made: Record<string, unknown>[] = [];

async function world() {
  made.length = 0;
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }), "tasks.create": (i) => { made.push(i); return { task: { id: "tsk_made1" } }; } } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: dm, body: "@Maya please send the Rivera letter by Friday\nthanks", idempotencyKey: key() })).message.messageId as string;
  return { hn, dm, said };
}
const cards = (hn: ReturnType<typeof harness>, thread: string) => hn.rows(`SELECT body, blocks, kind, author FROM chat_message WHERE thread = ? AND kind = 'system'`, thread);

test("the title is the first line without the leading mention; a default stands in for an empty message", () => {
  assert.equal(titleFromMessage("@Maya please send the Rivera letter by Friday\nthanks"), "please send the Rivera letter by Friday");
  assert.equal(titleFromMessage("   "), "Follow up on this message");
  assert.equal(titleFromMessage("x".repeat(300)).length, 120);
});

test("a message becomes a task assigned to the person named; the task points back at the message and a link card lands in the thread", async () => {
  const { hn, dm, said } = await world();
  const out = await h["chat.make_task"]!(hn.ctx, { threadId: dm, messageId: said, assigneeId: MAYA, idempotencyKey: key() });
  assert.deepEqual(out, { taskId: "tsk_made1", messageId: said });
  const task = made[0] as any;
  assert.equal(task.title, "please send the Rivera letter by Friday");
  assert.deepEqual(task.assigned, { kind: "person", id: MAYA });
  assert.deepEqual(task.source, { kind: "chat", id: dm });
  assert.equal(task.blocks[0].data.messageId, said, "the task links back to the message");
  assert.match(task.summary, /thanks/, "the summary is the whole message");
  const card = cards(hn, dm)[0]!;
  assert.equal(card["author"], DANA);
  const block = JSON.parse(String(card["blocks"]))[0];
  assert.equal(block.type, "link_card");
  assert.deepEqual(block.data, { icon: "task", lead: "Task created", title: "please send the Rivera letter by Friday", who: MAYA, target: { type: "task", id: "tsk_made1" } });
});

test("with no assignee the task is the asker's own; an agent acting for the asker may make it", async () => {
  const { hn, dm, said } = await world();
  await h["chat.make_task"]!(hn.ctx, { threadId: dm, messageId: said, idempotencyKey: key() });
  assert.deepEqual((made[0] as any).assigned, { kind: "person", id: DANA });
  await h["chat.make_task"]!(hn.agent(INTAKE, DANA), { threadId: dm, messageId: said, title: "Send the letter", idempotencyKey: key() });
  assert.equal((made[1] as any).title, "Send the letter");
  assert.deepEqual((made[1] as any).assigned, { kind: "person", id: DANA }, "the agent acts for Dana: the task is Dana's");
});

test("refusals leave no task and no card: someone outside the chat, a notice, a message of another chat, a stranger", async () => {
  const { hn, dm, said } = await world();
  await assert.rejects(h["chat.make_task"]!(hn.ctx, { threadId: dm, messageId: said, assigneeId: "usr_outsider", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(h["chat.make_task"]!(hn.ctx, { threadId: dm, messageId: said, assigneeId: "svc_x", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await assert.rejects(h["chat.make_task"]!(hn.ctx, { threadId: solo, messageId: said, idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h["chat.make_task"]!(hn.person("usr_stranger"), { threadId: dm, messageId: said, idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  assert.equal(made.length, 0);
  assert.equal(cards(hn, dm).length, 0);
  const sysId = hn.rows(`SELECT id FROM chat_message WHERE thread = ? LIMIT 1`, dm)[0]!["id"] as string;
  hn.ctx.db.run(`UPDATE chat_message SET kind = 'system' WHERE id = ?`, sysId);
  await assert.rejects(h["chat.make_task"]!(hn.ctx, { threadId: dm, messageId: sysId, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
});

test("a link card that arrives by chat.post, from an agent or a person, loses what its buttons would call: only a host handler writes a button that calls something", async () => {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const evil = { type: "link_card", v: 1, data: { icon: "task", lead: "Cleanup", title: "Tidy up", body: "Press to tidy", actions: [{ key: "go", label: "Tidy", cap: "threads.delete", input: { threadId: solo } }, { key: "ok", label: "Fine" }] } };
  for (const ctx of [hn.agent(INTAKE, DANA), hn.ctx]) {
    const posted = await h["chat.post"]!(ctx, { threadId: solo, body: "see below", blocks: [evil], idempotencyKey: key() });
    const block = JSON.parse(String(hn.rows(`SELECT blocks FROM chat_message WHERE id = ?`, posted.message.messageId)[0]!["blocks"]))[0];
    assert.deepEqual(block.data.actions, [{ key: "go", label: "Tidy" }, { key: "ok", label: "Fine" }], "buttons are inert");
    assert.equal(JSON.stringify(block).includes("threads.delete"), false, "the destructive call is nowhere in the stored card");
  }
});

test("@mentioning an agent that is not in a chat of the person's own brings it in as a listener; a channel's agents are not added this way", async () => {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  assert.deepEqual(hn.rows(`SELECT agentId FROM chat_thread_agent WHERE thread = ? AND deleted_at IS NULL`, dm), []);
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "@Intake sum this up for us", mentions: [{ kind: "agent", id: INTAKE }], idempotencyKey: key() });
  const joined = hn.rows(`SELECT agentId, mode FROM chat_thread_agent WHERE thread = ? AND deleted_at IS NULL`, dm);
  assert.deepEqual(joined, [{ agentId: INTAKE, mode: "listen" }]);
  assert.deepEqual(hn.named("agent.engaged").map((e) => e.payload["by"]), [MAYA], "engaged by the person who mentioned it");
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "@Intake again", mentions: [{ kind: "agent", id: INTAKE }], idempotencyKey: key() });
  assert.equal(hn.named("agent.engaged").length, 1, "once");
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "public", idempotencyKey: key() })).channel;
  await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "@Intake hi", mentions: [{ kind: "agent", id: INTAKE }], idempotencyKey: key() });
  assert.deepEqual(hn.rows(`SELECT agentId FROM chat_thread_agent WHERE thread = ? AND deleted_at IS NULL`, ch.mainThreadId), [], "a channel's agents are its managers' to add");
});
