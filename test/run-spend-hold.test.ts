// A limit holds a command-line turn at the hook (r42-runtime): every tool call of it, the main agent's and its subagents', is refused with the reason until the limit is raised or the turn ends. The payloads are the real ones of
// Claude Code 2.1.327 (agent/fixtures/golden-streams/claude-2.1.327-nested-subagents.hooks.jsonl).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSubagentGate } from "../agent/src/tools/hooks.ts";
import { TOKEN, driverCaller, startMcp } from "../agent/fixtures/golden-streams/rig.ts";
import { HOLD_WORDS, createSpendGate, holdOff, holdOn, holdOf } from "../modules/engine/spend-hold.ts";

async function hook(url: string, payload: Record<string, unknown>): Promise<{ block: string | null; notes: string[] }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "vyre/hook", params: { event: "PreToolUse", payload } }),
  });
  return ((await r.json()) as { result: { block: string | null; notes: string[] } }).result;
}
const TOP = { hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "toolu_01M2VdAi4MEXhjNQYfsjhp1q" };
const INNER = {
  agent_id: "a3a1aa893f5f8d8fc",
  agent_type: "general-purpose",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_01JjsYgTJ6shuJra9a7uoRay",
};
const VYRE = { hook_event_name: "PreToolUse", tool_name: "mcp__vyre__schema_describe", tool_use_id: "toolu_x" };

test("while a limit holds the agent in this chat, every call of its session is refused, whichever tool and whoever made it; raising it, or the turn ending, lets the next one through", async () => {
  const rig = await startMcp({ [TOKEN]: driverCaller() });
  bindSubagentGate(createSpendGate(() => null));
  try {
    const thread = { thread: { threadId: "thr_1" }, agentId: "agt_intake" };
    assert.deepEqual(await hook(rig.url, TOP), { block: null, notes: [] });
    holdOn(thread.thread.threadId, thread.agentId);
    for (const [name, payload] of [
      ["the main agent's Agent call", TOP],
      ["a call inside a subagent", INNER],
      ["a Vyre tool", VYRE],
    ] as const)
      assert.equal((await hook(rig.url, payload)).block, HOLD_WORDS, name);
    assert.equal(holdOff(thread.thread.threadId, thread.agentId), 1, "released once");
    assert.equal((await hook(rig.url, TOP)).block, null, "the limit was raised");
    assert.equal(holdOf(thread.thread.threadId, thread.agentId), undefined);
  } finally {
    bindSubagentGate(null);
    await rig.close();
  }
});

test("a hold is for one agent in one chat: another agent, or the same one in another chat, goes on", async () => {
  holdOn("thr_a", "agt_one");
  const gate = createSpendGate(() => null);
  assert.equal((await gate({ threadId: "thr_a", agentId: "agt_one" })).block, HOLD_WORDS);
  assert.equal((await gate({ threadId: "thr_a", agentId: "agt_two" })).block, null);
  assert.equal((await gate({ threadId: "thr_b", agentId: "agt_one" })).block, null);
  assert.equal(holdOff("thr_a"), 1, "a whole chat can be released at once");
  assert.equal((await gate({ threadId: "thr_a", agentId: "agt_one" })).block, null);
});

test("a model that goes on asking after refusals has its turn ended, once, after three refused calls; raising the limit resets the count; another agent is not counted", async () => {
  const ended: string[] = [];
  const gate = createSpendGate(
    () => null,
    (t, a, r) => void ended.push(`${t}:${a}:${r}`),
  );
  holdOn("thr_e", "agt_one");
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  await gate({ threadId: "thr_e", agentId: "agt_one", subagent: "a1" });
  assert.deepEqual(ended, [], "two refusals: it may still stop by itself");
  await gate({ threadId: "thr_e", agentId: "agt_one", tool: "Bash" });
  assert.deepEqual(ended, [`thr_e:agt_one:${HOLD_WORDS}`], "the third ends the turn");
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  assert.equal(ended.length, 1, "once, not again for each further call");
  await gate({ threadId: "thr_e", agentId: "agt_two" });
  assert.equal(ended.length, 1, "another agent is not held and not counted");
  holdOff("thr_e", "agt_one");
  holdOn("thr_e", "agt_one");
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  assert.equal(ended.length, 1, "the count started again when the limit was raised");
  await gate({ threadId: "thr_e", agentId: "agt_one" });
  assert.equal(ended.length, 2);
  holdOff("thr_e");
});
