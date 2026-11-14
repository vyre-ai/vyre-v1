// A guest whose grant is gone reaches nothing (lane f-guest, 14 Nov 2026). A reply guest owns the reply threads they open; owning one is not a way back in. After the owner removes the guest's access (access.unshare, the
// door the Console's Remove this access uses), every read and every write on the channel and on the reply thread is refused, and what the channel says there afterwards cannot be read by any door.
import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./member-key-kit.ts";
import { waitFor } from "./memory-live-kit.ts";
import { joinGuest, world } from "./guest-channel-kit.ts";

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

test("the paths that make a guest: an admin's Guest-role invite that names a channel gives the chat AND the access, from the moment they come; chat membership alone gives neither", async () => {
  const w = await world();
  try {
    const roles = (await w.o("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const guestRole = roles.find((r) => r.name === "Guest")!.id;
    const inv = await w.o("members.invites.create", { role: guestRole, email: "role-guest@example.com", channels: [w.pub.channelId] });
    const g = await joinGuest(w.d, inv.link as string, "roleguest");
    await waitFor(async () => ((await api(w.d, g.token, "channels.get", { channelId: w.pub.channelId })).status === 200 ? true : null), 20_000);
    const call = (cap: string, input: Record<string, unknown> = {}) => api(w.d, g.token, cap, { idempotencyKey: `rg-${Math.random()}`, ...input });
    assert.equal((await call("threads.get", { threadId: w.pub.mainThreadId })).status, 200, "the invite gave the access along with the chat");
    const before = JSON.stringify((await call("chat.messages.list", { threadId: w.pub.mainThreadId })).data);
    assert.ok(!before.includes("Welcome to partners"), "and they read from the moment they came, not what was said before");
    assert.equal((await call("chat.post", { threadId: w.pub.mainThreadId, body: "hi" })).status, 403, "at view level: a guest-role invite names no level");
    // a person made a guest and added to a chat by membership alone (the way a guest could be made before): listed nothing, opens nothing, no error line
    const bare = await joinGuest(w.d, ((await w.o("members.invites.create", { role: guestRole, email: "bare@example.com" })).link as string), "bareguest");
    await w.o("channels.members.add", { channelId: w.priv.channelId, personIds: [bare.personId] });
    const callBare = (cap: string, input: Record<string, unknown> = {}) => api(w.d, bare.token, cap, { idempotencyKey: `bg-${Math.random()}`, ...input });
    assert.deepEqual(((await callBare("channels.list")).data.channels as unknown[]).length, 0, "membership alone lists nothing");
    assert.equal((await callBare("threads.get", { threadId: w.priv.mainThreadId })).status, 403, "and opens nothing");
  } finally {
    await w.stop();
  }
});
