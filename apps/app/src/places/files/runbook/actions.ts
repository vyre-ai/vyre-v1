// What a press does in the runbook viewer: one capability call each. A failed call becomes words for the quiet line above the note, never a thrown error from a click.
import type { Call } from "./types.ts";
import { runError } from "./model.ts";
import type { Target } from "./model.ts";

export type Result = { ok: true; runId?: string } | { ok: false; error: string };

let seq = 0;
const key = (fileId: string, what: string, at: number): string => `rb:${fileId}:${what}:${at}:${++seq}`;

/** Run one block on the target. */
export async function runBlock(call: Call, o: { fileId: string; blockId: string; target: Target; versionId?: string; at: number }): Promise<Result> {
  try {
    const out = (await call("runbooks.run", { fileId: o.fileId, blockId: o.blockId, target: o.target, ...(o.versionId ? { versionId: o.versionId } : {}), idempotencyKey: key(o.fileId, o.blockId, o.at) })) as { runId: string };
    return { ok: true, runId: out.runId };
  } catch (e) { return { ok: false, error: runError(e) }; }
}

/** Run every block top to bottom; the kernel stops at the first error. */
export async function runAll(call: Call, o: { fileId: string; target: Target; versionId?: string; at: number }): Promise<Result> {
  try {
    const out = (await call("runbooks.run", { fileId: o.fileId, all: true, target: o.target, ...(o.versionId ? { versionId: o.versionId } : {}), idempotencyKey: key(o.fileId, "all", o.at) })) as { runId: string };
    return { ok: true, runId: out.runId };
  } catch (e) { return { ok: false, error: runError(e) }; }
}

/** Stop a run at the next safe point (runs.stop). */
export async function stopRun(call: Call, runId: string): Promise<Result> {
  try { await call("runs.stop", { runId }); return { ok: true }; } catch { return { ok: false, error: "Could not stop that run." }; }
}

/** Save where the runbook runs (the Runs on bar). */
export async function setTarget(call: Call, fileId: string, target: Target): Promise<Result> {
  try { await call("runbooks.set_target", { fileId, target }); return { ok: true }; } catch { return { ok: false, error: "Could not change where this runs." }; }
}
