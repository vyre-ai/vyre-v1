// The plain half of ui/States Loads: telling a failed read from a waiting one, and Retry as a window event the session answers by re-reading what is on screen. No React here, so the
// session can use it.

/** The window event Retry sends; the session re-reads what is on screen when it hears it. */
export const RETRY_LOADS_EVENT = "vyre:retry-loads";

/** Why a read failed, as the client's QueryState carries it. */
export interface LoadFailure {
  message: string;
  code?: string | undefined;
  traceId?: string | undefined;
}

/** A read the server refused: the person may not open it, or it is gone. Trying again cannot change that, so there is no Retry. (The server answers both with one code on purpose: it must not say whether a private thing exists.) */
export function isRefused(f: LoadFailure | undefined): boolean {
  const c = f?.code ?? "";
  return c.startsWith("permission.") || c === "validation.not_found";
}
/** What a refused read says beside "You can't open ...": true whether it was removed or never shared. */
/** The code of a failure that trying again cannot fix (hooks that cannot answer this read at all): the words are shown and there is no Retry. */
export const CANNOT_READ = "load.cannot_read";
export const BACK_LABEL = "Back to Chats";
export const REFUSED_CAUSE = "It may have been removed, or it is not shared with you.";

/** The first failure among these reads, or undefined while they are only waiting (or done). */
export function failureOf(
  ...states: ReadonlyArray<{ status: string; error?: LoadFailure | undefined } | null | undefined>
): LoadFailure | undefined {
  for (const s of states) if (s && s.status === "loading" && s.error !== undefined) return s.error;
  return undefined;
}

/** Ask the session to read again what is on screen. */
export function retryLoads(): void {
  const g = globalThis as {
    dispatchEvent?: (e: unknown) => boolean;
    CustomEvent?: new (t: string, i?: { detail?: unknown }) => unknown;
  };
  if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(RETRY_LOADS_EVENT));
}

/** Hear Retry: what the session uses to re-read its queries. Answers how to stop hearing it. */
export function onRetryLoads(listener: () => void): () => void {
  const g = globalThis as {
    addEventListener?: (t: string, l: () => void) => void;
    removeEventListener?: (t: string, l: () => void) => void;
  };
  g.addEventListener?.(RETRY_LOADS_EVENT, listener);
  return () => g.removeEventListener?.(RETRY_LOADS_EVENT, listener);
}

/** The window event a refusal's "Back to Chats" sends; the place that owns the list (Chats) hears it and shows its start. A place with no listener ignores it. */
export const BACK_TO_START_EVENT = "vyre:back-to-start";
export function backToStart(): void {
  const g = globalThis as {
    dispatchEvent?: (e: unknown) => boolean;
    CustomEvent?: new (t: string, i?: { detail?: unknown }) => unknown;
  };
  if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(BACK_TO_START_EVENT));
}
export function onBackToStart(listener: () => void): () => void {
  const g = globalThis as {
    addEventListener?: (t: string, l: () => void) => void;
    removeEventListener?: (t: string, l: () => void) => void;
  };
  g.addEventListener?.(BACK_TO_START_EVENT, listener);
  return () => g.removeEventListener?.(BACK_TO_START_EVENT, listener);
}

/** What the tab, the title or a quiet line should do with a failed read: a thing that is being made right now (this person just started it) is not refused yet, it is not readable yet. */
export function refusalFinal(failure: LoadFailure | undefined, madeJustNow: boolean): boolean {
  return isRefused(failure) && !madeJustNow;
}
