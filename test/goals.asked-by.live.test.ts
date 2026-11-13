// The owner asks an agent to change a goal, on a booted daemon: chat, engine, bridge, goals, access and the Gate are real, the model is a stand-in that calls the goal tool its message names.
// The nested call goals.update/extend -> engine.turn.asked_by is the real one (ctx.thread, the agent principal and depth come from the server). The API-engine path; the CLI engine over MCP is
// host/tests/goals.asked-by.cli.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const DAY = 86_400_000;
let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ab-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

interface Result { turn: string; tool: string; ok: boolean; content: unknown }
function stand(): { open: OpenSession; results: Result[] } {
  const results: Result[] = [];
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let n = 0;
    const found = new Set<string>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const body = String(input.trigger?.body ?? "");
        const goal = input.context?.sections.find((s) => s.id === "goal")?.text ?? "";
        async function* use(tool: string, args: Record<string, unknown>, label: string): AsyncGenerator<DriverEvent> {
          if (!found.has(tool)) {
            const id = `c${++n}`;
            const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
            yield { type: "tool_call", id, name: "tool_search", input: { query: tool } };
            await p; found.add(tool);
          }
          const id = `c${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name: tool, input: args };
          const r = await p;
          results.push({ turn: label, tool, ok: r.ok, content: r.content });
        }
        const m = /EXTEND (gol_[a-z0-9]+) (\d+)/.exec(body);
        if (m) yield* use("goals_extend", { goalId: m[1]!, deadline: Number(m[2]) }, "asked");
        else if (goal) {
          // the goal's own wake-up: nobody asked, so the owner's controls must be refused
          const goalId = /goalId (gol_[a-z0-9]+)/.exec(goal)?.[1];
          // every other turn of the lead (a line posted when the owner presses a card, a retry) tries the same, so what the server counts as asked is what the test sees
          if (goalId) yield* use("goals_extend", { goalId, deadline: clock.t + 30 * DAY }, results.some((r) => r.turn === "wake") ? `other:${body.slice(0, 30)}` : "wake");
        }
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
      inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
  return { open, results };
}

test("goals live (API engine): the owner asks an agent in another chat to move the deadline and it does, logged with the asking message; a goal wake and a poke are refused", { timeout: 120_000 }, async () => {
  const m = stand();
  const d = await boot(seededDir(), m.open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  try {
    await connect(d);
    const desk = await newAgent(d, "Lab Desk");
    const dex = await newAgent(d, "Dex");
    const made = await ok(d, "goals.create", {
      title: "3 registrations for Lab 8", finish: { kind: "number", line: "Lab 8 registrations reach 3", target: 3, unit: "registrations", source: { kind: "records", type: "contact", label: "Lab 8 registrations" } },
      deadline: clock.t + 4 * DAY, leadAgentId: desk.id, rhythm: { every: "hours", hours: 6 }, quiet: null, zone: "UTC", budget: { turns: 60 },
    });
    const goalId = made.goal.id as string;
    const first = made.goal.deadline as number;

    // the goal's own wake-up asks for the owner's controls and is refused: nobody asked
    const woke = await waitFor(async () => m.results.find((r) => r.turn === "wake") ?? null, 60_000, () => hostLog(d));
    assert.equal(woke.ok, false, JSON.stringify(woke.content));
    assert.match(JSON.stringify(woke.content), /owner_only|Only the owner/);
    assert.equal((await ok(d, "goals.get", { goalId })).goal.deadline, first);

    // the owner asks Dex, in a chat of their own, in their own words
    const started = await ok(d, "chat.start", { kind: "chat", agentIds: [dex.id] });
    const threadId = started.thread.threadId as string;
    const later = first + 5 * DAY;
    const posted = await ok(d, "chat.post", { threadId, body: `EXTEND ${goalId} ${later}`, mentions: [{ kind: "agent", id: dex.id }] });
    const asked = await waitFor(async () => m.results.find((r) => r.turn === "asked") ?? null, 60_000, () => `${hostLog(d)} ${JSON.stringify(m.results)}`);
    assert.equal(asked.ok, true, JSON.stringify(asked.content));
    const got = await ok(d, "goals.get", { goalId });
    assert.equal(got.goal.deadline, later);
    const row = (got.activity as Array<{ kind: string; by?: string; ref?: string; tpl?: string }>).find((a) => a.kind === "extended")!;
    assert.match(row.by ?? "", new RegExp(`^${dex.id}>usr_`));
    assert.equal(row.ref, posted.message.messageId);
    assert.match(row.tpl ?? "", /moved the deadline to \{at:\d+\}, asked by \{who:usr_/);

    // a poke is a line the server posts, never the owner's own typed ask
    await ok(d, "threads.poke", { threadId, agentId: dex.id, note: `EXTEND ${goalId} ${later + DAY}` });
    const poked = await waitFor(async () => (m.results.filter((r) => r.turn === "asked").length >= 2 ? m.results.filter((r) => r.turn === "asked")[1]! : null), 60_000, () => hostLog(d));
    assert.equal(poked.ok, false, JSON.stringify(poked.content));
    assert.equal((await ok(d, "goals.get", { goalId })).goal.deadline, later, "the poke changed nothing");

    // the owner presses Pause on the goal card: the card is posted as the owner by the server, not typed, so the lead's turn it may start is not asked
    await ok(d, "goals.pause", { goalId });
    // wait for the lead's turn the press starts (the thing, not a fixed time), and require that one ran: the check is empty without it
    await waitFor(async () => (m.results.some((r) => r.turn.startsWith("other")) ? true : null), 60_000, () => `${hostLog(d)} ${JSON.stringify(m.results)}`);
    const others = m.results.filter((r) => r.turn.startsWith("other"));
    assert.ok(others.length >= 1, "a lead turn ran after the Pause press");
    assert.ok(others.every((r) => !r.ok), `a turn nobody asked for changed the goal: ${JSON.stringify(others)}`);
    assert.equal((await ok(d, "goals.get", { goalId })).goal.deadline, later);
    console.log(`lead turns after the Pause press that tried the owner's controls: ${others.length}`);
  } finally {
    clearInterval(pumping);
    await d.stop();
  }
});
