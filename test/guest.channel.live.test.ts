// A guest of one channel (lane f-guest, 13 Nov 2026): invited from inside the channel with threads.invite_guest, joined through members.accept, then using the channel as themselves. The rule: a guest sees exactly the
// channels they were added to and can open, read, and (at reply level) post in each of them; nothing in their list leads to a refusal; no other channel opens. A booted daemon, the real chat, members and access modules.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./guest-channel-kit.ts";

for (const kind of ["public", "invite"] as const) for (const level of ["reply", "view"] as const) {
  test(`a ${level} guest of a ${kind} channel lists, opens and reads it, posts only at reply level, and cannot open any other channel`, async () => {
    const w = await world();
    try {
      const c = kind === "public" ? w.pub : w.priv;
      const g = await w.invite(c, level, `${kind}-${level}@example.com`, `${kind}${level}`);
      const listed = ((await g.call("channels.list")).data.channels as { name: string }[]).map((x) => x.name);
      assert.deepEqual(listed, [kind === "public" ? "partners" : "deal-room"], "the guest lists exactly the channel they were added to");
      // the list and the open agree: what is listed opens
      const open = await g.call("threads.get", { threadId: c.mainThreadId });
      assert.equal(open.status, 200, `threads.get on the listed channel: ${JSON.stringify(open.data)}`);
      const history = await g.call("chat.messages.list", { threadId: c.mainThreadId });
      assert.equal(history.status, 200, `history: ${JSON.stringify(history.data)}`);
      assert.ok((history.data.messages as { body?: string }[]).some((m) => /Welcome/.test(m.body ?? "")), "the guest reads what was said before they came");
      // no other channel opens, and nothing else is listed
      for (const other of [w.other, kind === "public" ? w.priv : w.pub]) {
        assert.equal((await g.call("threads.get", { threadId: other.mainThreadId })).status, 403, "another channel does not open");
        assert.equal((await g.call("chat.messages.list", { threadId: other.mainThreadId })).status, 403, "or read");
      }
      // names: the guest's directory holds themselves and who is in their channel, and nobody else (not the owner's other agents, not people of other channels)
      const dir = await g.call("access.principals.list");
      assert.equal(dir.status, 200, `a guest reads their directory: ${JSON.stringify(dir.data)}`);
      const ids = (dir.data.principals as { id: string; name: string }[]).map((x) => x.id);
      assert.ok(ids.includes(g.personId) && ids.includes(w.agent), "themselves and the channel's agent are named");
      assert.ok(!ids.includes(w.otherAgent), "an agent that is in no channel of theirs is not listed");
      const post = await g.call("chat.post", { threadId: c.mainThreadId, body: "Hello from the guest" });
      const threaded = await g.call("chat.thread", { threadId: c.mainThreadId, messageId: kind === "public" ? w.first.pub : w.first.priv });
      if (level === "reply") {
        assert.equal(post.status, 200, `a reply guest posts: ${JSON.stringify(post.data)}`);
        assert.equal(threaded.status, 200, `and opens a thread: ${JSON.stringify(threaded.data)}`);
        const mention = await g.call("chat.post", { threadId: c.mainThreadId, body: "@Dex hello", mentions: [{ kind: "agent", id: w.agent }] });
        assert.equal(mention.status, 200, `and mentions the channel's agent: ${JSON.stringify(mention.data)}`);
      } else {
        assert.equal(post.status, 403, "a view guest does not post");
        assert.equal(threaded.status === 200, false, "or open a thread");
      }
      // the guest's own message is in the channel for everyone
      if (level === "reply") {
        const seen = (await w.o("chat.messages.list", { threadId: c.mainThreadId })).messages as { body?: string }[];
        assert.ok(seen.some((m) => m.body === "Hello from the guest"));
      }
    } finally { await w.stop(); }
  });
}
