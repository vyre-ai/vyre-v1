// Whether the item a place was told to open is not there: its query is still loading and the last read of it failed (missing, or not yours to open); the query state carries that failure (`error`).
import { useMemo, useSyncExternalStore } from "react";
import type { LiveQuery } from "../../../../../client/src/index.ts";
import type { ScreenHooks } from "../../../../../client/src/index.ts";

// useSyncExternalStore compares snapshots by identity. The fallback is read while a
// place has no selected item, so its loading snapshot must be kept, not recreated.
const LOADING_SNAPSHOT = { status: "loading" } as const;
export const NO_MISSING_QUERY: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => LOADING_SNAPSHOT };

export function useMissing(screens: ScreenHooks, screen: string, name: string, state: Record<string, unknown> | null): boolean {
  const key = JSON.stringify(state);
  const q = useMemo(() => (state === null ? null : screens.query(screen, name, state)), [screens, screen, name, key]); // eslint-disable-line react-hooks/exhaustive-deps -- state is keyed by its text
  const live = q ?? NO_MISSING_QUERY;
  const snap = useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  return q !== null && snap.status === "loading" && snap.error !== undefined;
}
