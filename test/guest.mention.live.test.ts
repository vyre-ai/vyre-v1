// A guest who mentions an agent (lane f-guest, 13 Nov 2026, the lead's ruling): no agent turn starts for a guest in v1. A guest has no AI account in the Space and must not spend a member's or steer an agent. The mention is
// delivered as a plain mention to the channel, and the guest sees one quiet line under their message the first time. A member's mention in the same channel still gets its answer.
import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./member-key-kit.ts";
import { connect, hostLog, waitFor } from "./memory-live-kit.ts";
import { world } from "./guest-channel-kit.ts";

type Msg = {
  id?: string;
  messageId?: string;
  author?: { kind?: string; id?: string };
  body?: string;
  blocks?: Array<{ type?: string; data?: { text?: string } }>;
};
const LINE = "Agents answer members of this Space";

test("a guest's mention starts no turn and says so once; a member's mention in the same channel is answered", async () => {
  const w = await world();
  try {
    const g = await w.invite(w.pub, "reply", "mention@example.com", "mentionguest");
    await connect(w.d);
    const thread = w.pub.mainThreadId;
    const list = async (): Promise<Msg[]> => {
      await w.d.hooks?.pump?.();
      return (await w.o("chat.messages.list", { threadId: thread })).messages as Msg[];
    };
    const agentLines = (ms: Msg[]): Msg[] => ms.filter((m) => m.author?.kind === "agent");

    // where an agent's answer lands: the channel, or the thread under the message that asked (agents reply in threads in a channel)
    const answers = async (messageId: string): Promise<number> => {
      await w.d.hooks?.pump?.();
      const under = (await w.o("chat.thread", { threadId: thread, messageId })).thread.threadId as string;
      const ms = [
        ...(await list()),
        ...(((await w.o("chat.messages.list", { threadId: under })).messages as Msg[]) ?? []),
      ];
      return agentLines(ms).filter((m) => (m.body ?? "") !== "").length;
    };
    // a member (the owner) asks: the agent answers, so the harness does run turns and "no turn" below means something
    const out = await w.o("chat.post", {
      threadId: thread,
      body: "@Dex are you there?",
      mentions: [{ kind: "agent", id: w.agent }],
    });
    const askedId = (out.messageId ?? out.message?.messageId ?? out.message?.id) as string;
    await waitFor(
      async () => ((await answers(askedId)) > 0 ? true : null),
      40_000,
      () => hostLog(w.d).slice(0, 1500),
    );

    // the guest asks, twice
    for (const n of [1, 2]) {
      const r = await g.call("chat.post", {
        threadId: thread,
        body: `@Dex what is going on? ${n}`,
        mentions: [{ kind: "agent", id: w.agent }],
      });
      assert.equal(r.status, 200, "the guest's mention is delivered as a plain message");
    }
    for (let i = 0; i < 12; i++) {
      await list();
      await new Promise((x) => setTimeout(x, 500));
    }
    const after = await list();
    const guestMsg = after.find((m) => (m.body ?? "").includes("what is going on? 1"))!;
    // a turn leaves its marks as the agent's own messages (status blocks while it works, then its words): the only agent line anywhere for the guest's messages is the quiet note
    const underGuest = (
      await w.o("chat.thread", { threadId: thread, messageId: guestMsg.id ?? guestMsg.messageId ?? "" })
    ).thread.threadId as string;
    const marks = [
      ...after.slice(after.indexOf(guestMsg)),
      ...(((await w.o("chat.messages.list", { threadId: underGuest })).messages as Msg[]) ?? []),
    ].filter((m) => m.author?.kind === "agent" && !m.blocks?.some((b) => b.data?.text === LINE));
    assert.deepEqual(
      marks,
      [],
      "no agent turn started for the guest: no answer, no status, in the channel or under their message",
    );
    const lines = after.filter((m) => m.blocks?.some((b) => b.data?.text === LINE));
    assert.equal(lines.length, 1, "one quiet line, once, though the guest mentioned twice");
    assert.ok(
      after.some((m) => (m.body ?? "").includes("@Dex what is going on? 2")),
      "both mentions stay in the channel",
    );
  } finally {
    await w.stop();
  }
});

test("a guest changes nobody's roster and starts no turn by any door: an agent outside the channel in a reply thread, a reply, a reaction, a slash command, a quote, a card", async () => {
  const w = await world();
  try {
    await connect(w.d);
    const g = await w.invite(w.pub, "reply", "doors@example.com", "doorsguest");
    const thread = w.pub.mainThreadId;
    const reply = (await g.call("chat.thread", { threadId: thread, messageId: w.first.pub })).data.thread
      .threadId as string;
    const agentsOf = async (id: string): Promise<string[]> =>
      ((await w.o("threads.get", { threadId: id })).thread.agents as Array<{ agentId: string }>)
        .map((a) => a.agentId)
        .sort();
    const before = { reply: await agentsOf(reply), main: await agentsOf(thread) };
    // the agent that is not in the channel, named in the reply thread
    const out = await g.call("chat.post", {
      threadId: reply,
      body: "@Ledger please look",
      mentions: [{ kind: "agent", id: w.otherAgent }],
    });
    assert.equal(out.status, 200, "it is delivered as a plain mention");
    // an agent of the channel answered by reply-to, a reaction, a slash command, text that looks like a mention, a quote
    const mine = (out.data.messageId ?? out.data.message?.messageId ?? out.data.message?.id) as string;
    assert.equal(
      (await g.call("chat.post", { threadId: thread, body: "replying to it", replyTo: mine })).status === 403,
      false,
    );
    assert.equal((await g.call("chat.react", { threadId: reply, messageId: mine, emoji: "+1" })).status, 200);
    assert.equal(
      (await g.call("chat.post", { threadId: thread, body: "/model opus @Dex" })).status,
      200,
      "a slash command is plain text",
    );
    assert.equal((await g.call("chat.post", { threadId: thread, body: "@Dex no chip, just text" })).status, 200);
    assert.equal(
      (
        await g.call("chat.post", {
          threadId: thread,
          body: "> @Dex quoted\nand my words",
          mentions: [{ kind: "agent", id: w.agent }],
        })
      ).status,
      200,
    );
    // a card, or a file, is not for a guest to send
    for (const extra of [
      {
        blocks: [
          {
            type: "from_thread",
            v: 1,
            id: "blk_x",
            data: { threadId: w.other.mainThreadId, messageId: "msg_x" },
            state: "done",
          },
        ],
      },
      { attachments: ["fil_x"] },
    ]) {
      const r = await g.call("chat.post", { threadId: thread, body: "card?", ...extra });
      assert.equal(r.status, 422, `a guest sends plain text: ${JSON.stringify(Object.keys(extra))} -> ${r.status}`);
    }
    for (let i = 0; i < 14; i++) {
      await w.d.hooks?.pump?.();
      await new Promise((x) => setTimeout(x, 400));
    }
    assert.deepEqual(
      await agentsOf(reply),
      before.reply,
      "the reply thread's agents are unchanged: the guest brought nobody in",
    );
    assert.deepEqual(await agentsOf(thread), before.main, "and the channel's too");
    const all = [
      ...((await w.o("chat.messages.list", { threadId: thread })).messages as Msg[]),
      ...((await w.o("chat.messages.list", { threadId: reply })).messages as Msg[]),
    ];
    const marks = all.filter((m) => m.author?.kind === "agent" && !m.blocks?.some((b) => b.data?.text === LINE));
    assert.deepEqual(marks, [], "no agent turn, run or status anywhere: the only agent line is the quiet note");
  } finally {
    await w.stop();
  }
});
