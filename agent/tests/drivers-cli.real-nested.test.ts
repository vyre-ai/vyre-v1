// A real Claude Code 2.1.327 stream with one subagent that starts one nested subagent (captured 19 Nov 2026, agent/fixtures/golden-streams/claude-2.1.327-nested-subagents.jsonl): what the decoder makes of it. The subagent's own
// messages carry its tool calls and its use; the nested subagent's own messages are NOT in the stream (only the call that started it and system task lines), and every task line names its call (tool_use_id) and its task id,
// which is also the agent_id a hook inside that subagent carries (claude-2.1.327-nested-subagents.hooks.jsonl).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClaudeDecoder } from "../src/drivers/cli/index.ts";
import type { CliEvent } from "../src/drivers/cli/index.ts";

const lines = readFileSync(new URL("../fixtures/golden-streams/claude-2.1.327-nested-subagents.jsonl", import.meta.url), "utf8").trim().split("\n");
const decode = (): CliEvent[] => {
  const d = createClaudeDecoder();
  return [...lines.flatMap((l) => d.push(l)), ...d.finish()];
};
const OUTER = "toolu_01M2VdAi4MEXhjNQYfsjhp1q";
const INNER = "toolu_01C5ng1CqBoGjR4tdxczZshM";

test("the outer subagent is a call of the main agent; its own tool calls and the nested Agent call carry the outer call as their parent", () => {
  const out = decode();
  const calls = out.filter((e) => e.type === "tool" && e.phase === "call") as Array<{ id: string; name: string; parent?: string }>;
  assert.deepEqual(calls.find((c) => c.id === OUTER), { type: "tool", phase: "call", id: OUTER, name: "Agent" });
  assert.deepEqual(calls.find((c) => c.name === "Read")?.parent, OUTER);
  assert.deepEqual(calls.find((c) => c.id === INNER), { type: "tool", phase: "call", id: INNER, name: "Agent", parent: OUTER });
});

test("what the outer subagent used is told once per message, under its call; its words are told only when it wrote any (this one only called tools)", () => {
  const out = decode();
  const used = out.filter((e) => e.type === "tool" && e.phase === "usage") as Array<{ parent: string; inputTokens: number; outputTokens: number }>;
  assert.ok(used.length >= 1);
  assert.ok(used.every((u) => u.parent === OUTER), "only the outer subagent's messages are in the stream");
  assert.equal(used[0]!.inputTokens, 2 + 18_807, "input counts the cache writes, as for the main agent");
  assert.equal(out.some((e) => e.type === "tool" && e.phase === "said"), false);
  // none of it is the main agent's: its own use is on its own messages
  assert.equal(out.filter((e) => e.type === "usage").length >= 0, true);
});

test("the end of each subagent is told with what it returned; the nested one ends before the outer one", () => {
  const out = decode();
  const results = out.filter((e) => e.type === "tool" && e.phase === "result" && (e.id === INNER || e.id === OUTER)) as Array<{ id: string; ok: boolean }>;
  assert.deepEqual(results.map((r) => r.id), [INNER, OUTER]);
  assert.ok(results.every((r) => r.ok));
});

test("the task lines name the call and the task id, which the hook inside that subagent calls its agent_id", () => {
  const out = decode();
  const tasks = out.filter((e) => e.type === "task") as Array<{ state: string; id: string; taskId: string }>;
  const started = tasks.filter((t) => t.state === "start");
  assert.deepEqual(started.map((t) => [t.id, t.taskId]), [[OUTER, "ae63a0c7cf1d188f5"], [INNER, "a3a1aa893f5f8d8fc"]]);
  const hooks = readFileSync(new URL("../fixtures/golden-streams/claude-2.1.327-nested-subagents.hooks.jsonl", import.meta.url), "utf8");
  assert.ok(hooks.includes('"agent_id":"ae63a0c7cf1d188f5"') || hooks.includes("'agent_id': 'ae63a0c7cf1d188f5'") || hooks.includes("ae63a0c7cf1d188f5"));
});
