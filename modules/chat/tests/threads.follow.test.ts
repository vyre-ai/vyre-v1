// Threads you are in (audit Threads 1, 5, 6, 8, 9): a reply or a mention puts a person in a thread and the person who wrote the message above it follows it; Follow, Mute and Leave; the Threads
// page reads the threads I am in from the server, newest reply first, a page at a time, without task threads; a muted thread and a task's thread never light the Threads row; and the
// notices a reply, a mention and a direct message become, with a mention in a task's thread making that person a follower of the task. All against the frozen contract.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { notify, planNotice } from "../handlers/notify.ts";
import { DANA, LEO, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = (): string => `f${++n}`;
type ListRow = { threadId: string; unread?: number; following?: boolean; muted?: boolean; repliers?: { id: string }[]; parentTitle?: string; preview?: string; replyCount?: number };

async function list(ctx: Harness["ctx"], input: Record<string, unknown>): Promise<{ threads: ListRow[]; next?: string; total: number }> {
  assert.deepEqual(contractErrors("threads.list", "in", input), [], "threads.list input");
  const out = await h["threads.list"]!(ctx, input);
  assert.deepEqual(contractErrors("threads.list", "out", out), [], "threads.list output");
  return out;
}
const mine = (ctx: Harness["ctx"], more: Record<string, unknown> = {}) => list(ctx, { kind: ["thread"], mine: true, order: "latest", exceptScope: ["task"], ...more });
async function follow(ctx: Harness["ctx"], threadId: string, mode: string): Promise<{ mode: string }> {
  const input = { threadId, mode };
  assert.deepEqual(contractErrors("threads.follow", "in", input), []);
  const out = await h["threads.follow"]!(ctx, input);
  assert.deepEqual(contractErrors("threads.follow", "out", out), []);
  return out;
}
const threadsUnread = async (ctx: Harness["ctx"]): Promise<number> => (await h["chat.recent"]!(ctx, {})).threadsUnread as number;
const repliedTo = (hn: Harness): string[] => hn.named("thread.replied").map((e) => String(e.payload["personId"])).sort();

/** #intake, a message of Dana's in it, and the thread Maya opens under it. */
async function world() {
  const hn = harness();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", idempotencyKey: key() })).channel;
  const main = ch.mainThreadId as string;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: main, body: "Who takes the Rivera intake?", idempotencyKey: key() })).message.messageId as string;
  const thread = (await h["chat.thread"]!(hn.person(MAYA), { threadId: main, messageId: said, idempotencyKey: key() })).thread.threadId as string;
  return { hn, main, said, thread };
}

test("the person who wrote the message follows its thread; a reply and a mention put people in it, and every reply reaches the others", async () => {
  const { hn, thread } = await world();
  assert.deepEqual((await mine(hn.ctx)).threads.map((t) => t.threadId), [thread], "Dana wrote the message: its thread is on her Threads page before anyone replies");
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "I can, @Leo can you back me up?", mentions: [{ kind: "person", id: LEO }], idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [DANA], "the reply reaches Dana; Leo hears the mention instead");
  assert.deepEqual(hn.named("message.mentioned").map((e) => e.payload["personId"]), [LEO]);
  assert.deepEqual((await mine(hn.person(LEO))).threads.map((t) => t.threadId), [thread], "a mention puts Leo in the thread");
  hn.clear();
  await h["chat.post"]!(hn.person(LEO), { threadId: thread, body: "Yes", idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [DANA, MAYA], "Leo's reply reaches everyone else in it");
  assert.equal(await threadsUnread(hn.ctx), 2, "two replies are new for Dana");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("Mute keeps a person in the thread but quiet; Leave takes them out until they reply again; Follow brings anyone in", async () => {
  const { hn, thread } = await world();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "first", idempotencyKey: key() });
  assert.equal(await threadsUnread(hn.ctx), 1);
  assert.deepEqual(await follow(hn.ctx, thread, "mute"), { mode: "mute" });
  assert.equal(await threadsUnread(hn.ctx), 0, "a muted thread does not count");
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "second", idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [], "a muted thread's replies reach nobody who muted it");
  const row = (await mine(hn.ctx)).threads[0]!;
  assert.equal(row.muted, true); assert.equal(row.following, false); assert.equal(row.unread, 0);

  assert.deepEqual(await follow(hn.ctx, thread, "leave"), { mode: "none" });
  assert.deepEqual((await mine(hn.ctx)).threads, [], "left: not on Dana's Threads page");
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "third", idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [], "she wrote the message above it, and still hears nothing once she left");
  await h["chat.post"]!(hn.ctx, { threadId: thread, body: "back again", idempotencyKey: key() });
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "fourth", idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [DANA], "replying brings her back in");

  assert.deepEqual(await follow(hn.person(LEO), thread, "follow"), { mode: "follow" });
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "fifth", idempotencyKey: key() });
  assert.deepEqual(repliedTo(hn), [DANA, LEO], "Follow puts Leo in without a word from him");
  let code = "none";
  try { await h["threads.follow"]!(hn.ctx, { threadId: (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId, mode: "mute" }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "validation.bad_input", "a chat is not followed; it is left from its own menu");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("the Threads page: the threads I am in from the server, newest reply first, a page at a time, with what is new, who wrote, where and the newest line; task threads stay with their tasks", async () => {
  const { hn, main, thread } = await world();
  const said2 = (await h["chat.post"]!(hn.ctx, { threadId: main, body: "And the Lee file?", idempotencyKey: key() })).message.messageId as string;
  const second = (await h["chat.thread"]!(hn.person(MAYA), { threadId: main, messageId: said2, idempotencyKey: key() })).thread.threadId as string;
  hn.advance(1000);
  await h["chat.post"]!(hn.person(MAYA), { threadId: second, body: "Lee is mine", idempotencyKey: key() });
  hn.advance(1000);
  await h["chat.post"]!(hn.person(LEO), { threadId: thread, body: "Rivera is with me now\nmore below", idempotencyKey: key() });
  hn.advance(1000);
  // a task's thread Dana sits in, with a status line from Maya: it belongs to the task
  const task = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], scopeType: "task", scopeId: "tsk_rivera", title: "Call Rivera", idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.person(MAYA), { threadId: task, body: "Submitted for review", idempotencyKey: key() });

  const all = await mine(hn.ctx);
  assert.deepEqual(all.threads.map((t) => t.threadId), [thread, second], "newest reply first, and no task thread");
  const top = all.threads[0]!;
  assert.equal(top.unread, 1); assert.equal(top.following, true); assert.equal(top.parentTitle, "#intake");
  assert.equal(top.preview, "Rivera is with me now", "the newest line, its first line only");
  assert.deepEqual(top.repliers!.map((r) => r.id), [LEO], "who wrote in it, newest first");
  const page1 = await mine(hn.ctx, { limit: 1 });
  assert.deepEqual([page1.threads.map((t) => t.threadId), page1.next, page1.total], [[thread], thread, 2]);
  const page2 = await mine(hn.ctx, { limit: 1, cursor: page1.next });
  assert.deepEqual([page2.threads.map((t) => t.threadId), page2.next], [[second], undefined]);
  assert.equal(await threadsUnread(hn.ctx), 2, "the task's status line does not light the Threads row");
  assert.deepEqual((await list(hn.ctx, { kind: ["thread"], mine: true })).threads.map((t) => t.threadId).sort(), [second, task, thread].sort(), "asked without the filter, the task thread is there");
  // the line under a message reads the same rows by parent
  const under = await list(hn.ctx, { parentThreadId: main, kind: ["thread"] });
  assert.deepEqual(under.threads.map((t) => [t.threadId, t.replyCount]).sort(), [[second, 1], [thread, 1]].sort());
});

test("chat.notify: a reply, a mention and a direct message become notices with who, where and the first line; a private chat's words stay in it; a mention in a task's thread follows the task", async () => {
  const sent: Record<string, unknown>[] = [];
  const followed: Record<string, unknown>[] = [];
  const names: Record<string, string> = { [DANA]: "Dana Reyes", [MAYA]: "Maya Chen", [LEO]: "Leo Park" };
  const hn = harness({
    calls: {
      "notifications.send": (i) => { sent.push(i); return { outcome: "interrupt", notificationId: `ntf_${sent.length}` }; },
      "access.principals.get": (i) => ({ principal: { name: names[String((i["principal"] as { id: string }).id)] } }),
      "tasks.followers.add": (i) => { followed.push(i); return { task: {} }; },
    },
  });
  const svc = hn.as({ kind: "service", id: "svc_host" });
  const run = async (): Promise<void> => { for (const e of hn.emitted.filter((x) => ["message.mentioned", "message.direct", "thread.replied"].includes(x.name))) await notify(svc, e); hn.clear(); };
  const ch = (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", idempotencyKey: key() })).channel;
  const said = (await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "Who takes Rivera?", idempotencyKey: key() })).message.messageId as string;
  const thread = (await h["chat.thread"]!(hn.person(MAYA), { threadId: ch.mainThreadId, messageId: said, idempotencyKey: key() })).thread.threadId as string;
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: thread, body: "I will.\nCalling at 3", mentions: [{ kind: "person", id: LEO }], idempotencyKey: key() });
  await run();
  assert.deepEqual(sent.map((s) => [s["to"], s["kind"], (s["data"] as Record<string, unknown>)["from"], (s["data"] as Record<string, unknown>)["where"], s["body"]]), [
    [LEO, "mention", "Maya Chen", "#intake", "I will."],
    [DANA, "reply.thread", "Maya Chen", "#intake", "I will."],
  ]);
  const reply = sent[1]!;
  assert.deepEqual([reply["subject"], reply["collapseKey"], (reply["data"] as Record<string, unknown>)["fromId"], (reply["data"] as Record<string, unknown>)["threadId"]], [{ type: "thread", id: thread }, `reply.thread:${thread}`, MAYA, thread], "one row per thread, so a burst collapses; muting Maya or the thread silences it");
  for (const s of sent) assert.deepEqual(contractErrors("notifications.send", "in", s), [], "what notifications.send takes");

  sent.length = 0;
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  hn.clear();
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "The fee is 5000", idempotencyKey: key() });
  await run();
  assert.deepEqual(sent.map((s) => [s["to"], s["kind"], (s["data"] as Record<string, unknown>)["from"], "body" in s]), [[MAYA, "dm", "Dana Reyes", false]], "a direct message, without its words");

  sent.length = 0;
  const task = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], scopeType: "task", scopeId: "tsk_rivera", title: "Call Rivera", idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: task, body: "Started", idempotencyKey: key() });
  hn.clear();
  await h["chat.post"]!(hn.person(MAYA), { threadId: task, body: "@Leo have a look", mentions: [{ kind: "person", id: LEO }], idempotencyKey: key() });
  await run();
  assert.deepEqual(followed, [{ taskId: "tsk_rivera", follower: LEO }], "Leo now follows the task");
  assert.deepEqual(sent.map((s) => [s["to"], s["kind"], (s["data"] as Record<string, unknown>)["where"]]), [[LEO, "mention", "Call Rivera"]], "the mention is told; the task's own status lines are not replies to tell Dana about");
  assert.equal(await planNotice(svc, { name: "thread.replied", payload: { threadId: thread, messageId: said, personId: DANA } }), undefined, "nobody hears about their own message");
});
