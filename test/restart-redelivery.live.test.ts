// Work that arrives while the server is stopping is done after it is back, once, without anyone sending it again (every update restarts the server).
// A booted daemon with the real engine, chat and goals; the model is a stand-in that records each turn. The engine is put in the state a stop leaves it in (its host half taken back, as the
// daemon's engine closer does) while the daemon still takes requests: a person's message and a new goal arrive then. The server restarts, and both turns run within a few seconds of it being
// back: the message's answer and the goal's first wake-up. Before, the goal's wake-up was answered "no engine" by its consumer and lost (the goal waited for its 45-minute retry).
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { hostSeams } from "../modules/engine/impl.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

interface Turn {
  agent: string;
  thread: string;
  body: string;
  goal: boolean;
  reason: string;
  at: number;
}
function recorder(): { open: OpenSession; turns: Turn[] } {
  const turns: Turn[] = [];
  const open: OpenSession = async () =>
    ({
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        turns.push({
          agent: input.agent.id,
          thread: String((input as { threadId?: unknown }).threadId ?? ""),
          body: String(input.trigger?.body ?? ""),
          goal: (input.context?.sections ?? []).some((s) => s.id === "goal"),
          reason:
            /You were woken because: ([^\n]*)/.exec(
              input.context?.sections.find((s) => s.id === "goal")?.text ?? "",
            )?.[1] ?? "",
          at: Date.now(),
        });
        yield { type: "text", text: "Done for now." };
        yield { type: "done" };
      },
      sendToolResult() {},
      inject() {},
      async cancel() {},
      async close() {},
    }) as unknown as EngineSession;
  return { open, turns };
}

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `rr-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test(
  "a message and a goal's wake-up that arrive while the server stops get their turns once the server is back, each once, within seconds",
  { timeout: 120_000 },
  async () => {
    const m = recorder();
    const dir = seededDir();
    let d = await boot(dir, m.open);
    let pumping = setInterval(() => void d.hooks?.pump?.(), 100);
    try {
      await connect(d);
      const agent = await newAgent(d, "Front Desk");
      const chat = await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] });
      const threadId = chat.thread.threadId as string;

      // the server is stopping: the engine's host half is taken back first, as the daemon's engine closer does; requests still land
      hostSeams.setEngineHost(null);
      await ok(d, "chat.post", {
        threadId,
        body: "Is the intake form ready?",
        mentions: [{ kind: "agent", id: agent.id }],
      });
      const made = await ok(d, "goals.create", {
        title: "Five intake forms",
        finish: {
          kind: "number",
          line: "Intake forms reach 5",
          target: 5,
          unit: "forms",
          source: { kind: "records", type: "contact", label: "Intake forms" },
        },
        deadline: clock.t + 4 * 86_400_000,
        leadAgentId: agent.id,
        rhythm: { every: "hours", hours: 6 },
        quiet: null,
        zone: "UTC",
        stuckAfter: 2,
        budget: { turns: 20 },
        permissions: [],
      });
      const goalThread = made.goal.threadId as string;
      await d.hooks!.pump();
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(m.turns.length, 0, "nothing runs while the engine is stopping");

      clearInterval(pumping);
      await d.stop();
      d = await boot(dir, m.open);
      pumping = setInterval(() => void d.hooks?.pump?.(), 100);
      const back = Date.now();

      // both turns run soon after the server is back: the answer to the message in its chat, the goal's first wake-up in the goal chat
      const why = (): string => `${hostLog(d)} ${JSON.stringify(m.turns)}`;
      // (the memory upkeep's own one-shot turns read the chat too; the agent's turns are the ones that count here)
      const answers = (): Turn[] => m.turns.filter((t) => t.agent === agent.id && t.body.includes("intake form ready"));
      const started = (): Turn[] =>
        m.turns.filter((t) => t.agent === agent.id && t.goal && t.reason === "the goal started");
      await waitFor(async () => (answers().length > 0 ? true : null), 10_000, why);
      await waitFor(async () => (started().length > 0 ? true : null), 10_000, why);
      assert.ok(
        answers()[0]!.at - back < 10_000 && started()[0]!.at - back < 10_000,
        "within seconds, not after a retry backoff",
      );
      const replies = await ok(d, "chat.messages.list", { threadId, limit: 50 });
      assert.equal(
        (replies.messages as Array<{ author: { kind: string } }>).filter((x) => x.author.kind === "agent").length,
        1,
        "the message is answered once",
      );
      const goal = await ok(d, "goals.get", { goalId: made.goal.id });
      assert.notEqual(goal.goal.threadId, undefined);
      assert.equal(goalThread, goal.goal.threadId);

      // exactly once: a second look a moment later finds no second turn for either
      await new Promise((r) => setTimeout(r, 1_500));
      await d.hooks!.pump();
      assert.equal(answers().length, 1, `the message got one turn: ${why()}`);
      // (a lead that ends its turn without a check-in is asked once more, "the last wake-up got no reply": that is the goal's own rule, not a second delivery)
      assert.equal(started().length, 1, `the goal's first wake-up got one turn: ${why()}`);
    } finally {
      clearInterval(pumping);
      await d.stop();
    }
  },
);
