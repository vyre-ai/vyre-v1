// A chat turn parked at the Gate (turn.waiting { task }) goes on once the person answers: approved, with what the call answered (the Gate keeps it on the hold), or turned down. Without this the
// turn would wait for ever, because the approval runs the held call but nothing told the engine. A host that does not hold the thread leaves it to the host that does (resume returns null).
import { boundEngine } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

interface GateEvent { name: string; payload: { holdId: string; taskId: string } }

export const gateResumeConsumers = {
  "engine.gate_resume": {
    on: ["gate.approved", "gate.denied", "gate.expired"],
    run: async (ctx: EngineCtx, event: GateEvent): Promise<{ skipped?: string; queued?: number | null }> => {
      let engine;
      try { engine = boundEngine(ctx); } catch { return { skipped: "engine_not_running" }; }
      const approved = event.name === "gate.approved";
      let result: { ok: boolean; content: unknown } | undefined;
      if (approved) {
        try {
          const got = (await ctx.call("gate.holds.get", { holdId: event.payload.holdId })) as { hold?: { result?: unknown } };
          if (got.hold?.result !== undefined) result = { ok: true, content: { data: got.hold.result } };
        } catch (e) {
          ctx.log.warn("the hold's answer could not be read, so the turn is told only that it was approved", { holdId: event.payload.holdId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { queued: engine.resume(event.payload.taskId, { approved, ...(result ? { result } : {}) }) };
    },
  },
};
