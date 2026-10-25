// The replay sandbox (spec 4.18, b9; ARCH 7.14): restore a copy of the Space at a given sequence number into a temp directory (events and the seed rules),
// replace sealed and Restricted values with synthetic ones unless the caller has clearance and asks to keep them, stub every outward capability (the call
// is recorded and answered with a stub, and nothing leaves), and re-run the failed Run or the sync conflict on the copy.
//
// It needs both server.logs and console.access. The copy is always removed, whatever the outcome.
//
// This is a function the host mounts for the Engineer MCP toolset and the Console, not a manifest capability: the contract is frozen, and a replay never
// writes to the Space it copies. The host supplies the copy; this module decides what may be seen in it and what may leave it (nothing).

import { failWith, scrubber } from "./submit.ts";
import type { ReportsCtx } from "./submit.ts";

export type ReplayTarget = { kind: "run"; runId: string } | { kind: "sync_conflict"; conflictId: string };

/** A sealed or Restricted value in the copy. `ref` names where it lives (a row field, a vault item) so it can be replaced in place. */
export interface ReplayValue { ref: string; kind: "sealed" | "restricted"; value: string }

/** One outward capability call (or an event marked replay:'stub') the re-run tried to make. */
export interface OutwardCall { cap: string; input: unknown }

export interface ReplayOutcome {
  /** how the re-run ended: the Run's state or the conflict's resolution */
  result: string;
  /** the step or rule that failed, when one did */
  failedAt?: string;
}

/** A restored copy of the Space. The host builds it in a temp directory and removes it in dispose(). */
export interface ReplayCopy {
  dir: string;
  /** every sealed and Restricted value the copy holds */
  values(): Promise<ReplayValue[]>;
  /** replace one value in the copy with another string */
  replace(ref: string, value: string): Promise<void>;
  /** Re-run the target on the copy. Every outward capability it calls goes through `outward`, and nothing else can leave the copy. */
  rerun(target: ReplayTarget, outward: (call: OutwardCall) => unknown): Promise<ReplayOutcome>;
  dispose(): Promise<void>;
}

export interface ReplayDrivers {
  restoreCopy(seq: number): Promise<ReplayCopy>;
}

let drivers: ReplayDrivers | null = null;
/** Wire (or, with null, unwire) the host's replay sandbox. */
export function configureReplay(d: ReplayDrivers | null): void {
  drivers = d;
}

export interface ReplayRequest {
  seq: number;
  target: ReplayTarget;
  /** Keep the real sealed and Restricted values. Allowed only for a caller who may reveal them. */
  keepValues?: boolean;
}

export interface ReplayResult {
  seq: number;
  target: ReplayTarget;
  outcome: ReplayOutcome;
  /** outward calls the re-run made, recorded and answered with a stub; none of them left the copy */
  stubbed: OutwardCall[];
  /** how many sealed and Restricted values were replaced */
  replaced: number;
  /** always 0: the number of outward calls that reached the world */
  sent: 0;
}

const hasPerm = (ctx: ReportsCtx, perm: string): boolean => ctx.authorize({ perm, level: "view" }, { type: "space", id: null }).effect === "allow";

/** A stand-in for a value that keeps its kind and length class, so the re-run still behaves like the real one (an email still looks like an email). */
export function synthetic(v: ReplayValue, n: number): string {
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.value)) return `person${n}@example.invalid`;
  if (/^\+?[\d\s().-]{7,}$/.test(v.value)) return `+1555000${String(n).padStart(4, "0")}`;
  return `${v.kind === "sealed" ? "sealed" : "restricted"}-value-${n}`;
}

/** A copy of a value with every string in it (and every key) passed through `fn`. */
function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [fn(k), mapStrings(x, fn)]));
  return v;
}

export async function replayRun(ctx: ReportsCtx, req: ReplayRequest): Promise<ReplayResult> {
  if (!drivers) return failWith(ctx.trace.traceId, "internal.unavailable", "The replay sandbox is not available on this server yet.", { service: "replay" });
  if (!hasPerm(ctx, "server.logs") || !hasPerm(ctx, "console.access")) {
    return failWith(ctx.trace.traceId, "permission.role_lacks_permission", "Replay needs access to the server logs and to the Console.");
  }
  if (!Number.isSafeInteger(req.seq) || req.seq < 0) return failWith(ctx.trace.traceId, "validation.bad_input", "Choose the sequence number to replay from.", { errors: ["seq: not a sequence number"] });
  if (req.keepValues === true && !hasPerm(ctx, "records.reveal")) {
    return failWith(ctx.trace.traceId, "permission.above_clearance", "Keeping the real values in a replay needs permission to reveal them.");
  }
  const copy = await drivers.restoreCopy(req.seq);
  try {
    const values = await copy.values();
    let replaced = 0;
    if (req.keepValues !== true) {
      let n = 0;
      for (const v of values) {
        n += 1;
        await copy.replace(v.ref, synthetic(v, n));
        replaced += 1;
      }
    }
    // Calls are recorded with their inputs scrubbed of any value the copy still holds (when values were kept, nothing is scrubbed: the caller may see them).
    const s = scrubber(req.keepValues === true ? [] : values.map((v) => v.value));
    const stubbed: OutwardCall[] = [];
    const outcome = await copy.rerun(req.target, (call) => {
      stubbed.push({ cap: call.cap, input: mapStrings(call.input ?? null, (t) => s.scrub(t)) });
      return { stubbed: true };
    });
    return { seq: req.seq, target: req.target, outcome, stubbed, replaced, sent: 0 };
  } finally {
    await copy.dispose();
  }
}
