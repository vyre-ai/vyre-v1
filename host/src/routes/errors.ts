// Building VyreError values for the gateway and the invoke pipeline (ARCH 4.8). One place maps a code to its HTTP status, retry flag and next steps, and a kernel decision to a permission.* code.
import { ERROR_CODES, ERROR_CODE_SET, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

export { VyreErr };
const BY_CODE = new Map(ERROR_CODES.map((d) => [d.code, d]));

const LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

export interface ErrOpts { message?: string; details?: Record<string, unknown>; next?: NextStep[]; cause?: VyreError["cause"] }

export function makeError(code: ErrorCode, traceId: string, o: ErrOpts = {}): VyreError {
  const def = BY_CODE.get(code) ?? BY_CODE.get("internal.unexpected")!;
  const err: VyreError = {
    code: def.code, message: o.message ?? def.what, retryable: def.retryable, traceId,
    next: o.next ?? def.next.map((kind) => ({ kind, label: LABEL[kind] })),
  };
  if (o.details) err.details = o.details;
  if (o.cause) err.cause = o.cause;
  return err;
}

export const httpOf = (code: string): number => BY_CODE.get(code as ErrorCode)?.http ?? 500;
export const isKnownCode = (code: string): code is ErrorCode => ERROR_CODE_SET.has(code);

/** The error a call ends with; carries the shaped error and its status. */
export class HostError extends Error {
  error: VyreError;
  http: number;
  constructor(error: VyreError) {
    super(error.message);
    this.name = "HostError";
    this.error = error;
    this.http = httpOf(error.code);
  }
}
export const fail = (code: ErrorCode, traceId: string, o?: ErrOpts): HostError => new HostError(makeError(code, traceId, o));

/** Kernel reason codes (ARCH 4.5.1) to error codes. `not_found` hides existence: permission.not_found, not validation.not_found. */
const REASON: Record<string, ErrorCode> = {
  no_grant: "permission.no_grant", expired: "permission.expired", revoked: "permission.revoked", not_contained: "permission.not_contained",
  role_lacks_permission: "permission.role_lacks_permission", above_clearance: "permission.above_clearance", on_hold: "permission.on_hold",
  suspended: "permission.suspended", provider_label: "permission.provider_label", limit: "permission.limit", needs_approval: "permission.needs_approval",
  not_found: "permission.not_found", agent_needs_actor: "permission.no_grant", not_a_member: "auth.unauthenticated", wrong_space: "permission.no_grant",
  bad_input: "validation.bad_input", unknown_action: "validation.unknown_capability",
};
export const codeForReason = (reason: string): ErrorCode => REASON[reason] ?? "permission.no_grant";

/** Anything a handler throws becomes a shaped error. VyreErr and HostError pass through (with this call's trace id); the rest is internal.unexpected and never leaks its message. */
export function toVyreError(e: unknown, traceId: string): { error: VyreError; unexpected: boolean } {
  if (e instanceof HostError) return { error: { ...e.error, traceId }, unexpected: false };
  if (e instanceof VyreErr) return { error: { ...e.error, traceId }, unexpected: false };
  return { error: makeError("internal.unexpected", traceId, { message: "Something went wrong on our side.", details: { traceId } }), unexpected: true };
}
