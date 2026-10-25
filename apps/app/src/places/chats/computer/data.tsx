// What the computer popup reads: one context. The computer's state is a live query over the kept copy (it updates when the agent wakes, when you take over, when it sleeps);
// the stream and the recording are calls. The shell supplies the chat that sits beside the screen and what happens on Close.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CaptureStore, Clock, Display } from "./model.ts";

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface PopupNav {
  /** Dismiss the popup (Esc, the Close icon). */
  close(): void;
}

export interface ComputerPopupData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  computerId: string;
  agent: { agentId: string; name: string };
  /** The display's size in the pixels the screen tools use. Defaults to 1280 by 800. */
  display?: Display;
  /** Clicks, pages and network calls while a recording runs, fed by the stream. */
  capture: CaptureStore;
  /** The chat with this agent, drawn beside the screen when the chat icon is on. The shell supplies the conversation. */
  renderChat?: (agent: { agentId: string; name: string }) => ReactElement;
  nav: PopupNav;
  clock(): Clock;
}

const Ctx = createContext<ComputerPopupData | null>(null);

export function PopupDataProvider({ value, children }: { value: ComputerPopupData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalPopupData(): ComputerPopupData | null {
  return useContext(Ctx);
}

export function usePopupData(): ComputerPopupData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The computer popup needs a PopupDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = usePopupData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = usePopupData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}

export function useCapture(): ReturnType<CaptureStore["get"]> {
  const { capture } = usePopupData();
  return useSyncExternalStore(capture.subscribe, capture.get, capture.get);
}
