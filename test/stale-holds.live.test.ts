// The hourly clean-up of old holds (gate.stale_holds) on a booted daemon. It may drop a hold whose chat is really closed or deleted, and must leave every other hold alone: a send held a moment ago in
// a person's private chat with an agent is an open question, and the job runs as the host's system principal, which cannot read a private chat.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as mk from "./memory-live-kit.ts";

type Hold = { id: string; state: string };

async function boot(): Promise<{ d: mk.Daemon; dir: string; agentId: string; mailboxId: string }> {
  const dir = mk.seededDir();
  const d = await mk.boot(dir);
  await mk.connect(d);
  const agent = await mk.newAgent(d, "Digester");
  const box = (
    await mk.call(d, "mail.mailbox.create", {
      kind: "shared",
      address: "hello@acme.test",
      title: "Hello",
      privacy: "space",
      idempotencyKey: "sh-mailbox",
    })
  ).data.mailbox;
  return { d, dir, agentId: agent.id, mailboxId: box.id as string };
}

const holds = async (d: mk.Daemon): Promise<Hold[]> =>
  ((await mk.call(d, "gate.holds.list", {})).data.holds as Hold[]) ?? [];

/** A message that makes the agent try a send, then wait until a hold exists for it. */
async function holdSend(
  d: mk.Daemon,
  threadId: string,
  agentId: string,
  mailboxId: string,
  key: string,
): Promise<string> {
  const before = new Set((await holds(d)).map((h) => h.id));
  const send = {
    mailboxId,
    to: [{ address: "dana@fox.test", name: "Dana Fox" }],
    subject: `Digest ${key}`,
    text: "The digest.",
    idempotencyKey: `${key}-send`,
  };
  const posted = await mk.call(d, "chat.post", {
    threadId,
    body: `TOOL mail_send ${JSON.stringify(send)}`,
    mentions: [{ kind: "agent", id: agentId }],
    idempotencyKey: `${key}-post`,
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  return (
    await mk.waitFor(
      async () => {
        await d.hooks?.pump?.();
        return (await holds(d)).find((h) => !before.has(h.id)) ?? null;
      },
      40_000,
      () => mk.hostLog(d),
    )
  ).id;
}

/** The state of one hold, by its id. */
const stateOf = async (d: mk.Daemon, holdId: string): Promise<string | undefined> =>
  (await holds(d)).find((h) => h.id === holdId)?.state;

test("a send held in a person's private chat with an agent is still waiting after the stale-hold job", async () => {
  const { d, dir, agentId, mailboxId } = await boot();
  try {
    const threadId = (await mk.call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sh-a" }))
      .data.thread.threadId as string;
    await mk.call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "sh-a-mode" });
    const hold = await holdSend(d, threadId, agentId, mailboxId, "sh-a");
    assert.equal(await stateOf(d, hold), "held");
    await d.hooks!.runPeriodic("gate.stale_holds");
    assert.equal(await stateOf(d, hold), "held", "the chat is open: the hold is an open question");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a hold whose chat was deleted is cleaned up; a hold in a chat still open next to it stays", async () => {
  const { d, dir, agentId, mailboxId } = await boot();
  try {
    const start = async (k: string): Promise<string> => {
      const t = (await mk.call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: k })).data.thread
        .threadId as string;
      await mk.call(d, "threads.set_mode", { threadId: t, mode: "auto", idempotencyKey: `${k}-mode` });
      return t;
    };
    const gone = await start("sh-b1");
    const open = await start("sh-b2");
    const holdGone = await holdSend(d, gone, agentId, mailboxId, "sh-b1");
    const holdOpen = await holdSend(d, open, agentId, mailboxId, "sh-b2");
    const del = await mk.call(d, "threads.delete", { threadId: gone, idempotencyKey: "sh-b-del" });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    await d.hooks!.runPeriodic("gate.stale_holds");
    assert.equal(await stateOf(d, holdGone), "denied", "a deleted chat ends its asks");
    assert.equal(await stateOf(d, holdOpen), "held");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a hold whose chat was closed is cleaned up", async () => {
  const { d, dir, agentId, mailboxId } = await boot();
  try {
    const threadId = (await mk.call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sh-c" }))
      .data.thread.threadId as string;
    await mk.call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "sh-c-mode" });
    const hold = await holdSend(d, threadId, agentId, mailboxId, "sh-c");
    const closed = await mk.call(d, "threads.close", { threadId, idempotencyKey: "sh-c-close" });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    await d.hooks!.runPeriodic("gate.stale_holds");
    assert.equal(await stateOf(d, hold), "denied");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a hold in a channel the system can read stays after the stale-hold job", async () => {
  const { d, dir, agentId, mailboxId } = await boot();
  try {
    const ch = await mk.call(d, "channels.create", {
      name: "launch",
      visibility: "public",
      agentIds: [agentId],
      idempotencyKey: "sh-d-ch",
    });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;
    const hold = await holdSend(d, threadId, agentId, mailboxId, "sh-d");
    await d.hooks!.runPeriodic("gate.stale_holds");
    assert.equal(await stateOf(d, hold), "held");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
