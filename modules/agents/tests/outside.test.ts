// An outside agent as the agents module holds it: a normal row, runtime outside, private to its owner, named so it cannot pass for someone, with a queue only its owner can fill and only it can read.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const nested = (hn: Harness, ctx: Harness["ctx"] = hn.ctx): Harness["ctx"] => ({ ...ctx, depth: 1 });
const connect = async (hn: Harness, clientName = "Claude Code"): Promise<{ agentId: string; name: string }> => h["agents.outside.connect"]!(nested(hn), { clientName });
const SAM = "usr_sam";

test("only the sign-in makes one: a direct call is refused, an agent's too", async () => {
  const hn = harness();
  await assert.rejects(() => h["agents.outside.connect"]!(hn.ctx, { clientName: "x" }));
  await assert.rejects(() => h["agents.outside.connect"]!(nested(hn, hn.as({ kind: "agent", id: "agt_x" }, DANA)), { clientName: "x" }));
});

test("it is a normal agent: an owner, a folder, a face from the library, runtime outside", async () => {
  const hn = harness();
  const { agentId } = await connect(hn);
  const { agent } = await h["agents.get"]!(hn.ctx, { agentId });
  assert.equal(agent.runtime, "outside");
  assert.equal(agent.ownerId, DANA);
  assert.match(agent.face, /^outside-/);
  assert.notEqual(agent.folderId, "fld_unset");
  const plain = (await h["agents.create"]!(hn.ctx, { name: "Plain", idempotencyKey: "p" })).agent;
  assert.equal(plain.runtime, undefined, "any other agent says nothing");
});

test("a name cannot pass for Vyre, a role or a second agent, and carries no path or control characters", async () => {
  const hn = harness();
  assert.equal((await connect(hn, "Vyre")).name, "Vyre (outside)");
  assert.equal((await connect(hn, "Admin")).name, "Admin (outside)");
  assert.equal((await connect(hn, "Claude Code")).name, "Claude Code");
  assert.equal((await connect(hn, "Claude Code")).name, "Claude Code 2");
  assert.equal((await connect(hn, "a/b:c")).name, "a b c");
  assert.equal((await connect(hn, "   ")).name, "Outside agent");
});

test("owner only: a teammate does not see it, cannot read it, and cannot give it work; a share changes nothing", async () => {
  const hn = harness();
  const { agentId } = await connect(hn);
  const sam = hn.as({ kind: "person", id: SAM });
  await assert.rejects(() => h["agents.get"]!(sam, { agentId }));
  assert.equal((await h["agents.list"]!(sam, {})).agents.some((a: { agentId: string }) => a.agentId === agentId), false);
  assert.deepEqual(await h["agents.outside.usable"]!(sam, { agentId }), { usable: false });
  assert.deepEqual(await h["agents.outside.usable"]!(hn.ctx, { agentId }), { usable: true });
  const other = (await h["agents.create"]!(hn.ctx, { name: "Plain", idempotencyKey: "p" })).agent.agentId;
  assert.deepEqual(await h["agents.outside.usable"]!(sam, { agentId: other }), { usable: true }, "every other agent is as it was");
  assert.deepEqual(await h["agents.outside.enqueue"]!(nested(hn), { agentId, kind: "mention", threadId: "thr_a", messageId: "msg_b", asker: SAM, text: "do this" }), { queued: false });
});

test("the queue: one job per message, oldest first, only for the agent itself, and only the server fills it", async () => {
  const hn = harness();
  const { agentId } = await connect(hn);
  const me = hn.as({ kind: "agent", id: agentId }, DANA);
  await assert.rejects(async () => h["agents.outside.enqueue"]!(hn.ctx, { agentId, kind: "mention", asker: DANA }), "a person's own call does not reach it");
  assert.deepEqual(await h["agents.next"]!(me, {}), { job: null, waiting: 0 });
  const put = (messageId: string) => h["agents.outside.enqueue"]!(nested(hn), { agentId, kind: "mention", threadId: "thr_a", messageId, asker: DANA, title: "T", text: messageId });
  assert.deepEqual(await put("msg_1"), { queued: true });
  hn.advance(10);
  assert.deepEqual(await put("msg_2"), { queued: true });
  assert.deepEqual(await put("msg_2"), { queued: false }, "the same message twice is one job");
  const first = await h["agents.next"]!(me, {});
  assert.equal(first.job.text, "msg_1");
  assert.equal(first.waiting, 1);
  assert.equal((await h["agents.next"]!(me, {})).job.text, "msg_2");
  assert.equal((await h["agents.next"]!(me, {})).job, null);
  await assert.rejects(async () => h["agents.next"]!(hn.ctx, {}), "a person has no queue");
  const vyreAgent = (await h["agents.create"]!(hn.ctx, { name: "Plain", idempotencyKey: "p" })).agent.agentId;
  await assert.rejects(async () => h["agents.next"]!(hn.as({ kind: "agent", id: vyreAgent }, DANA), {}), "nor does a Vyre agent");
});

test("status: Working for a minute after a call, Awake for two, then asleep, which the app says as Offline", async () => {
  const hn = harness();
  const { agentId } = await connect(hn);
  await h["agents.outside.seen"]!(nested(hn), { agentId });
  assert.equal((await h["agents.get"]!(hn.ctx, { agentId })).agent.status, "working");
  hn.advance(61_000);
  assert.equal((await h["agents.get"]!(hn.ctx, { agentId })).agent.status, "awake");
  hn.advance(60_000);
  assert.equal((await h["agents.get"]!(hn.ctx, { agentId })).agent.status, "asleep");
});

test("it cannot be paused or handed on, and it ends with its person", async () => {
  const hn = harness();
  const { agentId } = await connect(hn);
  await assert.rejects(() => h["agents.pause"]!(hn.ctx, { agentId }));
  await assert.rejects(() => h["agents.set_owner"]!(hn.ctx, { agentId, ownerId: SAM }));
});
