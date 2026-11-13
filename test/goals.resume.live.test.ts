// A goal that was paused and resumed must really wake its lead on the API engine: after Resume the model is called for the wake and the lead's turn runs.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const DAY = 86_400_000;
test("goals live (API engine): Resume after Pause and typed turns wakes the lead and the model really runs for it", { timeout: 120_000 }, async () => {
  const sent: string[] = [];
  const open: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const goal = input.context?.sections.find((s) => s.id === "goal")?.text ?? "";
      const body = String(input.trigger?.body ?? "");
      sent.push(body.startsWith("hello") ? `message:${body}` : /You were woken because: ([^\n]*)/.exec(goal)?.[1] ?? `other:${body.slice(0, 20)}`);
      yield { type: "text", text: "ok" }; yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(seededDir(), open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  try {
    await connect(d);
    const lead = await newAgent(d, "Dex");
    const ok = async (cap: string, input: Record<string, unknown>): Promise<any> => { const r = await call(d, cap, { idempotencyKey: `rs-${cap}-${Math.random().toString(36).slice(2, 8)}`, ...input }); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const made = await ok("goals.create", { title: "3 registrations", finish: { kind: "number", line: "reach 3", target: 3, unit: "registrations", source: { kind: "records", type: "contact", label: "r" } }, deadline: clock.t + 4 * DAY, leadAgentId: lead.id, rhythm: { every: "hours", hours: 6 }, quiet: null, zone: "UTC", budget: { turns: 60 } });
    const goalId = made.goal.id as string, threadId = made.goal.threadId as string;
    await waitFor(async () => (sent.some((s) => /goal started/.test(s)) ? true : null), 60_000, () => hostLog(d));
    for (const n of [1, 2]) { await ok("chat.post", { threadId, body: `hello ${n}`, mentions: [{ kind: "agent", id: lead.id }] }); await waitFor(async () => (sent.filter((s) => s.startsWith("message:")).length >= n ? true : null), 60_000, () => hostLog(d)); }
    await new Promise((r) => setTimeout(r, 1500));
    const before = sent.length;
    await ok("goals.pause", { goalId });
    await ok("goals.resume", { goalId });
    await waitFor(async () => (sent.slice(before).some((s) => /goal was resumed/.test(s)) ? true : null), 60_000, () => `${hostLog(d)} ${JSON.stringify({ sent, wakes: new DatabaseSync(d.paths.modules, { readOnly: true }).prepare("SELECT reason, state FROM goals_wake").all(), queue: new DatabaseSync(d.paths.modules, { readOnly: true }).prepare("SELECT kind, state FROM engine_thread_queue").all() })}`);
  } finally { clearInterval(pumping); await d.stop(); }
});
