// What the Apps place needs from the shell: live screen queries over the kept copy, the capability door, who the person is, and where a click goes outside the place. The shell fills it in;
// the screenshot mount and the tests pass their own. A Personal Space has no Apps (spec 2.1): `team` says which.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

export interface AppsNav {
  /** A site, form, campaign or template opens in its own screen (P-L9e_06 to P-L9e_09); until those mount, the place's own summary shows. */
  open(group: string, id: string): void;
  /** New form, campaign or site: the sheet that makes it. */
  create(group: string, kind?: string): void;
  /** Return to a group's list from a detail or create surface. */
  show(group: string): void;
  /** A Personal Space creates or joins a Team Space. */
  joinTeam(): void;
  /** The Gate task a held call is waiting on. */
  openTask(taskId: string): void;
  /** Kit builder: a thread with an agent that builds the Kit. */
  openThread(threadId: string): void;
}

export interface AppsData {
  assistantId?: string;
  me?: { id: string; name: string };
  connection?: { get(): "online" | "offline"; subscribe(listener: () => void): () => void };
  peek?(cap: string, input: unknown): unknown;
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  clock(): { now: number };
  team: boolean;
  /** Modules the Space has deferred (host/modules.json or the owner's ruling): their group is not drawn, so a list that can only fail never shows. It comes back by itself when the module is no longer deferred. */
  deferred?: readonly string[];
  nav: AppsNav;
}

const Ctx = createContext<AppsData | null>(null);
export function AppsDataProvider({ value, children }: { value: AppsData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useOptionalAppsData(): AppsData | null { return useContext(Ctx); }
export function useAppsData(): AppsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Apps needs an AppsDataProvider above it");
  return v;
}

/** A live screen query. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}, enabled = true): QueryState<T> {
  const { screens } = useAppsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => enabled ? screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T> : { subscribe: () => () => undefined, getSnapshot: () => EMPTY as QueryState<T> }, [screens, screenId, name, key, enabled]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

const EMPTY = { status: "ready", data: { sites: [] } } as const;
