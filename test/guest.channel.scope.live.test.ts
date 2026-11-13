// What a grant on a channel reaches, and what it does not (lane f-guest, 13 Nov 2026). A guest invited to a channel holds a grant on the CHANNEL; the rule is that it reaches the channel's own chat (its main thread)
// and the reply threads under messages in it, at the grant's level (view reads, reply reads and posts), and nothing else. Every other thread that can hang off or sit beside a channel stays out of reach:
// another channel and its replies, a one-to-one, an Ask pane about the channel, an aside, an agent's own chat, a teammate's handoff thread. A booted daemon, the real chat, members and access modules.
import test from "node:test";
import assert from "node:assert/strict";
import { hostLog } from "./memory-live-kit.ts";
import { world } from "./guest-channel-kit.ts";

type W = Awaited<ReturnType<typeof world>>;
type G = Awaited<ReturnType<W["invite"]>>;

const stays = async (g: G, id: string, why: string): Promise<void> => {
  for (const cap of ["threads.get", "chat.messages.list"]) assert.equal((await g.call(cap, { threadId: id })).status, 403, `${why}: ${cap} is refused`);
  assert.equal((await g.call("chat.post", { threadId: id, body: "let me in" })).status, 403, `${why}: chat.post is refused`);
};

for (const kind of ["public", "invite"] as const) {
  test(`a reply guest of a ${kind} channel reads and posts in the channel's reply threads, and reaches nothing else that hangs off or sits beside the channel`, async () => {
    const w = await world();
    try {
      const c = kind === "public" ? w.pub : w.priv, m1 = kind === "public" ? w.first.pub : w.first.priv;
      const g = await w.invite(c, "reply", `scope-${kind}@example.com`, `scope${kind}`);
      // a reply thread opened by the owner under a message in the channel, with a line in it, and a reply under that line
      const r1 = (await w.o("chat.thread", { threadId: c.mainThreadId, messageId: m1 })).thread.threadId as string;
      const line = await w.say({ mainThreadId: r1 }, "A side thread.");
      const r2 = (await w.o("chat.thread", { threadId: r1, messageId: line })).thread.threadId as string;
      for (const id of [r1, r2]) {
        assert.equal((await g.call("threads.get", { threadId: id })).status, 200, `the guest opens the reply thread ${id}`);
        const read = await g.call("chat.messages.list", { threadId: id });
        assert.equal(read.status, 200, `and reads it: ${JSON.stringify(read.data)}`);
        const said = await g.call("chat.post", { threadId: id, body: `guest in ${id}` });
        assert.equal(said.status, 200, `and posts in it at reply level: ${JSON.stringify(said.data)}`);
      }
      assert.ok(((await w.o("chat.messages.list", { threadId: r1 })).messages as { body?: string }[]).some((x) => x.body === `guest in ${r1}`), "what the guest posted in the reply thread is there for the owner");
      // the guest can open a reply thread of their own under a message
      assert.equal((await g.call("chat.thread", { threadId: c.mainThreadId, messageId: m1 })).status, 200, "and open the thread under a message");

      // ---- everything else stays out of reach
      // another channel, and a reply thread inside it
      const otherMsg = await w.say(w.other, "Internal again.");
      const otherReply = (await w.o("chat.thread", { threadId: w.other.mainThreadId, messageId: otherMsg })).thread.threadId as string;
      await stays(g, w.other.mainThreadId, "another channel");
      await stays(g, otherReply, "a reply thread in another channel");
      await stays(g, (kind === "public" ? w.priv : w.pub).mainThreadId, "the guest's other kind of channel");
      // a one-to-one between two members, and an agent's own chat of the owner
      const dm = (await w.o("chat.start", { kind: "chat", agentIds: [], personId: w.maya.personId, first: "Between us." })).thread.threadId as string;
      await stays(g, dm, "a member's one-to-one");
      const agentChat = (await w.o("chat.start", { kind: "chat", agentIds: [w.agent], first: "Private with Dex." })).thread.threadId as string;
      await stays(g, agentChat, "an agent's own chat with the owner");
      // an Ask pane about this very channel (a person's private Assistant thread inside it)
      const ask = (await w.o("chat.start", { kind: "ask", agentIds: [w.agent], scopeType: "channel", scopeId: c.channelId, first: "What is going on in here?" })).thread.threadId as string;
      await stays(g, ask, "an Ask pane about the channel");
      // an aside from the channel's chat
      const aside = await w.o("chat.aside", { threadId: c.mainThreadId, question: "A side question", idempotencyKey: `aside-${kind}` });
      await stays(g, aside.asideThreadId as string, "an aside asked in the channel");
      // a teammate's thread handed to another agent from the channel
      const handoff = await w.o("chat.handoff", { threadId: c.mainThreadId, toAgentId: w.otherAgent, note: "Please take the books side." });
      await stays(g, handoff.thread.threadId as string, "a handoff thread started from the channel");
      // a helper started from the channel
      const helper = await w.o("chat.helper.start", { threadId: c.mainThreadId, title: "Look it up", instruction: "Find the answer.", agentId: w.agent });
      await stays(g, helper.helper.threadId as string, "a helper started from the channel");
    } catch (e) { console.log("HOSTLOG", hostLog(w.d).split("\n").filter((l) => /error|Error|fail|500/.test(l)).slice(-12).join("\n")); throw e; } finally { await w.stop(); }
  });
}

test("a view guest reads the channel's reply threads and posts nowhere; nothing is added by reading", async () => {
  const w = await world();
  try {
    const g = await w.invite(w.pub, "view", "scope-view@example.com", "scopeview");
    const r1 = (await w.o("chat.thread", { threadId: w.pub.mainThreadId, messageId: w.first.pub })).thread.threadId as string;
    await w.o("chat.post", { threadId: r1, body: "A side thread." });
    assert.equal((await g.call("threads.get", { threadId: r1 })).status, 200, "reads the reply thread");
    assert.equal((await g.call("chat.messages.list", { threadId: r1 })).status, 200, "and its lines");
    assert.equal((await g.call("chat.post", { threadId: r1, body: "no" })).status, 403, "posts in it: refused at view level");
    assert.equal((await g.call("chat.post", { threadId: w.pub.mainThreadId, body: "no" })).status, 403, "and in the channel");
    const fresh = await w.say(w.pub, "A new line.");
    assert.equal((await g.call("chat.thread", { threadId: w.pub.mainThreadId, messageId: fresh })).status, 403, "or opens a thread of their own under a message");
  } finally { await w.stop(); }
});

test("a guest's directory and search: only themselves and the people and agents of their channel; nothing said outside their channels", async () => {
  const w = await world();
  try {
    const g = await w.invite(w.pub, "reply", "scope-dir@example.com", "scopedir");
    await w.o("chat.post", { threadId: w.other.mainThreadId, body: "the zebra budget is confidential" });
    await w.o("chat.post", { threadId: w.pub.mainThreadId, body: "the zebra launch is public to partners" });
    const dir = await g.call("access.principals.list");
    assert.equal(dir.status, 200, JSON.stringify(dir.data));
    const ids = (dir.data.principals as { id: string }[]).map((x) => x.id);
    assert.ok(ids.includes(g.personId) && ids.includes(w.agent), "the guest and the agent of the channel are named");
    assert.equal(ids.length, 3, `and the channel's one other person (the owner), nobody else: ${ids.join(",")}`);
    assert.ok(!ids.includes(w.maya.personId) && !ids.includes(w.otherAgent), "not Maya (in another channel) and not an agent that is in no channel of theirs");
    assert.equal((await g.call("access.principals.list", { q: "maya" })).data.principals.length, 0, "a search of the directory for a person of another channel finds no one");
    const found = await g.call("chat.history.search", { query: "zebra" });
    if (found.status === 200) {
      const bodies = JSON.stringify(found.data);
      assert.ok(!/confidential/.test(bodies), `search returns nothing said outside the guest's channels: ${bodies.slice(0, 300)}`);
    } else assert.equal(found.status, 403, "or search is refused");
    assert.equal((await g.call("settings.public_of", { personId: w.maya.personId })).status, 403, "a person's settings beyond what a guest may see");
  } finally { await w.stop(); }
});
