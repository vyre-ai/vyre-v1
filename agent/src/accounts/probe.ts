// probe_account: "test this account". Asks the provider for its model list with no Space data. A sign-in or key problem marks the account; a network blip does not.
import type { AccountRow, AccountStatus } from "./types.ts";

export interface ProbeError { code: string; message: string }
export interface ProbeResult { ok: boolean; models?: number; error?: ProbeError }

export interface ProbeDeps {
  find(ref: string): AccountRow | undefined;
  /** Run the provider call for this account (models list, or a CLI whoami). */
  run(row: AccountRow): Promise<ProbeResult>;
  record(ref: string, status: AccountStatus, at: number): void | Promise<void>;
  now(): number;
}

export class UnknownAccount extends Error {
  readonly ref: string;
  constructor(ref: string) { super("no such account"); this.name = "UnknownAccount"; this.ref = ref; }
}

/** Sign-in and key problems change the status; transient ones (network, overloaded) are reported but leave it alone. */
export function statusAfter(row: AccountRow, r: ProbeResult): AccountStatus | null {
  if (r.ok) return "ok";
  const code = r.error?.code ?? "";
  if (code === "auth.expired" || (code === "provider.auth_failed" && row.kind === "subscription")) return "expired";
  if (code === "provider.auth_failed") return "failed";
  return null;
}

export async function probeAccount(deps: ProbeDeps, ref: string): Promise<ProbeResult> {
  const row = deps.find(ref);
  if (!row) throw new UnknownAccount(ref);
  let result: ProbeResult;
  try { result = await deps.run(row); }
  catch { result = { ok: false, error: { code: "provider.network", message: "Could not reach the provider." } }; }
  const next = statusAfter(row, result);
  if (next !== null) await deps.record(ref, next, deps.now());
  return result;
}
