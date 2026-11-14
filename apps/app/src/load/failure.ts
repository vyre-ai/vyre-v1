import type { LoadFailure } from "../../../../ui/src/States/Loads.tsx";

/** Why a call failed, as a LoadFailure: its message (never empty), its code and its trace id. */
export function failureFrom(err: unknown): LoadFailure {
  const o = (typeof err === "object" && err !== null ? err : {}) as {
    message?: unknown;
    code?: unknown;
    traceId?: unknown;
  };
  return {
    message: typeof o.message === "string" && o.message !== "" ? o.message : "The read failed.",
    ...(typeof o.code === "string" ? { code: o.code } : {}),
    ...(typeof o.traceId === "string" && o.traceId !== "" ? { traceId: o.traceId } : {}),
  };
}
