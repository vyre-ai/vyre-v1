// What the helper chat reads: one context. The thread and its messages are live queries over the kept copy, so the page paints from what the device keeps and updates as the
// helper works. The only write is Stop.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { Clock } from "./model.ts";

export interface HelperNav {
  /** The chat or thread an address-bar part names; also "Reply in ...". */
  openThread(threadId: string): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface HelperChatData {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** The helper's thread. */
  threadId: string;
  nameOf(id: string): string;
  nav: HelperNav;
  clock(): Clock;
}

const Ctx = createContext<HelperChatData | null>(null);

export function HelperDataProvider({ value, children }: { value: HelperChatData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalHelperData(): HelperChatData | null {
  return useContext(Ctx);
}

export function useHelperData(): HelperChatData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The helper chat needs a HelperDataProvider above it");
  return v;
}

export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useHelperData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useHelperData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
