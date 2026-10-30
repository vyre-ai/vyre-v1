// "All clear": when Needs you, While you were away, Routines, Today and Starred have nothing at all, Home shows one calm card instead of five empty sections.
// Each section says what it holds (loading, empty or items); the card shows once every section that is on this page is empty, and the sections step aside.
import { useEffect, useSyncExternalStore } from "react";

export type SectionKind = "loading" | "empty" | "items";

const kinds = new Map<string, SectionKind>();
const listeners = new Set<() => void>();
const emit = (): void => { for (const l of listeners) l(); };

export function setSectionKind(id: string, kind: SectionKind | null): void {
  if (kind === null) { if (kinds.delete(id)) emit(); return; }
  if (kinds.get(id) === kind) return;
  kinds.set(id, kind);
  emit();
}

/** True when every registered section is empty and the three that every Home has (Needs you, Away, Routines) are among them. */
export function allClearNow(): boolean {
  if (!kinds.has("needs") || !kinds.has("away") || !kinds.has("routines")) return false;
  for (const k of kinds.values()) if (k !== "empty") return false;
  return true;
}

const watch = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** A section reports what it holds; it is forgotten when it leaves the page. */
/** kind null: this section is not drawn on this page. */
export function useSectionKind(id: string, kind: SectionKind | null): void {
  useEffect(() => { setSectionKind(id, kind); }, [id, kind]);
  useEffect(() => () => setSectionKind(id, null), [id]);
}

export function useAllClear(): boolean {
  return useSyncExternalStore(watch, allClearNow, () => false);
}
