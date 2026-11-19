// r42-runtime on a booted daemon, only the model scripted: a helper told to start after another waits (its node queued behind it, its model not called), starts when that one has succeeded, and fails with it, never starting, when that one fails.
import test from "node:test";
import assert from "node:assert/strict";
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
} from "./support/eco-live.ts";

test("a helper that depends on another waits, then starts; one whose dependency fails fails and never starts", async () => {
  const calls: Record<string, number> = { ALPHA: 0, BETA: 0, GAMMA: 0, DELTA: 0 };
  let release!: () => void;
  const alphaGo = new Promise<void>((r) => (release = r));
  const model = scriptedModel(async function* (input) {
    const body = String(input.trigger?.body ?? "");
    if (/HOLD/.test(body)) await new Promise<void>(() => undefined); // the lead's turn stays open: it is the job the helpers belong to
    for (const k of Object.keys(calls)) if (body.includes(k)) calls[k] = (calls[k] ?? 0) + 1;
    if (body.includes("ALPHA")) {
      await alphaGo;
      yield { type: "text", text: "alpha done" };
    } else if (body.includes("GAMMA")) {
      yield { type: "error", code: "model.failed", message: "gamma could not finish" };
      return;
    } else if (/BETA|DELTA/.test(body)) {
      yield { type: "text", text: "done" };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Lead");
    const chat = await startChat(d, agent, "hw");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hw-auto" });
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD the job",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "hw-hold",
    });
    const lead = await waitFor(async () => {
      const rows = (await ok(d, "runs.activity.list", {})).rows as Array<{
        runId: string;
        kind: string;
        status: string;
      }>;
      return rows.find((r) => r.kind === "turn" && r.status === "running") ?? null;
    }, 20_000);
    const start = (title: string, instruction: string, dependsOn?: string[]) =>
      ok(d, "chat.helper.start", {
        threadId: chat,
        title,
        instruction,
        agentId: agent,
        ...(dependsOn ? { dependsOn } : {}),
        idempotencyKey: `hw-${title}`,
      });
    const nodes = async (): Promise<Array<{ id: string; name?: string; status: string; dependsOn?: string[] }>> =>
      (await ok(d, "runs.tree.get", { runId: lead.runId })).nodes;
    const named = async (name: string) => (await nodes()).find((n) => n.name === name);

    await start("Alpha", "ALPHA: add the figures");
    const alpha = await waitFor(async () => {
      const n = await named("Alpha");
      return n?.status === "running" ? n : null;
    }, 20_000);
    await start("Beta", "BETA: write it up", ["Alpha"]);
    const beta = await waitFor(async () => (await named("Beta")) ?? null, 20_000);
    assert.equal(beta.status, "queued", "it waits");
    assert.deepEqual(beta.dependsOn, [alpha.id], "and the node says for what");
    await new Promise((r) => setTimeout(r, 3_000));
    assert.equal(calls["BETA"], 0, "its model was not called while Alpha works");

    release();
    await waitFor(async () => ((await named("Beta"))?.status === "succeeded" ? true : null), 30_000);
    assert.equal(calls["BETA"], 1, "it started once Alpha was done");
    assert.equal((await named("Alpha"))?.status, "succeeded");

    await start("Gamma", "GAMMA: this one fails");
    await start("Delta", "DELTA: after gamma", ["Gamma"]);
    await waitFor(async () => ((await named("Gamma"))?.status === "failed" ? true : null), 30_000);
    const delta = await waitFor(async () => {
      const n = await named("Delta");
      return n?.status === "failed" ? n : null;
    }, 30_000);
    assert.equal(delta.status, "failed", "a helper whose dependency failed fails with it");
    assert.equal(calls["DELTA"], 0, "and never started");
  } finally {
    await stop(d);
  }
});
