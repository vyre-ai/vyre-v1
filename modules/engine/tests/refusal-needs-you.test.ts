// A routine whose agent is refused for something it can never do tells the person it works for, once, in Needs you (13 Nov 2026: 25 identical refusals in four days). The turn's tool layer asks, and the engine
// raises the line as that person. A chat never raises one.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError, makeError } from "../../../host/src/routes/errors.ts";
import { createEngineApiTools } from "../api-tools.ts";

function rig(kind: "run" | "chat") {
  const calls: Array<{ cap: string; as: string | undefined; input: unknown }> = [];
  const tools = createEngineApiTools({
    invoke: (async () => {
      throw new HostError(makeError("permission.above_clearance", "trace_x"));
    }) as never,
    space: "spc_1",
    system: async () => [],
    call: async (cap: string, input: unknown, as?: string) => {
      calls.push({ cap, as, input });
      if (cap === "threads.get") return { thread: { kind, mode: "auto" } };
      if (cap === "agents.get") return { agent: { name: "Dex" } };
      if (cap === "tasks.list") return { tasks: [] };
      return {};
    },
  });
  return { tools, calls };
}
const ctx = { threadId: "thr_1", agentId: "agt_dex", asker: "usr_dana", turnId: "trn_1" } as never;

test("a run's refusal opens one line for the person, as that person", async () => {
  const { tools, calls } = rig("run");
  await tools.runner({ id: "c1", name: "tasks_list", input: {} } as never, ctx);
  await new Promise((r) => setTimeout(r, 50));
  const made = calls.filter((c) => c.cap === "tasks.create");
  assert.equal(made.length, 1);
  assert.equal(made[0]?.as, "usr_dana");
  const body = made[0]?.input as { title: string; assigned: unknown };
  assert.match(body.title, /Dex/);
  assert.deepEqual(body.assigned, { kind: "person", id: "usr_dana" });
});

test("a chat's refusal raises no line: the person is told in the chat itself", async () => {
  const { tools, calls } = rig("chat");
  await tools.runner({ id: "c1", name: "tasks_list", input: {} } as never, ctx);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.filter((c) => c.cap === "tasks.create").length, 0);
});
