// Two hooks every mounted screen of this folder shares: a live screen query over the kept copy, and the connection state. The parts already built read their own data context;
// the screens built here (All agents, Connect an outside agent, the terminal tab, list and rules, the Waiting on line) take `screens` and `connection` directly.
import { useMemo, useSyncExternalStore } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

/** A live query of a registry screen: `screens.query(screenId, name, state)`. Re-subscribes only when the screen, the query or the state changes. */
export function useLive<T>(screens: ScreenHooks, screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(connection: Connection): boolean {
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}

/** The code of a refused capability call ("permission.no_grant"), or an empty string for anything else. */
export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

export const isRefusal = (e: unknown): boolean => errorCode(e).startsWith("permission.");

/** The words of a failed call, for the one quiet line a screen shows. */
export function errorWords(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m.length > 0 ? m : fallback;
}
