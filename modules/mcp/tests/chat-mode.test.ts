// A CLI engine's MCP session works under the mode of the chat it belongs to: Plan blocks what changes or sends, Ask first and Auto are carried for the tool session.
import test from "node:test";
import assert from "node:assert/strict";
import type { McpCaller } from "../../../agent/src/mcp/types.ts";
import { withChatMode } from "../impl.ts";
import type { Invoke } from "../../../host/src/invoke.ts";

const caller = (over: Partial<McpCaller> = {}): McpCaller => ({ kind: "driver", sessionId: "ses_1", space: "spc_1", principal: { kind: "agent", id: "agt_1" }, actingFor: "usr_dana", threadId: "thr_1", ...over });
const runtime = (mode: unknown, seen: Array<{ cap: string; principal: string; actingFor?: string }> = []) => ({
  db: {} as never, space: "spc_1",
  invoke: (async (cap, _input, seed) => { seen.push({ cap, principal: seed.principal.id, ...(seed.actingFor ? { actingFor: seed.actingFor } : {}) }); return { status: "ok", output: { thread: { mode } }, traceId: "t" }; }) as Invoke,
});

test("the session of a chat opens with the chat's mode, read as the agent for the person it acts for; Plan also sets plan mode", async () => {
  const seen: Array<{ cap: string; principal: string; actingFor?: string }> = [];
  const c = await withChatMode(runtime("plan", seen), caller());
  assert.deepEqual([c.mode, c.planMode], ["plan", true]);
  assert.deepEqual(seen, [{ cap: "threads.get", principal: "agt_1", actingFor: "usr_dana" }]);
  const ask = await withChatMode(runtime("ask"), caller());
  assert.deepEqual([ask.mode, ask.planMode], ["ask", false]);
  assert.equal((await withChatMode(runtime("auto"), caller())).mode, "auto");
});

test("an outside actor, a session with no chat, and a chat that cannot be read are left as they were", async () => {
  const outside = caller({ kind: "outside", principal: { kind: "actor", id: "act_1" } });
  assert.equal(await withChatMode(runtime("plan"), outside), outside);
  const nochat = caller(); delete (nochat as { threadId?: string }).threadId;
  assert.equal(await withChatMode(runtime("plan"), nochat), nochat);
  const c = caller();
  assert.equal(await withChatMode({ ...runtime("plan"), invoke: (async () => { throw new Error("down"); }) as Invoke }, c), c);
  assert.equal(await withChatMode(runtime("yolo"), c), c);
});
