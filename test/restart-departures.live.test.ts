// An agent paused or deleted while the server stops does not take its queued turn after the restart. The pause and the delete are stored when they are made; the events that tell the engine
// (agent.paused, agent.deleted) are delivered only by the next start, and boot recovery may reach the agent's queued turn first: the engine's admission (agents.status, runtime.ts admission) must
// refuse it before any model call.
// A booted daemon with the real engine and agents; the model is a stand-in that holds each agent's first turn, so a second message waits in the queue when the server stops.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { hostSeams } from "../modules/engine/impl.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

interface Sent { agent: string; body: string; after: boolean }
const phase = { restarted: false };
function holder(): { open: OpenSession; sent: Sent[] } {
  const sent: Sent[] = [];
  const open: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      sent.push({ agent: input.agent.id, body: String(input.trigger?.body ?? ""), after: phase.restarted });
      if (!phase.restarted) await new Promise<void>(() => undefined);   // held: the next message waits in the queue
      yield { type: "text", text: "Done." };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as unknown as EngineSession);
  return { open, sent };
}

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rd-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test("an agent paused, and one deleted, while the server stops take none of their queued turns after the restart; an active agent takes its own", { timeout: 120_000 }, async () => {
  const m = holder();
  const dir = seededDir();
  let d = await boot(dir, m.open);
  let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  try {
    await connect(d);
    const paused = await newAgent(d, "Night Desk");
    const deleted = await newAgent(d, "Old Desk");
    const control = await newAgent(d, "Day Desk");   // active: its queued turn must run after the restart, so recovery did happen
    for (const a of [paused, deleted, control]) {
      const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [a.id] });
      const threadId = chat.thread.threadId as string;
      await ok(d, "chat.post", { threadId, body: "First question", mentions: [{ kind: "agent", id: a.id }] });
      await waitFor(async () => (m.sent.some((s) => s.agent === a.id) ? true : null), 20_000, () => hostLog(d));
      await ok(d, "chat.post", { threadId, body: "Second question, queued", mentions: [{ kind: "agent", id: a.id }] });
    }
    // the server is stopping: the engine goes first, and the pause and the delete land in that window (their events wait for the next start)
    hostSeams.setEngineHost(null);
    await ok(d, "agents.pause", { agentId: paused.id, reason: "Paused for the night" });
    await ok(d, "agents.delete", { agentId: deleted.id });
    clearInterval(pumping);
    await d.stop();
    clock.t += 120_000;   // the stopped host's thread leases have run out, so recovery takes the threads at once
    phase.restarted = true;
    d = await boot(dir, m.open);
    pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    await d.hooks!.runPeriodic("engine.runtime");   // the recovery sweep, as the scheduler runs it every few seconds
    await waitFor(async () => (m.sent.some((s) => s.after && s.agent === control.id) ? true : null), 20_000, () => `${hostLog(d)} ${JSON.stringify(m.sent)}`);
    await new Promise((r) => setTimeout(r, 2_000));
    await d.hooks!.pump();
    const after = m.sent.filter((s) => s.after && (s.agent === paused.id || s.agent === deleted.id)).map((s) => [s.agent === paused.id ? "paused" : s.agent === deleted.id ? "deleted" : s.agent, s.body]);
    // (the memory upkeep's own one-shot turns read the chats too; they are not the agents' turns)
    assert.deepEqual(after, [], `no turn ran for the paused or the deleted agent after the restart: ${JSON.stringify(after)} ${hostLog(d)}`);
  } finally { clearInterval(pumping); await d.stop(); }
});
