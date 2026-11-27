// Opening a Space the first time on this page (rc.44): a network-level failure of the first read ("Failed to fetch": the connection was reset or refused as the page began, which a busy machine does now and
// then) is tried again by itself, once, a moment later, before the shell says it could not reach the Space. An answer from the Space (a refusal, a 401) is never tried again here, and neither is
// anything that is not a failed fetch.
import { CapError } from "../../../../../client/src/gateway/index.ts";

/** The wait before the one try again (a connection reset on a reused connection is gone by then; a Space that is really down is shown a third of a second later). */
export const OPEN_RETRY_MS = [300] as const;

/** How long to wait before trying again, or null when this failure is to be shown (the Space answered, it is not a failed fetch, or the tries are used). `tries` is how many were made already. */
export function openRetryDelay(error: unknown, tries: number): number | null {
  if (tries >= OPEN_RETRY_MS.length) return null;
  if (error instanceof CapError) return null;
  if (!(error instanceof TypeError)) return null;
  return OPEN_RETRY_MS[tries] ?? null;
}
