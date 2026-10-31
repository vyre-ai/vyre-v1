// A chat turn parked at the Gate (turn.waiting { task }) goes on once the person answers: approved, with what the call answered (the Gate keeps it on the hold), or turned down. Without this the
// turn would wait for ever, because the approval runs the held call but nothing told the engine. A host that does not hold the thread leaves it to the host that does (resume returns null).
import { boundEngine } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

interface GateEvent { name: string; payload: { holdId: string; taskId: string; note?: string } }

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
          const got = (await ctx.call("gate.result.take", { holdId: event.payload.holdId })) as { found?: boolean; result?: unknown };
          if (got.found === true) result = { ok: true, content: { data: got.result } };
        } catch (e) {
          ctx.log.warn("the hold's answer could not be read, so the turn is told only that it was approved", { holdId: event.payload.holdId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // a turned-down call tells the agent why when the person said: the reason is what they typed on Deny
      const note = event.name === "gate.denied" && typeof event.payload.note === "string" ? event.payload.note.trim() : "";
      if (!approved && note !== "") result = { ok: false, content: { code: "denied", message: `A person did not approve this: ${note}` } };
      return { queued: engine.resume(event.payload.taskId, { approved, ...(result ? { result } : {}) }) };
    },
  },
};
