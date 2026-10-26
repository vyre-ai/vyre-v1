// What a person owns in chat, for the removal wizard and the Space tile (P-L7_21): channels they made, private chats only they are in, and their unread count. Real SQLite through the chat harness.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { hostCalls } from "../impl.ts";
import { DANA, INTAKE, LEO, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = (): string => `own${++n}`;

async function world() {
  const hn = harness();
  const channel = (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key() })).channel;
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], title: "Ideas", idempotencyKey: key() })).thread.threadId as string;
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  return { hn, channel, solo, dm };
}

test("owned_by lists the channels the person made and the chats only they are in, and not a direct message with someone", async () => {
  const { hn, channel, solo, dm } = await world();
  const out = hostCalls["chat.owned_by"](hn.ctx, { person: DANA });
  assert.deepEqual(out.channels.ids, [channel.channelId]);
  assert.equal(out.channels.count, 1);
  assert.deepEqual(out.private_chats.ids, [solo]);
  assert.ok(!out.private_chats.ids.includes(dm), "a chat with another person is theirs together");
  assert.deepEqual(out.private_chats.sample, [{ type: "chat", id: solo, title: "Ideas" }]);
  assert.deepEqual(hostCalls["chat.owned_by"](hn.ctx, { person: LEO }), { channels: { count: 0, sample: [], ids: [] }, private_chats: { count: 0, sample: [], ids: [] } });
});

test("reassigning channels makes the other person its owner; deleting private chats removes them and their messages; retain touches nothing", async () => {
  const { hn, channel, solo } = await world();
  assert.equal(hostCalls["chat.reassign_owned"](hn.ctx, { person: DANA, kind: "channels", action: "retain" }), 0);
  assert.equal(hostCalls["chat.reassign_owned"](hn.ctx, { person: DANA, kind: "channels", action: "reassign", to: MAYA }), 1);
  assert.deepEqual(hostCalls["chat.owned_by"](hn.ctx, { person: DANA }).channels.ids, []);
  assert.deepEqual(hostCalls["chat.owned_by"](hn.ctx, { person: MAYA }).channels.ids, [channel.channelId]);
  const roles = hn.rows(`SELECT principal, role FROM chat_thread_member WHERE thread = ? AND deleted_at IS NULL ORDER BY principal`, channel.mainThreadId);
  assert.equal(roles.find((r) => r["principal"] === MAYA)!["role"], "owner");
  assert.equal(roles.find((r) => r["principal"] === DANA)!["role"], "member");

  await h["chat.post"]!(hn.ctx, { threadId: solo, body: "a private thought", idempotencyKey: key() });
  assert.equal(hostCalls["chat.reassign_owned"](hn.ctx, { person: DANA, kind: "private_chats", action: "retain" }), 0);
  assert.equal(hostCalls["chat.reassign_owned"](hn.ctx, { person: DANA, kind: "private_chats", action: "delete" }), 1);
  assert.deepEqual(hostCalls["chat.owned_by"](hn.ctx, { person: DANA }).private_chats.ids, []);
  assert.equal(hn.rows(`SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL`, solo).length, 0);
});

test("chat.attention is the person's unread across their chats", async () => {
  const { hn, dm } = await world();
  hn.advance(1000);
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "one", idempotencyKey: key() });
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "two", idempotencyKey: key() });
  assert.equal(await hostCalls["chat.attention"](hn.ctx), 2);
  assert.equal(await hostCalls["chat.attention"](hn.person(MAYA)), 0, "what you wrote yourself is not unread");
});
