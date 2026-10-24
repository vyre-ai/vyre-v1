// A fake host for the console-views tests. The module has no tables, so the world is a table of answers keyed by capability:
// a value is returned, a function is called with the input, an Error is thrown (a source the caller may not read).
import type { ViewCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_test";
export const DAY = 86_400_000;

export type Answer = unknown | Error | ((input: Record<string, unknown>) => unknown);
export interface World { ctx: ViewCtx; calls: { cap: string; input: Record<string, unknown> }[]; answers: Map<string, Answer>; allow: Set<string> }

export function world(answers: Record<string, Answer> = {}, allow: string[] = ["console.access"]): World {
  const map = new Map<string, Answer>(Object.entries(answers));
  const calls: World["calls"] = [];
  const allowed = new Set(allow);
  const ctx = {
    space: SPACE,
    principal: { kind: "person", id: "usr_admin" },
    trace: { traceId: TRACE, spanId: "abcdef0123456789" },
    now: () => NOW,
    async call(cap: string, input: unknown) {
      const inp = (input ?? {}) as Record<string, unknown>;
      calls.push({ cap, input: inp });
      const a = map.get(cap);
      if (a === undefined) throw new Error(`no answer for ${cap}`);
      if (a instanceof Error) throw a;
      return typeof a === "function" ? (a as (i: Record<string, unknown>) => unknown)(inp) : a;
    },
    authorize(action: { perm: string | null }) {
      return { effect: allowed.has(action.perm ?? "") ? "allow" : "deny", reason: "test", decisionId: "dec_test" };
    },
  } as unknown as ViewCtx;
  return { ctx, calls, answers: map, allow: allowed };
}

export const healthy = { overall: "healthy", checks: [{ key: "sync.lag", title: "Sync lag", state: "healthy", checkedAt: NOW - 1000, module: "sync", next: "Nothing to do." }] };
export const certOk = { address: "maya.vyre.run", mode: "relay", certificate: { host: "maya.vyre.run", expiresAt: NOW + 60 * DAY, state: "healthy" }, publicIngress: true };
export const quiet: Record<string, Answer> = {
  "health.status": healthy,
  "network.status": certOk,
  "updates.status": { current: "1.0.0", channel: "stable", lastResult: "ok" },
  "runs.list": { runs: [] },
  "access.reviews.list": { reviews: [] },
  "audit.list": { rows: [] },
  "engine.usage.query": { rows: [], totals: { turns: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 } },
  "access.principals.list": { principals: [], total: 0 },
};

export function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  return (e as { error?: { code?: string } }).error?.code;
}
