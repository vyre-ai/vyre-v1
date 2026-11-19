// A call made inside one of a command-line engine's own subagents (r42-runtime): the vyre-hook carries its agent_id; a stop asked of that subagent refuses its next call with a reason, and what it was told rides back as notes.
// The payloads are the real ones of Claude Code 2.1.327 (agent/fixtures/golden-streams/claude-2.1.327-nested-subagents.hooks.jsonl).
import test from "node:test";
import assert from "node:assert/strict";
import { bindSubagentGate } from "../src/tools/hooks.ts";
import { TOKEN, driverCaller, startMcp } from "../fixtures/golden-streams/rig.ts";

async function hook(
  url: string,
  payload: Record<string, unknown>,
  event = "PreToolUse",
): Promise<{ block: string | null; notes: string[] }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "vyre/hook", params: { event, payload } }),
  });
  return ((await r.json()) as { result: { block: string | null; notes: string[] } }).result;
}
const INNER = {
  agent_id: "a3a1aa893f5f8d8fc",
  agent_type: "general-purpose",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_01JjsYgTJ6shuJra9a7uoRay",
  tool_input: { command: "echo nested-ok" },
};
const TOP = {
  hook_event_name: "PreToolUse",
  tool_name: "Agent",
  tool_use_id: "toolu_01M2VdAi4MEXhjNQYfsjhp1q",
  tool_input: { description: "x" },
};

test("a call with an agent_id asks the gate for that subagent; a call with none does not; a refusal is its stop and carries the reason", async () => {
  const asked: Array<{ subagent: string; tool?: string }> = [];
  let refuse: string | null = null;
  bindSubagentGate(async (c) => {
    asked.push({ subagent: c.subagent, ...(c.tool ? { tool: c.tool } : {}) });
    return { block: refuse, notes: refuse ? [] : ["Pine sent you a note"] };
  });
  const rig = await startMcp({ [TOKEN]: driverCaller() });
  try {
    const top = await hook(rig.url, TOP);
    assert.deepEqual(asked, [], "the main agent's own call is not a subagent's");
    assert.equal(top.block, null);
    const told = await hook(rig.url, INNER);
    assert.deepEqual(asked, [{ subagent: "a3a1aa893f5f8d8fc", tool: "Bash" }]);
    assert.deepEqual(told.notes, ["Pine sent you a note"]);
    refuse = "Stopped: Rubab asked it to stop.";
    const stopped = await hook(rig.url, INNER);
    assert.equal(stopped.block, "Stopped: Rubab asked it to stop.");
  } finally {
    bindSubagentGate(null);
    await rig.close();
  }
});

test("a gate that throws lets the call go: nothing stops by failing; with no gate bound nothing changes", async () => {
  bindSubagentGate(async () => {
    throw new Error("down");
  });
  const rig = await startMcp({ [TOKEN]: driverCaller() });
  try {
    assert.deepEqual(await hook(rig.url, INNER), { block: null, notes: [] });
    bindSubagentGate(null);
    assert.deepEqual(await hook(rig.url, INNER), { block: null, notes: [] });
  } finally {
    bindSubagentGate(null);
    await rig.close();
  }
});
