// A guest whose grant is gone reaches nothing (lane f-guest, 14 Nov 2026). A reply guest owns the reply threads they open; owning one is not a way back in. After the owner removes the guest's access (access.unshare, the
// door the Console's Remove this access uses), every read and every write on the channel and on the reply thread is refused, and what the channel says there afterwards cannot be read by any door.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./guest-channel-kit.ts";

for (const kind of ["public", "invite"] as const) {
  test(`a reply guest of a ${kind} channel whose access is removed reads and writes nothing, in the channel or in the reply thread they opened`, async () => {
    const w = await world();
    try {
      const c = kind === "public" ? w.pub : w.priv, first = kind === "public" ? w.first.pub : w.first.priv;
      const g = await w.invite(c, "reply", `revoke-${kind}@example.com`, `revoke${kind}`);
      const reply = (await g.call("chat.thread", { threadId: c.mainThreadId, messageId: first })).data.thread.threadId as string;
      assert.equal((await g.call("chat.post", { threadId: reply, body: "before" })).status, 200, "while the access lasts they post in it");
      assert.equal((await g.call("threads.get", { threadId: reply })).status, 200);
      // the owner takes the access away
      await w.o("access.unshare", { subject: { kind: "person", id: g.personId }, resource: { type: "channel", id: c.channelId } });
      await w.o("chat.post", { threadId: reply, body: "AFTERWARDS-SECRET after the guest was removed" });
      await w.o("chat.post", { threadId: c.mainThreadId, body: "AFTERWARDS-SECRET in the channel too" });
      const mine = { threadId: reply };
      const refused: Array<[string, Record<string, unknown>]> = [
        ["threads.get", mine], ["chat.messages.list", mine], ["chat.message.get", { ...mine, messageId: first }], ["chat.history.page", { ...mine, before: 1000 }], ["chat.pins.list", mine], ["chat.catch_up", mine],
        ["threads.mark_read", mine], ["threads.follow", { ...mine, mode: "follow" }], ["chat.post", { ...mine, body: "still here?" }], ["chat.react", { ...mine, messageId: first, emoji: "+1" }], ["chat.thread", { ...mine, messageId: first }],
        ["threads.update", { ...mine, title: "renamed" }], ["threads.members.add", { ...mine, personId: w.maya.personId }], ["engine.stop_all", mine], ["chat.helper.start", { ...mine, title: "t", instruction: "i", agentId: w.agent }],
        ["threads.get", { threadId: c.mainThreadId }], ["chat.messages.list", { threadId: c.mainThreadId }], ["chat.post", { threadId: c.mainThreadId, body: "x" }], ["channels.get", { channelId: c.channelId }],
        ["chat.history.search", { q: "AFTERWARDS-SECRET" }],
      ];
      for (const [cap, input] of refused) {
        const r = await g.call(cap, input);
        assert.equal(r.status, 403, `${cap} after the access was removed: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
        assert.ok(!JSON.stringify(r.data).includes("AFTERWARDS-SECRET"), `${cap} leaks nothing`);
      }
      // the lists no longer show the channel or its words
      const listed = JSON.stringify((await g.call("channels.list")).data);
      assert.ok(!listed.includes(c.channelId), "the channel is gone from their list");
      const recent = JSON.stringify((await g.call("chat.recent")).data);
      assert.ok(!recent.includes(c.mainThreadId) && !recent.includes(reply) && !recent.includes("AFTERWARDS-SECRET"), "and from their recent chats");
    } finally { await w.stop(); }
  });
}
