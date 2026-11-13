// A chat keeps its model across a restart that interrupts a tool-using turn (release gate, 12 Nov 2026: after such a restart every later turn went out with model "" and the provider answered
// 400 "`model` must be a non-empty string"). A booted daemon with the real engine; the model is a stand-in that records the model each turn's session was opened with. The restart is the
// server's own stop and start on the same data (as an update does), while a turn waits in the middle of a tool call.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

interface Seen {
  model: string | undefined;
  body: string;
  after: boolean;
}
const phase = { restarted: false, holdTool: false };
function model(): { open: OpenSession; seen: Seen[] } {
  const seen: Seen[] = [];
  const open: OpenSession = async (spec) => {
    const at = { model: (spec as { agent: { model?: string } }).agent.model };
    let toolResult = (): void => undefined;
    const answered = new Promise<void>((res) => {
      toolResult = res;
    });
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const body = String(input.trigger?.body ?? "");
        seen.push({ model: at.model, body, after: phase.restarted });
        if (/run the command/.test(body) && !phase.restarted) {
          // a tool call, then the turn waits in it: the server restarts here
          yield {
            type: "tool_call",
            id: "call_1",
            name: "terminal_run",
            input: { command: "sleep 30" },
          } as DriverEvent;
          await answered;
          if (phase.holdTool) await new Promise<void>(() => undefined);
        }
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult() {
        toolResult();
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as unknown as EngineSession;
  };
  return { open, seen };
}

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rm-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const dump = (d: Daemon, threadId: string): string => {
  const db = new DatabaseSync(d.paths.modules, { readOnly: true });
  const q = (sql: string): unknown => {
    try {
      return db.prepare(sql).all(threadId);
    } catch (e) {
      return String(e);
    }
  };
  return JSON.stringify({
    state: q("SELECT agent_id, model, provider, engine, account_ref FROM engine_agent_state WHERE thread_id = ?"),
    turns: q("SELECT model, state, error FROM engine_turns WHERE thread_id = ? ORDER BY started_at"),
    queue: q("SELECT qseq, state, touched FROM engine_thread_queue WHERE thread_id = ?"),
  });
};

const MODEL = "claude-sonnet-4-5"; // a model the connected Claude account lists (not a fixture default the engine would fall back to)

type How = "agent_default" | "picked_in_chat" | "agents_update";
async function scenario(how: How): Promise<void> {
  Object.assign(phase, { restarted: false, holdTool: true });
  const m = model();
  const dir = seededDir();
  let d = await boot(dir, m.open);
  let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  try {
    await connect(d);
    let agentId: string;
    if (how === "agent_default") {
      agentId = (await ok(d, "agents.create", { name: "Ops Desk", role: "You run commands.", model: MODEL })).agent
        .agentId as string;
    } else {
      agentId = (await newAgent(d, "Ops Desk")).id;
      if (how === "agents_update") await ok(d, "agents.update", { agentId, patch: { model: MODEL } });
    }
    const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [agentId] });
    const threadId = chat.thread.threadId as string;
    if (how === "picked_in_chat")
      await ok(d, "engine.set_model", { threadId, agentId, model: MODEL, provider: "anthropic" });
    const turns = (): Seen[] => m.seen.filter((s) => !/^The request:|^Today is/.test(s.body)); // the memory upkeep's own one-shots are not the chat's turns
    await ok(d, "chat.post", { threadId, body: "Say hello", mentions: [{ kind: "agent", id: agentId }] });
    await waitFor(
      async () => (turns().length >= 1 ? true : null),
      20_000,
      () => hostLog(d),
    );
    assert.equal(turns()[0]!.model, MODEL, `${how}: the chat runs on the model before the restart`);
    await ok(d, "chat.post", { threadId, body: "Please run the command", mentions: [{ kind: "agent", id: agentId }] });
    await waitFor(
      async () => (turns().some((s) => /run the command/.test(s.body)) ? true : null),
      20_000,
      () => hostLog(d),
    );
    await new Promise((r) => setTimeout(r, 1_500)); // the tool call is under way: the queue row says running, touched
    clearInterval(pumping);
    await Promise.race([d.stop(), new Promise((r) => setTimeout(r, 45_000))]);
    clock.t += 120_000;
    phase.restarted = true;
    d = await boot(dir, m.open);
    pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    await d.hooks!.runPeriodic("engine.runtime"); // boot recovery opens the thread first, as it does after an update
    await new Promise((r) => setTimeout(r, 2_000));
    for (const body of ["And now?", "One more"]) {
      await ok(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
      await waitFor(
        async () => (turns().some((s) => s.after && s.body === body) ? true : null),
        20_000,
        () => `${hostLog(d)} ${dump(d, threadId)}`,
      );
      assert.equal(
        turns().find((s) => s.after && s.body === body)!.model,
        MODEL,
        `${how}: "${body}" after the restart runs on the same model: ${dump(d, threadId)}`,
      );
    }
  } finally {
    clearInterval(pumping);
    await d.stop();
  }
}

for (const how of ["agent_default", "picked_in_chat", "agents_update"] as const) {
  test(
    `a restart in the middle of a tool call: every later turn runs on the same model as before (${how})`,
    { timeout: 180_000 },
    () => scenario(how),
  );
}
