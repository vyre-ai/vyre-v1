// What Needs you reads: one context. The list and the open request are live queries over the kept copy (client hooks from the generated screen index), so the screen paints
// from what the device keeps and updates when the copy changes. Writes go through `call`, one capability per action.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { Clock } from "./model.ts";

/** Where a click goes. The shell decides how a thing opens; this screen only says what. */
export interface NeedsNav {
  /** The chat, run, gate or Journey a request came from. */
  openSource(kind: string, id: string): void;
  /** A file block on a request, beside the list. */
  openFile(fileId: string): void;
  /** The agent's computer popup, for a request that is blocked on a login. */
  openComputer(agentId: string): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface NeedsYouData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** You, so a request taken by someone else reads as theirs. */
  me: string;
  space: { name: string };
  /** A name for any person or agent id, from the kept copy. */
  nameOf(id: string): string;
  /** The title of the chat, run, gate or Journey a request came from, from the kept copy; absent when the copy does not have it. */
  sourceTitle(kind: string, id: string): string | undefined;
  nav: NeedsNav;
  clock(): Clock;
}

const Ctx = createContext<NeedsYouData | null>(null);

export function NeedsYouDataProvider({ value, children }: { value: NeedsYouData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalNeedsData(): NeedsYouData | null {
  return useContext(Ctx);
}

export function useNeedsData(): NeedsYouData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Needs you needs a NeedsYouDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useNeedsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useNeedsData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
