// A real chat turn is a turn in the list and moves the agent's status (booted daemon, chat, agents, engine, bridge and the hook runner live; the model vendor stand-in holds the reply until the test lets it go).
// The in-process turn engine runs the turn and mints its id; the bridge reports it to engine.turn.record, so while it runs engine.turns.list holds it as running and the agent is Working; when it ends the turn
// is completed with its tokens (and the same row the usage page counts), and the agent is no longer Working. A failed turn is listed as failed and also leaves Working. Each is recorded once.
import test from "node:test";
import assert from "node:assert/strict";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { boot, call, connect, newAgent, seededDir, waitFor, hostLog } from "./memory-live-kit.ts";

let release: () => void = () => {};
let gate: Promise<void> = Promise.resolve();
const hold = (): void => { gate = new Promise<void>((r) => { release = r; }); };

/** A stand-in that answers after the test lets it: "SLOW ..." waits for the gate, "FAIL ..." ends the turn with an error, anything else answers at once. Every answer reports 11 tokens in and 7 out. */
const slowIn: OpenSession = async () => ({
  warm: true,
  async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
    const body = String(input.trigger?.body ?? "");
    if (body.startsWith("SLOW")) await gate;
    if (body.startsWith("FAIL")) { yield { type: "error", code: "provider.unavailable", message: "the vendor is down" }; return; }
    yield { type: "text", text: "Done." };
    yield { type: "usage", inputTokens: 11, outputTokens: 7 };
    yield { type: "done" };
  },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
} as EngineSession);

test("a real chat turn is listed as running while it runs and the agent is Working, then completed with its tokens and the agent is not Working; a failed turn is listed too", async () => {
  const d = await boot(seededDir(), slowIn);
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const agent = await newAgent(d, "Keeper");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [agent.id], idempotencyKey: "tl-start" });
    const threadId = started.data.thread.threadId as string;
    const status = async (): Promise<string> => { await d.hooks?.pump?.(); return (await call(d, "agents.get", { agentId: agent.id })).data.agent.status as string; };
    const turns = async (): Promise<Array<{ turnId: string; state: string; tokensIn: number; tokensOut: number; agentId: string }>> => (await call(d, "engine.turns.list", { threadId })).data.turns;
    const post = async (body: string, key: string): Promise<void> => { assert.equal((await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agent.id }], idempotencyKey: key })).status, 200); };
    const replies = async (): Promise<number> => ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }>).filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "").length;

    // while the turn runs
    hold();
    await post("SLOW tell me", "tl-1");
    const running = await waitFor(async () => { const t = await turns(); return t.find((x) => x.state === "running") ?? null; }, 20_000, () => hostLog(d));
    assert.equal(running.agentId, agent.id);
    assert.equal(await status(), "working", "the agent is Working while its turn runs");
    assert.equal((await turns()).length, 1, "the turn is recorded once");

    // the turn ends
    release();
    await waitFor(async () => ((await replies()) >= 1 ? true : null), 20_000, () => hostLog(d));
    const done = await waitFor(async () => { const t = await turns(); return t.find((x) => x.state === "completed") ?? null; }, 20_000, () => hostLog(d));
    assert.equal(done.turnId, running.turnId, "the same turn, under the engine's own id");
    assert.deepEqual([done.tokensIn, done.tokensOut], [11, 7]);
    const usage = (await call(d, "engine.usage.query", { by: "agent", agentId: agent.id })).data.rows as Array<{ key: string; totals: { turns: number; tokensIn: number; tokensOut: number } }>;
    assert.deepEqual(usage.map((r) => [r.key, r.totals.turns, r.totals.tokensIn, r.totals.tokensOut]), [[agent.id, 1, 11, 7]], "the usage page counts the same turn");
    assert.notEqual(await status(), "working", "the agent is not Working once its turn ended");
    assert.equal((await turns()).length, 1, "ending it did not make a second row");
    assert.equal((await call(d, "engine.turn.get", { turnId: done.turnId })).data.what.turn.state, "completed");

    // a turn that fails
    await post("FAIL now", "tl-2");
    const failed = await waitFor(async () => { const t = await turns(); return t.find((x) => x.state === "failed") ?? null; }, 20_000, () => hostLog(d));
    assert.notEqual(failed.turnId, done.turnId);
    assert.notEqual(await status(), "working", "a failed turn also leaves Working");
    assert.deepEqual((await turns()).map((t) => t.state).sort(), ["completed", "failed"]);
  } finally { await d.stop(); }
});
