// A helper's node records the tool limits of its agent, also when the agent is private to the person it works for (rc.43: a read as the server was refused, the refusal was swallowed, and the node carried no limits).
import test from "node:test";
import assert from "node:assert/strict";
import { createNodeMirror } from "../node-mirror.ts";

test("a private agent's helper node carries the agent's tool limits, read as its person", async () => {
  const started: Array<Record<string, unknown>> = [];
  const readers: Array<string | undefined> = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    if (cap === "threads.get") return { thread: { kind: "helper", starter: "usr_olivia" } };
    if (cap === "agents.get") {
      readers.push(as);
      if (as !== "usr_olivia")
        throw Object.assign(new Error("That agent is private."), { code: "validation.not_found" });
      return { agent: { toolsAllowed: ["web_search"], toolsDenied: ["mail_send"] } };
    }
    if (cap === "runs.node.start") {
      started.push(input as Record<string, unknown>);
      return { node: { id: "run_1", status: "running", attempt: 1 } };
    }
    return {};
  };
  const mirror = createNodeMirror({ call });
  await mirror.turn({ id: "trn_1", threadId: "thr_h", agentId: "agt_private", asker: "usr_olivia" }, "started");
  assert.deepEqual(readers, ["usr_olivia"]);
  assert.deepEqual(started[0]?.["policy"], { tools: { allowed: ["web_search"], denied: ["mail_send"] } });
});

test("limits that cannot be read are recorded as unknown, never as none; an agent with no limits records nothing", async () => {
  const run = async (agents: (as?: string) => unknown): Promise<Record<string, unknown>> => {
    const started: Array<Record<string, unknown>> = [];
    const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
      if (cap === "threads.get") return { thread: { kind: "helper", starter: "usr_olivia" } };
      if (cap === "agents.get") return agents(as);
      if (cap === "runs.node.start") {
        started.push(input as Record<string, unknown>);
        return { node: { id: "run_1", status: "running", attempt: 1 } };
      }
      return {};
    };
    await createNodeMirror({ call }).turn(
      { id: "trn_u", threadId: "thr_h", agentId: "agt_x", asker: "usr_olivia" },
      "started",
    );
    return started[0]!;
  };
  const refused = (): never => {
    throw Object.assign(new Error("refused"), { code: "validation.not_found" });
  };
  assert.deepEqual((await run(refused))["policy"], { toolsUnknown: true });
  assert.deepEqual((await run(() => null))["policy"], { toolsUnknown: true });
  assert.equal((await run(() => ({ agent: {} })))["policy"], undefined, "no limits is not unknown");
});
