// Saving finished work as an agent makes a new agent: through the one agent call, runs.ops, an agent that asks waits for a person's yes, a person's own press goes through, and nothing else the call does is held (r42-runtime).
// The real Gate condition (host/src/daemon/gate-hook.ts moduleWhens).
import test from "node:test";
import assert from "node:assert/strict";
import { moduleWhens } from "../host/src/daemon/gate-hook.ts";
import type { CtxSeed } from "../host/src/invoke.ts";

const when = moduleWhens(
  new Map(),
  () => null as never,
  async () => null,
) as Record<string, (input: unknown, seed: CtxSeed) => boolean | Promise<boolean>>;
const agent = { principal: { kind: "agent", id: "agt_1" } } as unknown as CtxSeed;
const person = { principal: { kind: "person", id: "usr_1" } } as unknown as CtxSeed;

test("runs.ops: save_as_agent is held for an agent and not for a person; every other action goes through for both", async () => {
  const g = when["runs.ops_gate"]!;
  assert.equal(await g({ action: "save_as_agent", id: "run_a1" }, agent), true);
  assert.equal(await g({ action: "save_as_agent", id: "run_a1" }, person), false);
  for (const a of [
    "tree",
    "tree_find",
    "node",
    "node_find",
    "compare",
    "events",
    "messages",
    "activity",
    "board",
    "message_send",
    "board_put",
    "board_answer",
    "control",
    "rerun",
    "budget",
  ])
    assert.equal(await g({ action: a, id: "run_a1" }, agent), false, `${a} is not held`);
  assert.equal(await g(null, agent), false, "no input holds nothing");
  assert.equal(await g({}, agent), false);
});
