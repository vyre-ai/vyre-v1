// Records data: the one context the sidebar and the table read. Lists the screens declare (record types, saved views) come from the generated screen hooks; the table reads records.query,
// records.counts and schema.describe through `live`, a live query over the kept copy for any capability (the shell builds it over the replica). Writes go through `call`.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

/** The capabilities the table reads live. */
export type LiveCap = "records.query" | "records.counts" | "schema.describe";

/** Where a click goes. The shell supplies these (tabs, the record page, the Record types list and the Schema map); the Records place never decides how a thing opens. */
export interface RecordsNav {
  /** A record opens as a tab on its page; the table stays where it was. */
  openRecord(recordId: string): void;
  /** The read-only list of record types (the screen records.types). */
  openRecordTypes(): void;
  openSchemaMap(): void;
}

export interface RecordsData {
  screens: ScreenHooks;
  /** A live query for a capability and input over the kept copy: a value that changes when the copy does. */
  live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** The name of a person, agent or group by id, for the person fields. */
  nameOf(id: string): string;
  nav: RecordsNav;
}

const DataCtx = createContext<RecordsData | null>(null);

export function RecordsDataProvider({ value, children }: { value: RecordsData; children: ReactNode }): ReactElement {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

/** The data the shell provided, or null before it has (the place then draws its loading frame). */
export function useOptionalRecordsData(): RecordsData | null {
  return useContext(DataCtx);
}

export function useRecordsData(): RecordsData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("Records needs a RecordsDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useRecordsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** A live capability query. The input is compared by value, so a new object with the same content keeps the subscription. */
export function useLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): QueryState<CapMap[C]["out"]> {
  const { live } = useRecordsData();
  const key = JSON.stringify(input);
  const q = useMemo(() => live(cap, JSON.parse(key) as CapMap[C]["in"]), [live, cap, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useRecordsData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
