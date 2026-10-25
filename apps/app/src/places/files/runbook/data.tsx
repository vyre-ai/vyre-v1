// What the runbook viewer needs from the shell: live screen queries over the kept copy (blocks, history, targets, output; screen files.runbook-viewer), the capability door,
// the clock, and a way to copy a command. The shell fills this in; the screenshot mount and the tests pass their own.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

export const RUNBOOK_SCREEN = "files.runbook-viewer";

export interface RunbookData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  clock(): { now: number; offsetMin: number };
  /** Put text on the clipboard. */
  copy(text: string): void;
  /** A run's "by" shows as this person or agent name; the default is the text as stored. */
  nameOf?(by: string): string;
}

const Ctx = createContext<RunbookData | null>(null);

export function RunbookDataProvider({ value, children }: { value: RunbookData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunbookData(): RunbookData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The runbook viewer needs a RunbookDataProvider above it");
  return v;
}

const LOADING: QueryState<never> = { status: "loading" };
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => LOADING };

/** A live query the screen declares: `screens.query(screenId, name, state)`. Re-subscribes only when the name or the state changes. */
export function useRunbookQuery<T>(name: "blocks" | "history" | "targets" | "output", state: Record<string, unknown> = {}, enabled = true): QueryState<T> {
  const { screens } = useRunbookData();
  const key = JSON.stringify(state);
  const q = useMemo(() => (enabled ? (screens.query(RUNBOOK_SCREEN, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>) : (NEVER as LiveQuery<T>)), [screens, name, key, enabled]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
