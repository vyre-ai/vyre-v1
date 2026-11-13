// A refusal an agent can never fix itself is not tried again (13 Nov 2026: the owner's server showed vault.use refused "above clearance" 25 times in four days by two agents, the same refusal again and again).
// Within a turn the same call is answered at once with the same plain words; across turns and runs it is remembered for a while; a routine that meets one says so once to its owner as a Needs-you line.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError, makeError } from "../../host/src/routes/errors.ts";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated } from "../src/tools/harness.ts";
import type { ToolCtx } from "../src/tools/types.ts";
import type { ErrorCode } from "../../packages/contracts/src/types.ts";

function setup(code: ErrorCode = "permission.above_clearance") {
  const loaded = loadGenerated();
  let calls = 0;
  const needs: Array<{ agentId: string; tool: string; asker: string }> = [];
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    levelFor: () => "manage",
    canEngineer: () => true,
    needsYou: (n) => needs.push({ agentId: n.agentId, tool: n.tool, asker: n.asker }),
    invoke: async (_cap, input) => {
      calls++;
      if ((input as { handle?: string }).handle === "#Open_Key") return { status: "ok", output: {}, traceId: "t" };
      throw new HostError(makeError(code, "trace_x"));
    },
  });
  s.preload("thr_1", ["vault_use"]);
  const ctx = (turn: string, over: Partial<ToolCtx> = {}): ToolCtx => ({
    space: "spc_1",
    agentId: "agt_a",
    asker: "usr_dana",
    thread: { threadId: "thr_1", kind: "chat", planMode: false },
    turnId: turn,
    ...over,
  });
  return { s, ctx, count: () => calls, needs, tick: (_ms: number) => 0 };
}
const USE = { handle: "#Company_Key", fields: ["token"] };

test("the same refused call in the same turn is answered at once, with the same words, and never reaches the server again", async () => {
  const { s, ctx, count } = setup();
  const a = await s.call(ctx("trn_1"), "vault_use", USE);
  const b = await s.call(ctx("trn_1"), "vault_use", USE);
  assert.equal(a.kind, "error");
  assert.equal(b.kind, "error");
  assert.equal(count(), 1, "the second call did not go to the server");
  assert.equal(
    JSON.stringify(a.kind === "error" ? a.result.content : ""),
    JSON.stringify(b.kind === "error" ? b.result.content : ""),
  );
  assert.equal(b.kind === "error" && b.error.code, "permission.above_clearance");
});

test("a different call in the same turn still goes through", async () => {
  const { s, ctx, count } = setup();
  await s.call(ctx("trn_1"), "vault_use", USE);
  const open = await s.call(ctx("trn_1"), "vault_use", { handle: "#Open_Key", fields: ["token"] });
  assert.equal(open.kind, "result");
  assert.equal(count(), 2);
});

test("another turn asks the server again: a refusal never outlives its cause (a person grants it, then the agent's next call works)", async () => {
  const { s, ctx, count } = setup();
  await s.call(ctx("trn_1"), "vault_use", USE);
  const later = await s.call(ctx("trn_2"), "vault_use", USE);
  assert.equal(later.kind, "error");
  assert.equal(count(), 2, "a later turn did try the server");
  const asker2 = await s.call(ctx("trn_2", { asker: "usr_omar" }), "vault_use", USE);
  assert.equal(asker2.kind, "error");
  assert.equal(count(), 3, "another asker is asked for separately");
});

test("the cause is fixed between two calls of one turn's next turn: the call succeeds at once", async () => {
  const loaded = loadGenerated();
  let allowed = false;
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    levelFor: () => "manage",
    canEngineer: () => true,
    invoke: async () => {
      if (!allowed) throw new HostError(makeError("permission.above_clearance", "t"));
      return { status: "ok", output: {}, traceId: "t" };
    },
  });
  s.preload("thr_1", ["vault_use"]);
  const ctx = (turn: string): ToolCtx => ({
    space: "s",
    agentId: "agt_a",
    asker: "usr_dana",
    thread: { threadId: "thr_1", kind: "chat", planMode: false },
    turnId: turn,
  });
  assert.equal((await s.call(ctx("trn_1"), "vault_use", USE)).kind, "error");
  allowed = true;
  assert.equal((await s.call(ctx("trn_2"), "vault_use", USE)).kind, "result");
});

test("another agent is not held back by this agent's refusal", async () => {
  const { s, ctx, count } = setup();
  await s.call(ctx("trn_1"), "vault_use", USE);
  await s.call(ctx("trn_9", { agentId: "agt_b" }), "vault_use", USE);
  assert.equal(count(), 2);
});

test("a refusal that is only for now (a held call, a rate limit, bad input) is never remembered", async () => {
  const { s, ctx, count } = setup("rate_limit.exceeded");
  await s.call(ctx("trn_1"), "vault_use", USE);
  await s.call(ctx("trn_1"), "vault_use", USE);
  assert.equal(count(), 2);
});

test("a routine that meets one says so once to its owner, and a chat does not", async () => {
  const run = setup();
  const runCtx = (turn: string) =>
    run.ctx(turn, { runId: "run_1", thread: { threadId: "thr_1", kind: "run", planMode: false } });
  await run.s.call(runCtx("trn_1"), "vault_use", USE);
  await run.s.call(runCtx("trn_2"), "vault_use", USE);
  assert.deepEqual(run.needs, [{ agentId: "agt_a", tool: "vault_use", asker: "usr_dana" }], "once, for the owner");
  const chat = setup();
  await chat.s.call(chat.ctx("trn_1"), "vault_use", USE);
  assert.deepEqual(chat.needs, [], "a person in a chat is told in the chat itself");
});

test("a role the agent cannot hold is remembered the same way", async () => {
  const { s, ctx, count } = setup("permission.role_lacks_permission");
  await s.call(ctx("trn_1"), "vault_use", USE);
  await s.call(ctx("trn_1"), "vault_use", USE);
  assert.equal(count(), 1);
});
