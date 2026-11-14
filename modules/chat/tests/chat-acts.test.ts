// The server holds what the app shows (r-keyreach, 14 Nov 2026): nobody raises their own reading floor, an adder grants history only from the adder's own floor, a channel's main thread takes people only through the
// channel's rules, a creator who left reads and posts nothing, and a star on a chat the caller cannot see is "not found". Two members and a late joiner; a non-manager and an invite-only channel; a starter who left.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, LEO, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `ca${++n}`;
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { error?: { code?: string } }).error?.code ?? "unknown";
  }
  return "none";
};
const world = () => harness({ calls: { "engine.set_mode": () => ({ mode: "listen", leadAgentId: null }) } });
const say = async (ctx: Harness["ctx"], threadId: string, body: string) =>
  (await h["chat.post"]!(ctx, { threadId, body, idempotencyKey: key() })).message.messageId as string;
const bodies = async (ctx: Harness["ctx"], threadId: string): Promise<string[]> =>
  (await h["chat.messages.list"]!(ctx, { threadId })).messages.map((m: any) => m.body);
const reads = async (ctx: Harness["ctx"], threadId: string, word: string): Promise<boolean> => {
  try {
    return (await bodies(ctx, threadId)).some((b) => b.includes(word));
  } catch {
    return false;
  }
};

/** A chat Dana started, with OLDSECRET said before Maya was added (no earlier messages), then NEWWORD said after. */
async function lateJoiner() {
  const hn = world();
  const id = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread
    .threadId as string;
  await say(hn.ctx, id, "OLDSECRET");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(5_000);
  await say(hn.ctx, id, "NEWWORD");
  return { hn, id };
}

test("a late joiner cannot raise their own floor: adding themselves with fromStart changes nothing", async () => {
  const { hn, id } = await lateJoiner();
  const maya = hn.person(MAYA);
  assert.equal(await reads(maya, id, "OLDSECRET"), false, "before");
  assert.equal(
    await failure(h["threads.members.add"]!(maya, { threadId: id, personId: MAYA, fromStart: true })),
    "permission.no_grant",
    "a plain refusal, not a quiet no-op",
  );
  assert.equal(await reads(maya, id, "OLDSECRET"), false, "after: still hidden");
  assert.equal(await reads(maya, id, "NEWWORD"), true);
});

test("an adder grants history only from the adder's own floor: a late joiner adds Leo with fromStart and Leo reads from Maya's floor, never earlier", async () => {
  const { hn, id } = await lateJoiner();
  await h["threads.members.add"]!(hn.person(MAYA), { threadId: id, personId: LEO, fromStart: true });
  const leo = hn.person(LEO);
  assert.equal(await reads(leo, id, "OLDSECRET"), false, "not what Maya cannot read");
  assert.equal(await reads(leo, id, "NEWWORD"), true, "what Maya reads");
});

test("only the owner widens a member who is already in: a late joiner asking again for another member changes nothing; the owner's ask still widens", async () => {
  const { hn, id } = await lateJoiner();
  hn.advance(1_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO });
  assert.equal(
    await failure(h["threads.members.add"]!(hn.person(MAYA), { threadId: id, personId: LEO, fromStart: true })),
    "permission.no_grant",
  );
  assert.equal(
    await reads(hn.person(LEO), id, "NEWWORD"),
    false,
    "a member cannot widen another, not even to the member's own floor",
  );
  assert.equal(await reads(hn.person(LEO), id, "OLDSECRET"), false);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO, fromStart: true });
  assert.equal(await reads(hn.person(LEO), id, "OLDSECRET"), true, "the owner can");
});

/** An invite-only channel Dana made, with Maya in it (Maya is not a manager); `deny` makes the pipeline's Manage check say no for Maya. */
async function inviteChannel() {
  const hn = world();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "ops", visibility: "invite", idempotencyKey: key() }))
    .channel;
  await h["channels.members.add"]!(hn.ctx, { channelId: ch.channelId, personIds: [MAYA] });
  await say(hn.ctx, ch.mainThreadId, "CHANNELOLD");
  const maya = hn.person(MAYA) as Harness["ctx"] & { authorize?: unknown };
  maya.authorize = () => ({ effect: "deny" });
  return { hn, ch, maya };
}

test("an invite-only channel takes people only through its own rules: a member who is not a manager cannot add through the main thread", async () => {
  const { hn, ch, maya } = await inviteChannel();
  assert.equal(
    await failure(h["threads.members.add"]!(maya, { threadId: ch.mainThreadId, personId: LEO })),
    "permission.role_lacks_permission",
  );
  assert.equal(await reads(hn.person(LEO), ch.mainThreadId, "CHANNELOLD"), false, "Leo is still outside");
  // the manager's own call through the main thread still works (the same check as channels.members.add)
  await h["threads.members.add"]!(hn.ctx, { threadId: ch.mainThreadId, personId: LEO });
  assert.equal(await reads(hn.person(LEO), ch.mainThreadId, "CHANNELOLD"), true);
});

test("a creator who left a chat reads and posts nothing: the starter grants nothing without a live membership row", async () => {
  const hn = world();
  const id = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread
    .threadId as string;
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  await say(hn.ctx, id, "BEFORE LEAVE");
  await h["threads.leave"]!(hn.ctx, { threadId: id });
  await say(hn.person(MAYA), id, "AFTER LEAVE");
  assert.equal(await reads(hn.ctx, id, "AFTER LEAVE"), false, "the creator no longer reads");
  assert.equal(await failure(say(hn.ctx, id, "STILL HERE")), "validation.not_found", "and no longer posts");
});

test("an Ask pane is its starter's alone: the starter stays its reader (it has no member list)", async () => {
  const hn = world();
  const ask = await h["chat.start"]!(hn.ctx, {
    kind: "ask",
    agentIds: [INTAKE],
    scopeType: "record",
    scopeId: "rec_1",
    idempotencyKey: key(),
  });
  assert.equal(await failure(h["chat.messages.list"]!(hn.ctx, { threadId: ask.thread.threadId })), "none");
  assert.equal(
    await failure(h["chat.messages.list"]!(hn.person(MAYA), { threadId: ask.thread.threadId })),
    "validation.not_found",
  );
});

test("a late joiner cannot pin, unpin or learn about a message from before their floor: it is not found", async () => {
  const hn = world();
  const id = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread
    .threadId as string;
  const old = await say(hn.ctx, id, "OLDSECRET");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(5_000);
  const fresh = await say(hn.ctx, id, "NEWWORD");
  const maya = hn.person(MAYA);
  assert.equal(await failure(h["chat.pin"]!(maya, { threadId: id, messageId: old })), "validation.not_found");
  assert.equal(
    (await h["chat.pin"]!(maya, { threadId: id, messageId: fresh })).pinned,
    true,
    "what she reads she may pin",
  );
});

test("an agent acting for a person adds and widens only as that person: for Maya it grants from Maya's floor, and it cannot raise Maya's own", async () => {
  const { hn, id } = await lateJoiner();
  hn.advance(1_000);
  const forMaya = hn.agent(INTAKE, MAYA);
  await h["threads.members.add"]!(forMaya, { threadId: id, personId: LEO, fromStart: true });
  assert.equal(
    await reads(hn.person(LEO), id, "OLDSECRET"),
    false,
    "an agent for Maya gives Leo nothing Maya cannot read",
  );
  assert.equal(await reads(hn.person(LEO), id, "NEWWORD"), true, "what the room read since Maya came in");
  assert.equal(
    await failure(h["threads.members.add"]!(forMaya, { threadId: id, personId: MAYA, fromStart: true })),
    "permission.no_grant",
    "and it cannot raise Maya's own floor",
  );
  assert.equal(await reads(hn.person(MAYA), id, "OLDSECRET"), false);
});

test("an agent acting for the owner grants only from where the whole room reads: what was said before the latest person came in is not handed on", async () => {
  const { hn, id } = await lateJoiner();
  hn.advance(1_000);
  await h["threads.members.add"]!(hn.agent(INTAKE, DANA), { threadId: id, personId: LEO, fromStart: true });
  assert.equal(await reads(hn.person(LEO), id, "OLDSECRET"), false);
});
