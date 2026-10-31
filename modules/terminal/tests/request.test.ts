// terminal.request (rc.8): an agent asks the person to run a command; the chat gets a question card carrying the command, the reason and the risk; a command the person's rules deny is not offered.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../handlers/sessions.ts";
import type { TermCtx } from "../projections.ts";

type Row = Record<string, unknown>;
function ctxWith(rules: { allow?: string[]; ask?: string[]; deny?: string[] } = {}, calls: Array<{ cap: string; input: Record<string, unknown> }> = []): TermCtx {
  const db = {
    all: (sql: string): Row[] => (/FROM terminal_rules/.test(sql) ? [{ person_id: "usr_a", allow: JSON.stringify(rules.allow ?? []), ask: JSON.stringify(rules.ask ?? []), deny: JSON.stringify(rules.deny ?? []), folders: "[]" }] : []),
    run: () => ({ changes: 0 }),
  };
  return {
    space: "spc_1", principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_a", trace: { traceId: "t" }, now: () => 1, db, emit: () => undefined, authorize: () => ({ effect: "allow" }), log: { warn: () => undefined },
    call: async (cap: string, input: unknown) => { calls.push({ cap, input: input as Record<string, unknown> }); return { blockId: "blk_1", messageId: "msg_1" }; },
  } as unknown as TermCtx;
}

test("the request becomes a question card with the command, the reason and the risk", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const out = await request(ctxWith({}, calls), { threadId: "thr_1", command: "sudo apt install ffmpeg", why: "ffmpeg is needed to cut the clip", host: "device", idempotencyKey: "k" });
  assert.deepEqual(out, { blockId: "blk_1", messageId: "msg_1", risk: "danger" });
  const q = calls[0]!;
  assert.equal(q.cap, "chat.question.ask");
  assert.equal(q.input["prompt"], "ffmpeg is needed to cut the clip");
  assert.deepEqual((q.input["options"] as Array<{ key: string }>).map((o) => o.key), ["run", "copy", "decline"]);
  assert.deepEqual(q.input["card"], { kind: "terminal", command: "sudo apt install ffmpeg", host: "device", risk: "danger" });
  assert.equal(q.input["allowOther"], true, "what the command printed comes back as the answer");
});

test("a command the person's rules deny is not offered, and the words must be there", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  await assert.rejects(() => request(ctxWith({ deny: ["npm"] }, calls), { threadId: "thr_1", command: "npm install", why: "x" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.role_lacks_permission");
  assert.equal(calls.length, 0);
  await assert.rejects(() => request(ctxWith(), { threadId: "thr_1", command: " ", why: "x" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.bad_input");
  await assert.rejects(() => request(ctxWith(), { threadId: "thr_1", command: "ls", why: " " }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.bad_input");
});
