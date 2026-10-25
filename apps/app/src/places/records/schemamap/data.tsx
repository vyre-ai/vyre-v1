// What the Schema map and the Record types list need from the shell: live queries over the kept copy (screens records.schema-map and records.types), one call door for the
// details of a type (schema.types.get), and where a press goes. The shell fills this in; the screenshot mount and the tests pass their own.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { TypeDetail } from "./model.ts";

export const MAP_SCREEN = "records.schema-map";
export const TYPES_SCREEN = "records.types";

export interface SchemaNav {
  /** Open a record type in the Records place. */
  openType(key: string): void;
  /** Structure is edited in the Console: open it at Data > Schema (a Team Space's console site). */
  openConsole(type?: string): void;
}

export interface SchemaData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  nav: SchemaNav;
  /** Put text on the clipboard. */
  copy(text: string): void;
}

const Ctx = createContext<SchemaData | null>(null);

export function SchemaDataProvider({ value, children }: { value: SchemaData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSchemaData(): SchemaData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Schema map needs a SchemaDataProvider above it");
  return v;
}

/** A live screen query: `screens.query(screenId, name, state)`. */
export function useSchemaQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useSchemaData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** The details of each type on the map, fetched once each (a card lists its fields). A type that fails to load keeps showing the links the map knows. */
export function useTypeDetails(keys: readonly string[], preload?: ReadonlyMap<string, TypeDetail>): ReadonlyMap<string, TypeDetail> {
  const { call } = useSchemaData();
  const [details, setDetails] = useState<ReadonlyMap<string, TypeDetail>>(preload ?? new Map());
  const want = keys.join("|");
  useEffect(() => {
    let live = true;
    for (const key of want ? want.split("|") : []) {
      if (details.has(key)) continue;
      void call("schema.types.get", { type: key }).then(
        (out) => { if (live) setDetails((m) => new Map(m).set(key, (out as { type: TypeDetail }).type)); },
        () => undefined,
      );
    }
    return () => { live = false; };
  }, [want]);
  return details;
}
