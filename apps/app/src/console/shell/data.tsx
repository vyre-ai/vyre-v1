// Console data: the one context every page reads. Lists are live queries over the local copy (the registry's screens); every change goes through `call`, one capability per action.
// The shell supplies the value; a page never decides how another page opens.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";

export interface ConsoleNav {
  /** Opens a Console page by id (nav.ts). */
  openPage(id: string, state?: Record<string, unknown>): void;
  /** Opens the app on this Space; the Console is not linked from the app, the app is linked from here. */
  openApp(target?: { screen: string; args?: Record<string, string> }): void;
}

export interface ConsoleData {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string; role: string };
  space: { id: string; name: string; address: string };
  /** Does this person hold the permission? Console pages hide by it. */
  can(perm: string): boolean;
  allowedScreens?: ReadonlySet<string>;
  /** Names for ids shown in the audit log and the activity list. */
  name(id: string): string;
  nav: ConsoleNav;
  clock(): { now: number };
}

const Ctx = createContext<ConsoleData | null>(null);

export function ConsoleDataProvider({ value, children }: { value: ConsoleData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useConsoleData(): ConsoleData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Console needs a ConsoleDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useConsoleData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
