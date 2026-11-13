// What an agent in a private chat shows to someone else who asks it. The agent sits in Dana's chat; Maya was never in it. Asked by Maya, it must not read, list, search, quote, fork or share that chat
// (the rule in lib/agent-asker.ts); asked by Dana, or by nobody (a wake), it works as before.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, harness as baseHarness, openRaw } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = (): string => `aa${++n}`;
const as = (raw: ReturnType<typeof openRaw>, principal: { kind: "person" | "agent"; id: string }, actingFor?: string): Harness => baseHarness({ raw, principal, ...(actingFor ? { actingFor } : {}) });
const refused = async (p: Promise<unknown>): Promise<boolean> => p.then(() => false, () => true);

test("an agent in Dana's private chat does not read, list, search, fork or share it for Maya, who was never in it", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const thread = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const said = (await h["chat.post"]!(dana.ctx, { threadId: thread, body: "My settlement walk-away number is 310 thousand", idempotencyKey: key() })).message.messageId as string;
  const forMaya = as(raw, { kind: "agent", id: INTAKE }, MAYA);
  assert.ok(await refused(h["chat.messages.list"]!(forMaya.ctx, { threadId: thread })), "messages.list");
  assert.ok(await refused(h["chat.message.get"]!(forMaya.ctx, { threadId: thread, messageId: said })), "message.get");
  assert.ok(await refused(h["chat.pins.list"]!(forMaya.ctx, { threadId: thread })), "pins.list");
  const listed = await h["threads.list"]!(forMaya.ctx, {}).catch(() => ({ threads: [] }));
  assert.ok(!(listed.threads ?? []).some((t: { threadId: string }) => t.threadId === thread), "threads.list shows Dana's chat to Maya");
  assert.ok(await refused(h["threads.get"]!(forMaya.ctx, { threadId: thread })), "threads.get");
  assert.ok(await refused(h["chat.search"]!(forMaya.ctx, { q: "settlement", threadId: thread })), "chat.search with the thread");
  assert.ok(await refused(h["chat.fork"]!(forMaya.ctx, { threadId: thread, messageId: said, idempotencyKey: key() })), "chat.fork");
});

test("the same agent still works in that chat for Dana, and for nobody (a wake or a routine)", async () => {
  const raw = openRaw();
  const dana = as(raw, { kind: "person", id: DANA });
  const thread = (await h["chat.start"]!(dana.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(dana.ctx, { threadId: thread, body: "hello", idempotencyKey: key() });
  for (const who of [as(raw, { kind: "agent", id: INTAKE }, DANA), as(raw, { kind: "agent", id: INTAKE })]) {
    const out = await h["chat.messages.list"]!(who.ctx, { threadId: thread });
    assert.ok(out.messages.some((m: { body?: string }) => m.body === "hello"));
  }
});
