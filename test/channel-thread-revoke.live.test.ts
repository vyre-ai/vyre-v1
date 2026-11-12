// Taken out of a channel, a person keeps of its threads exactly what they can still read. A booted daemon with the real chat and access modules. Bob is in a channel, replies under a message there
// (which makes him a member of that inline thread T), and an agent is made in T. Removed from an invite-only channel he cannot open T, cannot see or start a chat with T's agent, and is not listed
// in T. Removed from an open channel he can still read T and holds on its agent exactly what someone who was never in the channel holds.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

async function threadWithAgent(d: Daemon, bob: { token: string; personId: string }, visibility: "invite" | "public", name: string) {
  const ch = (await ok(d, d.token, "channels.create", { name, visibility, memberIds: [bob.personId], agentIds: [] })).channel as { channelId: string; mainThreadId: string };
  const msg = await ok(d, d.token, "chat.post", { threadId: ch.mainThreadId, body: "The filing is due Friday." });
  const messageId = (msg.message?.messageId ?? msg.message?.id) as string;
  const t = (await ok(d, bob.token, "chat.thread", { threadId: ch.mainThreadId, messageId })).thread as { threadId: string };
  await ok(d, bob.token, "chat.post", { threadId: t.threadId, body: "I will draft it." });
  const agentId = (await ok(d, d.token, "threads.agent.create", { threadId: t.threadId, name: `${name} helper` })).agentId as string;
  return { ch, threadId: t.threadId, agentId };
}
const sees = async (d: Daemon, who: { token: string }, agentId: string): Promise<number> => (await api(d, who.token, "access.shares_of", { resource: { type: "agent", id: agentId } })).status;
const reads = async (d: Daemon, who: { token: string }, threadId: string): Promise<number> => (await api(d, who.token, "threads.get", { threadId })).status;
const listed = async (d: Daemon, threadId: string, person: string): Promise<boolean> =>
  ((await ok(d, d.token, "threads.get", { threadId })).thread.members as Array<{ id: string }>).some((m) => m.id === person);

test("removed from an invite-only channel: no thread of it, no agent made in it, not listed; removed from an open channel: what a non-member has", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  try {
    const bob = await join(d, "bob");
    const carol = await join(d, "carol");   // never in either channel

    const legal = await threadWithAgent(d, bob, "invite", "legal");
    assert.equal(await reads(d, bob, legal.threadId), 200, "Bob reads T");
    assert.equal(await sees(d, bob, legal.agentId), 200, "and sees T's agent");
    assert.equal(await listed(d, legal.threadId, bob.personId), true, "and is listed in T");
    await ok(d, d.token, "channels.members.remove", { channelId: legal.ch.channelId, personId: bob.personId });
    assert.notEqual(await reads(d, bob, legal.threadId), 200, "removed: he cannot open T");
    assert.notEqual(await sees(d, bob, legal.agentId), 200, "he cannot see T's agent");
    assert.notEqual((await api(d, bob.token, "chat.start", { kind: "chat", agentIds: [legal.agentId], idempotencyKey: `bob-${Date.now()}` })).status, 200, "nor start a chat with it");
    assert.notEqual((await api(d, carol.token, "chat.start", { kind: "chat", agentIds: [legal.agentId], idempotencyKey: `carol-${Date.now()}` })).status, 200, "as nobody outside the channel can");
    assert.equal(await listed(d, legal.threadId, bob.personId), false, "and he is not listed in T");

    const open = await threadWithAgent(d, bob, "public", "open-room");
    await ok(d, d.token, "channels.members.remove", { channelId: open.ch.channelId, personId: bob.personId });
    assert.equal(await reads(d, bob, open.threadId), await reads(d, carol, open.threadId), "an open channel's thread: Bob reads it as a non-member does");
    assert.equal(await sees(d, bob, open.agentId), await sees(d, carol, open.agentId), "and holds on its agent what a non-member holds");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
