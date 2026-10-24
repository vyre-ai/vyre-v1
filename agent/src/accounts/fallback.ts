// Key failure fallback (spec 4.14, golden 10): a turn whose account fails is retried on the next usable account (the backup key), and when nothing is left the run waits in Needs you.
import { resolveAccount } from "./resolve.ts";
import type { NeedsYou, ResolveRequest, Resolution } from "./types.ts";

/** Provider errors that mean "this account cannot serve the turn". Anything else (bad request, context too long, content filter) is the same on every account and is surfaced. */
export const ACCOUNT_FAILURE_CODES: ReadonlySet<string> = new Set(["provider.auth_failed", "auth.expired", "provider.rate_limited"]);

export type FallbackDecision =
  /** Run the turn again on `accountRef`. `unblock` is an extra card for the person when their own account is the one that broke. */
  | { action: "use"; accountRef: string; payer: string; fallback: { kind: "backup_key"; to: string }; unblock?: NeedsYou; tried: Resolution["tried"] }
  /** Nothing usable is left: the turn waits (turn.waiting) and the owner gets an Unblock card. */
  | { action: "wait"; unblock: NeedsYou; tried: Resolution["tried"] }
  /** Not an account problem: another account would fail the same way. */
  | { action: "surface"; code: string };

export function onAccountFailure(req: ResolveRequest, failedRef: string, error: { code: string }): FallbackDecision {
  if (!ACCOUNT_FAILURE_CODES.has(error.code)) return { action: "surface", code: error.code };
  const next = resolveAccount({ ...req, unavailable: [...(req.unavailable ?? []), failedRef] });
  if (next.accountRef !== null && next.payer !== null) {
    const base = { action: "use" as const, accountRef: next.accountRef, payer: next.payer, fallback: { kind: "backup_key" as const, to: next.accountRef }, tried: next.tried };
    // The account that just failed is a problem the person should hear about even though a backup covers the turn.
    const failed = req.accounts.find((a) => a.ref === failedRef);
    const unblock = next.unblock ?? (failed?.mine === true ? ownCard(failed.ownerId ?? req.starter, failedRef, error.code) : undefined);
    return unblock ? { ...base, unblock } : base;
  }
  return { action: "wait", unblock: next.unblock ?? ownCard(req.starter, failedRef, error.code), tried: next.tried };
}

function ownCard(to: string, ref: string, code: string): NeedsYou {
  const expired = code === "auth.expired";
  return { kind: "unblock", to, ref, why: expired ? "expired" : "failed", next: [{ kind: expired ? "reconnect" : "open_settings", label: expired ? "Sign in again" : "Open AI settings" }] };
}
