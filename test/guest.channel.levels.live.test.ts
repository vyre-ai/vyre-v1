// What a guest may do in a channel, on a real daemon (lane f-guest, 13 Nov 2026): the table in kernel/src/authorize/guest-caps.ts as the product answers it. A view guest reads; a reply guest reads and posts, reacts,
// opens a reply thread and edits their own words; everything else a member could do with the same grant is refused in plain words (403, never a 500). The kernel test lists every capability; this one proves the doors.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./guest-channel-kit.ts";

const REFUSED_FOR_BOTH: Array<
  [string, (w: Awaited<ReturnType<typeof world>>, t: string, m: string) => Record<string, unknown>]
> = [
  ["engine.stop_all", (_w, t) => ({ threadId: t })],
  ["engine.stop", (_w, t) => ({ threadId: t })],
  ["engine.set_model", (w, t) => ({ threadId: t, agentId: w.agent, model: "x" })],
  ["engine.compact", (_w, t) => ({ threadId: t })],
  ["engine.live_turns", (_w, t) => ({ threadId: t })],
  ["engine.crew.start", (_w, t) => ({ threadId: t, title: "t", brief: "b" })],
  ["engine.placement.set", (_w, t) => ({ threadId: t, target: "space" })],
  ["chat.helper.start", (w, t) => ({ threadId: t, title: "t", instruction: "i", agentId: w.agent })],
  ["chat.helpers.list", (_w, t) => ({ threadId: t })],
  ["chat.handoff", (w, t) => ({ threadId: t, toAgentId: w.otherAgent, note: "go" })],
  ["chat.aside", (_w, t) => ({ threadId: t, question: "q" })],
  ["chat.make_task", (_w, t, m) => ({ threadId: t, messageId: m })],
  ["chat.share", (w, t, m) => ({ threadId: t, messageId: m, toThreadId: w.other.mainThreadId })],
  ["chat.flow_card", (_w, t) => ({ threadId: t, automationId: "aut_x" })],
  ["chat.pin", (_w, t, m) => ({ threadId: t, messageId: m })],
  ["chat.transcript.get", (_w, t) => ({ threadId: t, turnId: "trn_x" })],
  ["chat.screen.get", (_w, t) => ({ threadId: t })],
  ["threads.update", (_w, t) => ({ threadId: t, title: "renamed" })],
  ["threads.set_mode", (_w, t) => ({ threadId: t, mode: "auto" })],
  ["threads.set_plan_mode", (_w, t) => ({ threadId: t, planMode: true })],
  ["threads.poke", (w, t) => ({ threadId: t, agentId: w.agent })],
  ["threads.archive", (_w, t) => ({ threadId: t })],
  ["threads.delete", (_w, t) => ({ threadId: t })],
  ["threads.members.add", (w, t) => ({ threadId: t, personId: w.maya.personId })],
  ["threads.invite_guest", (_w, t) => ({ threadId: t, email: "x@example.com", level: "reply" })],
  ["threads.agent.configure", (w, t) => ({ threadId: t, agentId: w.agent })],
  ["terminal.request", (_w, t) => ({ threadId: t, command: "ls", why: "look" })],
  ["channels.update", (w, _t) => ({ channelId: w.pub.channelId, name: "renamed" })],
  ["channels.members.add", (w, _t) => ({ channelId: w.pub.channelId, personIds: [w.maya.personId] })],
  ["channels.archive", (w, _t) => ({ channelId: w.pub.channelId })],
];

test("a reply guest and a view guest get what the table says from the daemon, and the rest is refused in plain words", async () => {
  const w = await world();
  try {
    const reply = await w.invite(w.pub, "reply", "lv-reply@example.com", "lvreply");
    const view = await w.invite(w.priv, "view", "lv-view@example.com", "lvview");
    const t = { reply: w.pub.mainThreadId, view: w.priv.mainThreadId },
      m = { reply: w.first.pub, view: w.first.priv };
    const rt = (await w.o("chat.thread", { threadId: t.reply, messageId: m.reply })).thread.threadId as string;
    // reads, for both
    for (const [g, id, msg, who] of [
      [reply, t.reply, m.reply, "reply"],
      [reply, rt, "", "reply (thread)"],
      [view, t.view, m.view, "view"],
    ] as const) {
      for (const [cap, input] of [
        ["threads.get", { threadId: id }],
        ["chat.messages.list", { threadId: id }],
        ["chat.history.page", { threadId: id, before: 1000 }],
        ["chat.pins.list", { threadId: id }],
        ["chat.catch_up", { threadId: id }],
        ["threads.mark_read", { threadId: id }],
      ] as const) {
        const r = await g.call(cap, input);
        assert.equal(r.status, 200, `${who} guest: ${cap} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
      }
      if (msg !== "")
        assert.equal(
          (await g.call("chat.message.get", { threadId: id, messageId: msg })).status,
          200,
          `${who} guest reads one message`,
        );
    }
    assert.equal(
      (await reply.call("threads.follow", { threadId: rt, mode: "follow" })).status,
      200,
      "follows a reply thread",
    );
    // writes a reply guest has
    const posted = await reply.call("chat.post", { threadId: t.reply, body: "from the guest" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const mine = (posted.data.messageId ?? posted.data.message?.messageId ?? posted.data.message?.id) as string;
    assert.equal(
      (await reply.call("chat.react", { threadId: t.reply, messageId: m.reply, emoji: "+1" })).status,
      200,
      "reacts",
    );
    assert.equal(
      (await reply.call("chat.edit", { threadId: t.reply, messageId: mine, body: "from the guest, edited" })).status,
      200,
      "edits their own message",
    );
    assert.equal(
      (await reply.call("chat.edit", { threadId: t.reply, messageId: m.reply, body: "not mine" })).status,
      403,
      "and not someone else's",
    );
    assert.equal(
      (await reply.call("chat.delete_message", { threadId: t.reply, messageId: m.reply })).status,
      403,
      "nor deletes it",
    );
    assert.equal(
      (await reply.call("chat.thread", { threadId: t.reply, messageId: mine })).status,
      200,
      "opens a reply thread",
    );
    // a view guest does not write
    for (const [cap, input] of [
      ["chat.post", { threadId: t.view, body: "no" }],
      ["chat.react", { threadId: t.view, messageId: m.view, emoji: "+1" }],
      ["chat.thread", { threadId: t.view, messageId: m.view }],
    ] as const)
      assert.equal((await view.call(cap, input)).status, 403, `view guest: ${cap}`);
    // what a member could do with the same grant is refused both, in plain words, never a 500
    for (const [who, g, id, msg] of [
      ["reply", reply, t.reply, m.reply],
      ["view", view, t.view, m.view],
    ] as const)
      for (const [cap, mk] of REFUSED_FOR_BOTH) {
        const r = await g.call(cap, mk(w, id, msg));
        assert.equal(r.status, 403, `${who} guest: ${cap} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
        assert.ok(
          typeof r.data?.error?.message === "string" && r.data.error.message !== "",
          `${who} guest: ${cap} refused with a message`,
        );
      }
  } finally {
    await w.stop();
  }
});
