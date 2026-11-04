// One handler per runs capability. Lifecycle, step log, waits and reads live in engine.ts; undo and its preview in undo.ts.
import { count, peopleCounts, finish, get, list, markWaitingCap, pinVersion, recordKey, recordStep, replay, resume, retry, start, status, steps, stop, waitFor } from "./engine.ts";
import { stepIo } from "./step-io.ts";
import { previewUndo, undo } from "./undo.ts";
import { erase, purge } from "./purge.ts";
import { agentsOfRun, withReversals } from "../../../lib/reversal.ts";

const base = {
  "runs.erase": erase,
  "runs.purge": purge,
  "runs.count": count,
  "runs.people_counts": peopleCounts,
  "runs.finish": finish,
  "runs.get": get,
  "runs.list": list,
  "runs.mark_waiting": markWaitingCap,
  "runs.pin_version": pinVersion,
  "runs.preview_undo": previewUndo,
  "runs.record_key": recordKey,
  "runs.record_step": recordStep,
  "runs.replay": replay,
  "runs.resume": resume,
  "runs.retry": retry,
  "runs.start": start,
  "runs.status": status,
  "runs.steps": steps,
  "runs.step_io": stepIo,
  "runs.stop": stop,
  "runs.undo": undo,
  "runs.wait_for": waitFor,
};

/** A person undoing what an agent's Run changed teaches that agent (lib/reversal.ts, memory.corrections.record): the agents that made the Run's writes, and the chat the Run came from. */
export const handlers = withReversals(base, {
  "runs.undo": {
    actOf: async (ctx: { call?(cap: string, input: unknown): Promise<unknown> }, i: { runId: string }) => agentsOfRun(ctx, i.runId),
    was: (_i: unknown, o: { undone?: { summary: string }[] }) => {
      const said = (o?.undone ?? []).map((u) => u.summary).filter((x) => x !== "").slice(0, 2).join("; ");
      return said === "" ? null : said.slice(0, 110);
    },
  },
});
