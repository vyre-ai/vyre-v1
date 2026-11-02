// The plain half of ui/States Loads: telling a failed read from a waiting one, and Retry as a window event the session answers by re-reading what is on screen. No React here, so the
// session can use it.

/** The window event Retry sends; the session re-reads what is on screen when it hears it. */
export const RETRY_LOADS_EVENT = "vyre:retry-loads";

/** Why a read failed, as the client's QueryState carries it. */
export interface LoadFailure { message: string; code?: string | undefined; traceId?: string | undefined }

/** The first failure among these reads, or undefined while they are only waiting (or done). */
export function failureOf(...states: ReadonlyArray<{ status: string; error?: LoadFailure | undefined } | null | undefined>): LoadFailure | undefined {
  for (const s of states) if (s && s.status === "loading" && s.error !== undefined) return s.error;
  return undefined;
}

/** Ask the session to read again what is on screen. */
export function retryLoads(): void {
  const g = globalThis as { dispatchEvent?: (e: unknown) => boolean; CustomEvent?: new (t: string, i?: { detail?: unknown }) => unknown };
  if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(RETRY_LOADS_EVENT));
}

/** Hear Retry: what the session uses to re-read its queries. Answers how to stop hearing it. */
export function onRetryLoads(listener: () => void): () => void {
  const g = globalThis as { addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void };
  g.addEventListener?.(RETRY_LOADS_EVENT, listener);
  return () => g.removeEventListener?.(RETRY_LOADS_EVENT, listener);
}

