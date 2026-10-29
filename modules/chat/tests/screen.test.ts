// Screen context on chat.post and chat.screen.get: a person's message carries where they were; only they read it back; an agent's post carries none; a value that is not a screen is dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { INTAKE, MAYA, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const say = (ctx: Harness["ctx"], threadId: string, body: string, extra: Record<string, unknown> = {}) => h["chat.post"]!(ctx, { threadId, body, idempotencyKey: `p${++n}`, ...extra });
const privateChat = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `s${++n}` })).thread.threadId as string;
const SCREEN = { place: "records", title: "Contacts", open: [{ type: "record", id: "rec_a1", title: "Maya Chen" }], rows: { shown: 25, total: 137 }, actions: ["records.update"] };

test("the screen sent with a message is read back for that message, and the newest one when no message is named", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  const first = await say(hn.ctx, t, "how many?", { screen: SCREEN });
  const second = await say(hn.ctx, t, "and now?", { screen: { place: "files", title: "Policies" } });
  const one = await h["chat.screen.get"]!(hn.ctx, { threadId: t, messageId: first.message.messageId });
  assert.deepEqual(one.screen, SCREEN);
  assert.equal(one.messageId, first.message.messageId);
  const latest = await h["chat.screen.get"]!(hn.ctx, { threadId: t });
  assert.equal(latest.screen.place, "files");
  assert.equal(latest.messageId, second.message.messageId);
});

test("a message sent without a screen has none, and so does a value that is not a screen context", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  const plain = await say(hn.ctx, t, "hello");
  const bad = await say(hn.ctx, t, "again", { screen: { title: "no place" } });
  assert.deepEqual(await h["chat.screen.get"]!(hn.ctx, { threadId: t, messageId: plain.message.messageId }), { screen: null });
  assert.deepEqual(await h["chat.screen.get"]!(hn.ctx, { threadId: t, messageId: bad.message.messageId }), { screen: null });
});

test("what is kept is the parsed shape only: unknown keys and content do not survive", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  const m = await say(hn.ctx, t, "look", { screen: { ...SCREEN, secretBody: "the whole contract text", open: [{ type: "record", id: "rec_a1", title: "Maya Chen", content: "private" }] } });
  const got = await h["chat.screen.get"]!(hn.ctx, { threadId: t, messageId: m.message.messageId });
  assert.ok(!JSON.stringify(got).includes("whole contract text") && !JSON.stringify(got).includes("private"));
});

test("an agent's post stores no screen, and a person reads only their own screens in a channel", async () => {
  const hn = harness();
  const c = (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: `c${++n}` })).channel;
  const mine = await say(hn.ctx, c.mainThreadId, "from my screen", { screen: SCREEN });
  const agent = await say(hn.agent(INTAKE), c.mainThreadId, "I looked", { screen: SCREEN });
  assert.deepEqual(await h["chat.screen.get"]!(hn.agent(INTAKE), { threadId: c.mainThreadId, messageId: agent.message.messageId }), { screen: null });
  assert.equal((await h["chat.screen.get"]!(hn.ctx, { threadId: c.mainThreadId, messageId: mine.message.messageId })).screen.place, "records");
  assert.deepEqual(await h["chat.screen.get"]!(hn.person(MAYA), { threadId: c.mainThreadId, messageId: mine.message.messageId }), { screen: null }, "Maya does not read Dana's screen");
});

test("a chat the caller cannot see answers not found", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  assert.equal(await failure(() => h["chat.screen.get"]!(hn.person(MAYA), { threadId: t })), "validation.not_found");
});

test("erasing a chat erases its screens", async () => {
  const hn = harness({ calls: { "files.resolve": () => { throw Object.assign(new Error("gone"), { error: { code: "validation.not_found" } }); } } });
  const t = await privateChat(hn);
  await say(hn.ctx, t, "look", { screen: SCREEN });
  const before = (hn.ctx.db.all("SELECT COUNT(*) AS n FROM chat_screen WHERE thread = ?", t) as Array<{ n: number }>)[0]!.n;
  assert.equal(before, 1);
  await h["threads.erase"]!(hn.ctx, { threadId: t, idempotencyKey: `e${++n}` });
  assert.equal((hn.ctx.db.all("SELECT COUNT(*) AS n FROM chat_screen WHERE thread = ?", t) as Array<{ n: number }>)[0]!.n, 0);
});
