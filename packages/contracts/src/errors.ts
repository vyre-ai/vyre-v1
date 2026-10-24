// Global error catalogue (ARCHITECTURE-V1.md 3.2 and 4.8). Every `errors` entry of a capability must be in this list.
import type { ErrorCode, ErrorGroup, VyreError, NextStep, TraceContext } from './types.ts';

export interface ErrorCodeDef {
  code: ErrorCode;
  group: ErrorGroup;
  http: number;
  retryable: boolean;
  summary: string;
}

const e = (code: ErrorCode, http: number, retryable: boolean, summary: string): ErrorCodeDef => ({
  code, group: code.split('.')[0] as ErrorGroup, http, retryable, summary,
});

export const ERROR_CODES: ErrorCodeDef[] = [
  e('auth.unauthenticated', 401, false, 'No valid session for this call.'),
  e('auth.expired', 401, false, 'The session or token has expired.'),
  e('auth.device_revoked', 401, false, 'This device was revoked; the local copy is purged.'),
  e('auth.second_factor_required', 401, false, 'A second factor is required.'),
  e('auth.invalid_code', 401, false, 'The code or invite is wrong, used or expired.'),
  e('auth.bad_credentials', 401, false, 'Space, username or password is wrong.'),
  e('rate_limit.exceeded', 429, true, 'Too many calls; retry after the delay.'),
  e('validation.bad_input', 422, false, 'Input failed validation; JSON pointers in details.'),
  e('validation.unknown_capability', 422, false, 'No such capability or version.'),
  e('validation.not_found', 404, false, 'The thing does not exist.'),
  e('validation.duplicate', 422, false, 'A unique value already exists.'),
  e('validation.field_locked', 422, false, 'The field is locked (approval lock or system field).'),
  e('validation.version_conflict', 409, true, 'The row changed since it was read (base version mismatch).'),
  e('validation.precondition_failed', 422, false, 'A precondition for the action is not met.'),
  e('validation.too_large', 422, false, 'The payload or file is over the size limit.'),
  e('validation.unsupported', 422, false, 'The store or connector does not support this feature.'),
  e('provider.rate_limited', 502, true, 'The provider is rate limiting.'),
  e('provider.auth_failed', 502, false, 'The provider rejected the key or sign-in.'),
  e('provider.overloaded', 502, true, 'The provider is overloaded.'),
  e('provider.context_too_long', 502, false, 'The context is longer than the model accepts.'),
  e('provider.content_filtered', 502, false, 'The provider filtered the content.'),
  e('provider.network', 502, true, 'The provider could not be reached.'),
  e('provider.unavailable', 502, true, 'The provider or connected app is down.'),
  e('provider.bad_response', 502, false, 'The provider answered in an unexpected way.'),
  e('timeout.deadline', 504, true, 'The call took longer than its deadline.'),
  e('timeout.provider', 504, true, 'The provider did not answer in time.'),
  e('permission.no_grant', 403, false, 'No grant gives this person or agent access.'),
  e('permission.role_lacks_permission', 403, false, 'No role of the caller includes the permission.'),
  e('permission.above_clearance', 403, false, 'The label is above the caller clearance.'),
  e('permission.on_hold', 403, false, 'A hold blocks this change.'),
  e('permission.suspended', 403, false, 'The principal is suspended.'),
  e('permission.provider_label', 403, false, 'Restricted: not available to this AI provider.'),
  e('permission.limit', 403, false, 'A spend or usage limit stops the call.'),
  e('permission.plan_mode', 403, false, 'Plan mode: propose the change with plan_propose.'),
  e('permission.not_found', 404, false, 'Not found or not visible (existence is not leaked).'),
  e('permission.not_contained', 403, false, 'A delegated grant must stay inside its parent grant.'),
  e('permission.expired', 403, false, 'The grant or approval token expired.'),
  e('permission.revoked', 403, false, 'The grant or token was revoked.'),
  e('permission.guest_cannot_request', 403, false, 'Guests cannot request access.'),
  e('permission.needs_team', 403, false, 'Needs a Team Space (spec 2.1 Personal matrix).'),
  e('permission.needs_approval', 403, false, 'The act needs approval; the call is held as a task.'),
  e('internal.unexpected', 500, true, 'Unexpected error; the trace id has the stack.'),
  e('internal.not_implemented', 501, false, 'The capability is declared but its module is a stub.'),
  e('internal.unavailable', 503, true, 'The server is starting, stopping or read-only.'),
];

export const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES.map((c) => c.code));

export function notImplemented(cap: string, trace: Pick<TraceContext, 'traceId'>): VyreError {
  const next: NextStep[] = [{ kind: 'report', label: 'Report a problem' }];
  return {
    code: 'internal.not_implemented',
    message: 'This feature is not built yet.',
    next,
    retryable: false,
    traceId: trace.traceId,
    details: { cap },
  };
}

/** Thrown by handlers (and by generated not-implemented stubs); the gateway maps it to the HTTP status of its code. */
export class VyreErr extends Error {
  error: VyreError;
  constructor(error: VyreError) {
    super(error.message);
    this.name = 'VyreErr';
    this.error = error;
  }
}
