// The one desk of the app (lane r42-computer): which agent's computer is open, and in which shape. It lives outside any pane or tab so the small live picture stays when you leave the Computer tab, the chat
// or the agent, and the full view survives the pane's own re-renders. The shape is desk-model.ts; this file holds the state and tells whoever draws it.
import { useSyncExternalStore } from "react";
import { CLOSED, deskStep } from "./desk-model.ts";
import type { DeskEvent, DeskState } from "./desk-model.ts";
import type { BrowserData } from "./work-model.ts";
import type { ChatRightPaneData } from "./data.tsx";
import type { PaneDeps } from "./actions.ts";

/** What the desk needs to run the agent's browser: the same data the Computer tab holds, kept by reference. */
export interface DeskSession {
  agentId: string;
  name: string;
  data: BrowserData;
  call: (cap: string, input: unknown) => Promise<unknown>;
  note: (text: string) => void;
  /** The chat the desk was opened from: Stop is that thread's own turn stop for this agent. Absent: there is no Stop to offer. */
  threadId?: string;
  /** The pane's own data, so the desk can show the other rooms (Terminal, Files) with the same sources as the Computer tab. Absent: the desk is the browser only. */
  pane?: ChatRightPaneData;
  deps?: PaneDeps;
}
export interface DeskSnapshot {
  state: DeskState;
  session: DeskSession | null;
}

let snap: DeskSnapshot = { state: CLOSED, session: null };
const subs = new Set<() => void>();
const set = (next: DeskSnapshot): void => {
  if (next.state === snap.state && next.session === snap.session) return;
  snap = next;
  for (const f of [...subs]) f();
};

export const deskSnapshot = (): DeskSnapshot => snap;
export function subscribeDesk(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}
/** Apply one event. Closed, or the dock (the Computer tab's own picture, drawn by the pane), keep no session: nothing is drawn over the app. */
export function deskDispatch(e: DeskEvent): void {
  const state = deskStep(snap.state, e);
  const overlay = state.mode === "full" || state.mode === "mini";
  set({ state, session: overlay ? snap.session : null });
}
/** Open the desk on an agent's computer in the full view (or the small picture). Another agent's desk replaces this one. */
export function deskOpen(session: DeskSession, mode: "full" | "mini" = "full"): void {
  const base = snap.session !== null && snap.session.agentId !== session.agentId ? CLOSED : snap.state;
  const opened = deskStep(base, { type: "open", room: "browser", mode: "full" });
  const state = mode === "mini" ? deskStep(opened, { type: "minimise" }) : opened;
  set({ state, session });
}
export function deskReset(): void {
  set({ state: CLOSED, session: null });
}
export const useDesk = (): DeskSnapshot => useSyncExternalStore(subscribeDesk, deskSnapshot, deskSnapshot);
