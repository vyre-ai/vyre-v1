// The error a read-only device gets when it tries to write (spec 3.10: older apps show "update required" and go read-only).
import { VyreErr } from "../../../packages/contracts/src/errors.ts";

export function updateRequiredError(traceId: string, appVersion?: string): VyreErr {
  return new VyreErr({
    code: "permission.update_required",
    message: "This app is too old for this Space. You can still read everything. Update the app to make changes. Changes you made are kept.",
    retryable: false, traceId,
    next: [{ kind: "update_app", label: "Update the app" }],
    ...(appVersion ? { details: { appVersion } } : {}),
  });
}
