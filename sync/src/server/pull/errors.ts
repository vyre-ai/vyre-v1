// Typed errors of the pull and snapshot handlers. The gateway maps a VyreErr to the HTTP status of its code (contracts/errors.ts).
import { VyreErr } from "../../../../packages/contracts/src/errors.ts";
import type { ErrorCode } from "../../../../packages/contracts/src/types.ts";

export function pullError(code: ErrorCode, message: string, traceId: string, details?: Record<string, unknown>): VyreErr {
  return new VyreErr({
    code, message, retryable: code.startsWith("timeout."), traceId,
    next: [code.startsWith("timeout.") ? { kind: "retry", label: "Start the sync again" } : { kind: "reconnect", label: "Reconnect this device" }],
    ...(details ? { details } : {}),
  });
}
