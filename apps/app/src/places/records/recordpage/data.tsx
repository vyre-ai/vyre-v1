// What the record page needs from the shell: live reads over the kept copy (the record, its type, the admin's layout, my page choices, completeness, the relationship map, history, versions,
// memory facts), the capability door for writes, who people are, and where a click goes. The shell fills it in; the screenshot mount and the tests pass their own.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export type LiveCap =
  | "records.get" | "schema.describe" | "schema.layout.get" | "records.completeness" | "records.page_prefs.get" | "records.relations_map" | "records.history" | "records.versions" | "memory.find_by_subject";

export interface RecordPageNav {
  /** A linked record opens as a tab on its own page. */
  openRecord(type: string, recordId: string): void;
  /** The record's own chat (every project has one; any record can have one) opens in Chats, with the text ready if there is some. */
  openChat(type: string, recordId: string, ask?: string): void;
  /** The record's folder opens in Files. */
  openFiles(type: string, recordId: string): void;
  /** The place a fact or a note came from. */
  openSource(link: string): void;
}

export interface RecordPageData {
  live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  now(): number;
  nameOf(id: string): string;
  nav: RecordPageNav;
}

const Ctx = createContext<RecordPageData | null>(null);

export function RecordPageDataProvider({ value, children }: { value: RecordPageData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalPageData(): RecordPageData | null {
  return useContext(Ctx);
}

export function usePageData(): RecordPageData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The record page needs a RecordPageDataProvider above it");
  return v;
}

/** A live capability query; the input is compared by value, so an equal object keeps the subscription. */
export function useLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): QueryState<CapMap[C]["out"]> {
  const { live } = usePageData();
  const key = JSON.stringify(input);
  const q = useMemo(() => live(cap, JSON.parse(key) as CapMap[C]["in"]), [live, cap, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
