// A message by id is looked up as the person asking: the chat must be theirs and the message not from before their reading floor (r-newchat, 14 Nov 2026). Every capability that takes a message id answers not found for a
// pre-floor message. One lookup (handlers/floor.ts messageAsMe); a class test fails when a handler reaches for a message by `input.<id>` without it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `mf${++n}`;
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { error?: { code?: string } }).error?.code ?? "unknown";
  }
  return "none";
};
const say = async (ctx: Harness["ctx"], threadId: string, body: string, extra: Record<string, unknown> = {}) =>
  (await h["chat.post"]!(ctx, { threadId, body, idempotencyKey: key(), ...extra })).message.messageId as string;

/** Dana's chat: OLD said, then Maya added (floor later), then NEW said. Returns what Maya may and may not name. */
async function world() {
  const hn = harness({
    calls: {
      "engine.set_mode": () => ({ mode: "listen", leadAgentId: null }),
      "memory.remember": () => ({ remembered: true }),
      "tasks.create": () => ({ task: { id: "tsk_1" } }),
    },
  });
  const id = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread
    .threadId as string;
  const old = await say(hn.ctx, id, "OLDSECRET");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(5_000);
  const fresh = await say(hn.ctx, id, "NEWWORD");
  const other = (await h["chat.start"]!(hn.person(MAYA), { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() }))
    .thread.threadId as string;
  return { hn, id, old, fresh, maya: hn.person(MAYA), other };
}

test("share: a pre-floor message cannot be shared into the member's own chat; one she reads can", async () => {
  const { id, old, fresh, maya, other } = await world();
  assert.equal(
    await code(h["chat.share"]!(maya, { threadId: id, messageId: old, toThreadId: other, idempotencyKey: key() })),
    "validation.not_found",
  );
  assert.equal(
    await code(h["chat.share"]!(maya, { threadId: id, messageId: fresh, toThreadId: other, idempotencyKey: key() })),
    "none",
  );
});

test("thread and reply: a pre-floor message cannot be replied under or quoted", async () => {
  const { id, old, fresh, maya } = await world();
  assert.equal(await code(h["chat.thread"]!(maya, { threadId: id, messageId: old })), "validation.not_found");
  assert.equal(
    await code(h["chat.post"]!(maya, { threadId: id, body: "re", replyTo: old, idempotencyKey: key() })),
    "validation.bad_input",
  );
  assert.equal(await code(h["chat.thread"]!(maya, { threadId: id, messageId: fresh })), "none");
  assert.equal(
    await code(h["chat.post"]!(maya, { threadId: id, body: "re", replyTo: fresh, idempotencyKey: key() })),
    "none",
  );
});

test("remember and make a task: a pre-floor message is not found", async () => {
  const { id, old, fresh, maya } = await world();
  assert.equal(
    await code(h["chat.remember"]!(maya, { threadId: id, messageId: old, idempotencyKey: key() })),
    "validation.not_found",
  );
  assert.equal(
    await code(h["chat.make_task"]!(maya, { threadId: id, messageId: old, idempotencyKey: key() })),
    "validation.not_found",
  );
  assert.notEqual(
    await code(h["chat.remember"]!(maya, { threadId: id, messageId: fresh, idempotencyKey: key() })),
    "validation.not_found",
  );
});

test("fork: a pre-floor message cannot be the point to fork up to", async () => {
  const { id, old, fresh, maya } = await world();
  assert.equal(
    await code(h["chat.fork"]!(maya, { threadId: id, messageId: old, idempotencyKey: key() })),
    "validation.not_found",
  );
  assert.equal(await code(h["chat.fork"]!(maya, { threadId: id, messageId: fresh, idempotencyKey: key() })), "none");
});

test("mentionedIn: an adder with a floor learns nothing of a message from before it (same answer as a message that does not exist)", async () => {
  const { id, old, maya } = await world();
  const said = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
    } catch (e) {
      return JSON.stringify((e as { error?: unknown }).error ?? String(e)).replace(/msg_[a-z0-9]+/g, "msg");
    }
    return "none";
  };
  const asked = await said(h["threads.members.add"]!(maya, { threadId: id, personId: "usr_leo", mentionedIn: old }));
  const none = await said(
    h["threads.members.add"]!(maya, { threadId: id, personId: "usr_leo", mentionedIn: "msg_nothing" }),
  );
  assert.equal(asked, none, "the same words as for a message that is not there");
});

// the class: a handler that reads a message by an id from its input goes through messageAsMe (or messageIn, which floors); the few that do not are listed with why
const ALLOW: Record<string, string> = {
  "g24b.ts":
    "channels.members.add (mentionedIn): a channel's members read all of it, and the pipeline's Manage check decides who adds",
};
const ALLOW_CALL: Record<string, string> = {
  "agent-dm.ts: messageBy(ctx.db, p.messageId":
    "a queued job of the agent's own conversation: the message is the agent's, found by the job's own payload",
  "post.ts: messageBy(ctx.db, input.clientId":
    "the retry of the caller's own post under the same key: the same message comes back to the same person",
};
test("class: no handler looks a message up by an id from its input without the floor", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../handlers");
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    if (f in ALLOW) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/messageBy\(\s*ctx\.db,\s*(input\.\w+|p\.messageId)/g))
      if (!(`${f}: ${m[0]}` in ALLOW_CALL)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(
    bad,
    [],
    "use messageAsMe(ctx, id) (handlers/floor.ts): it applies membership and the reading floor",
  );
});

test("delete: a pre-floor message answers not found, the same as one that is not there (not 'you can only delete your own')", async () => {
  const { id, old, maya } = await world();
  assert.equal(await code(h["chat.delete_message"]!(maya, { threadId: id, messageId: old })), "validation.not_found");
  assert.equal(
    await code(h["chat.delete_message"]!(maya, { threadId: id, messageId: "msg_nothing" })),
    "validation.not_found",
  );
});
