// Runs data: the one context the run history, the run chat and Failed runs read. Every list is a live query over the local copy, so a row paints from what is kept on the device and
// updates when the copy changes. Writes go through `call`, one capability per action. The shell supplies the value; the place never decides how a thing opens.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { ThreadMessage } from "./model.ts";

export interface RunsNav {
  openAutomation(id: string): void;
  /** The run in the main view (Open in Main). */
  openRun(runId: string): void;
  /** The run chat in the side pane. */
  openRunSide(runId: string): void;
}

export interface RunsData {
  screens: ScreenHooks;
  /** A live read of one thread's messages (chat.messages.list), newest last. */
  thread(threadId: string): LiveQuery<{ messages: readonly ThreadMessage[] }>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  /** A person, agent, Automation or key by id, as a name. */
  name(id: string): string;
  nav: RunsNav;
  clock(): { now: number };
}

const Ctx = createContext<RunsData | null>(null);

export function RunsDataProvider({ value, children }: { value: RunsData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useRunsData(): RunsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Runs needs a RunsDataProvider above it");
  return v;
}

const LOADING: QueryState<never> = { status: "loading" };
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useRunsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** The messages of a thread; loading until there is a thread. */
export function useThread<T>(threadId: string | undefined): QueryState<T> {
  const { thread } = useRunsData();
  const q = useMemo(() => (threadId ? (thread(threadId) as unknown as LiveQuery<T>) : null), [thread, threadId]);
  const sub = q ? q.subscribe : NO_SUBSCRIBE;
  const snap = q ? q.getSnapshot : () => LOADING as QueryState<T>;
  return useSyncExternalStore(sub, snap, snap);
}

export const HISTORY = "runs.history";
export const CHAT = "runs.chat";
export const FAILED = "runs.failed";
