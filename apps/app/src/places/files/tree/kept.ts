// What the Files sidebar looked like when it was last on screen, for this session: which folders were open and which sections folded. The sidebar is made again
// each time a person comes back to Files from another place, and without this every folder they had opened was shut again (owner, 15 Nov 2026: a tab remembers
// where you were). Kept per session (the Space's runtime), never written to disk, gone on sign-out or a switch of Space.
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

const KEPT = new WeakMap<object, Map<string, unknown>>();

export function recall<T>(owner: object | null | undefined, name: string): T | undefined {
  return owner ? (KEPT.get(owner)?.get(name) as T | undefined) : undefined;
}

export function remember(owner: object | null | undefined, name: string, value: unknown): void {
  if (!owner) return;
  let m = KEPT.get(owner);
  if (!m) KEPT.set(owner, (m = new Map()));
  m.set(name, value);
}

/** useState whose value outlives the component for as long as `owner` lives. */
export function useKept<T>(owner: object | null | undefined, name: string, first: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, set] = useState<T>(() => recall<T>(owner, name) ?? first);
  useEffect(() => {
    remember(owner, name, value);
  }, [owner, name, value]);
  return [value, set];
}
