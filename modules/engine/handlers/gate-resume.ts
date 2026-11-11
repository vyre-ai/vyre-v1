// A chat turn parked at the Gate (turn.waiting { task }) goes on once the person answers: approved, with what the call answered (the Gate keeps it on the hold), or turned down. Without this the
// turn would wait for ever, because the approval runs the held call but nothing told the engine. A host that does not hold the thread leaves it to the host that does (resume returns null).
import { boundEngine, keepForRestart } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { openFor } from "../runtime.ts";

interface GateEvent { name: string; payload: { holdId: string; taskId: string; note?: string; askedBy?: unknown } }

export const gateResumeConsumers = {
  /** A question a turn parked on was answered or taken back: the wait is over. The agent hears the answer as a message, which is the one wake (chat tellAgent), so nothing is queued here. */
  "engine.question_release": {
    on: ["block.answered", "block.withdrawn"],
    run: async (ctx: EngineCtx, event: { name: string; payload: { blockId?: string } }): Promise<{ skipped?: string; released?: boolean }> => {
      if (typeof event.payload.blockId !== "string") return { skipped: "no_block" };
      let engine;
      try { engine = boundEngine(ctx); } catch { keepForRestart(); return { skipped: "engine_not_running" }; }
      return { released: engine.release(event.payload.blockId) };
    },
  },
  "engine.gate_resume": {
    on: ["gate.approved", "gate.denied", "gate.expired"],
    run: async (ctx: EngineCtx, event: GateEvent): Promise<{ skipped?: string; queued?: number | null }> => {
      // an outside agent asked its person (docs/ask-the-person.md): no turn here waits on it, and its answer is the outside agent's to take (modules/mcp)
      if (event.payload.askedBy !== undefined) return { skipped: "outside_ask" };
      let engine;
      try { engine = boundEngine(ctx); } catch { keepForRestart(); return { skipped: "engine_not_running" }; }
      // only a turn that parked on this hold (an API engine's) is resumed here; a CLI engine's held call over MCP ended its turn, and engine.hold_answered wakes it with the answer (held-notes.ts)
      try { if (ctx.db.all("SELECT 1 AS x FROM engine_waits WHERE task_id = ?", event.payload.taskId).length === 0) return { skipped: "no_parked_turn" }; } catch { /* the table is made with the first parked turn */ return { skipped: "no_parked_turn" }; }
      const approved = event.name === "gate.approved";
      let result: { ok: boolean; content: unknown } | undefined;
      if (approved) {
        try {
          const got = (await ctx.call("gate.result.take", { holdId: event.payload.holdId })) as { found?: boolean; result?: unknown };
          if (got.found === true) result = { ok: true, content: { data: got.result } };
        } catch (e) {
          ctx.log.warn("the hold's answer could not be read, so the turn is told only that it was approved", { holdId: event.payload.holdId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // a turned-down call tells the agent why when the person said: the reason is what they typed on Deny
      const note = event.name === "gate.denied" && typeof event.payload.note === "string" ? event.payload.note.trim() : "";
      if (!approved && note !== "") result = { ok: false, content: { code: "denied", message: `A person did not approve this: ${note}` } };
      // a server that restarted while the turn was parked has not opened its thread again: the wait row says whose it is
      await openFor(ctx, event.payload.taskId).catch((e: unknown) => ctx.log.warn("a parked turn's thread could not be opened", { taskId: event.payload.taskId, error: e instanceof Error ? e.message : String(e) }));
      return { queued: engine.resume(event.payload.taskId, { approved, ...(result ? { result } : {}) }) };
    },
  },
};
