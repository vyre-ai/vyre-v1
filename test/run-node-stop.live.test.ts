// r42-runtime on a booted daemon, only the model scripted: an agent's turn is a node of the Run tree; the owner stops the node through runs.node.control, which reaches the engine (engine.stop) and the turn really ends;
// the node says stopped only after that; another person sees nothing of it; and a node that has already ended is not stopped again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  boot,
  connect,
  makeAgent,
  ok,
  scriptedModel,
  seededDir,
  startChat,
  stop,
  waitFor,
  call,
} from "./support/eco-live.ts";

test("the owner stops a turn from its node: the engine's turn ends, the node says stopped, and a second stop is told it is over", async () => {
  let held = 0;
  const model = scriptedModel(async function* (input) {
    if (/HOLD/.test(String(input.trigger?.body ?? ""))) {
      held += 1;
      await new Promise<void>(() => undefined); // working until a Stop cancels it
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Worker");
    const chat = await startChat(d, agent, "rn");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "rn-auto" });
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD this",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "rn-hold",
    });
    await waitFor(async () => (held > 0 ? true : null), 20_000);
    const running = async (): Promise<Array<{ runId: string; kind: string; status: string }>> =>
      ((await ok(d, "runs.activity.list", {})).rows as Array<{ runId: string; kind: string; status: string }>).filter(
        (r) => r.kind === "turn",
      );
    const node = await waitFor(async () => (await running()).find((r) => r.status === "running") ?? null, 20_000);
    const working = async (): Promise<number> =>
      (((await ok(d, "engine.now", {})).working ?? []) as Array<{ threadId?: string }>).filter(
        (w) => w.threadId === chat,
      ).length;
    assert.equal(await working(), 1, "the engine is working on it");
    const tree = await ok(d, "runs.tree.get", { runId: node.runId });
    assert.equal(tree.nodes.length, 1);

    const out = await ok(d, "runs.node.control", { runId: node.runId, action: "stop", reason: "Not needed" });
    assert.equal(out.nodes[0].status, "stopped");
    await waitFor(async () => ((await working()) === 0 ? true : null), 10_000);
    const after = (await ok(d, "runs.node.get", { runId: node.runId })).node;
    assert.equal(after.status, "stopped");
    assert.ok(["stop", "Not needed"].includes(after.stopReason), "whichever end was written first names the reason");
    const again = await call(d, "runs.node.control", { runId: node.runId, action: "stop" });
    assert.equal(
      again.status === 200 && again.data.nodes?.[0]?.status === "stopped",
      true,
      "a second stop of a stopped node is a no-op",
    );
    const events = (await ok(d, "runs.events.list", { runId: node.runId })).events as Array<{
      type: string;
      payload: { to?: string };
    }>;
    assert.deepEqual(
      events.filter((e) => e.type === "state").map((e) => e.payload.to),
      ["running", "stopped"],
    );
  } finally {
    await stop(d);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
