// The crew of the open chat, shared by the strip in the conversation and the Crew pane beside it: one read (engine.crew.status), one selection (the row whose peek is open), one request to show the pane.
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { CrewStatusOut } from "./model.ts";
import { useCrewStatus } from "./status.ts";
import type { Call } from "./status.ts";

export interface CrewCtx {
  status: CrewStatusOut | null;
  /** Read again now (a helper started, a note went). */
  refresh(): void;
  /** The helper whose peek is open in the pane; null: the overview. */
  selected: string | null;
  /** Show the Crew pane, on one helper's peek or on the overview, and open the pane when it is shut. */
  show(helperThreadId: string | null): void;
  /** Counts up on each show(): the pane switches to its Crew tab when it changes. */
  seq: number;
  /** The Crew pane (the shared side pane with its own Crew tab) is showing. */
  open: boolean;
  close(): void;
  call: Call | undefined;
  threadId: string;
}

const Ctx = createContext<CrewCtx | null>(null);
export const useCrew = (): CrewCtx | null => useContext(Ctx);

export function CrewProvider({ call, threadId, onShow, children }: { call: Call | undefined; threadId: string; onShow?: () => void; children: ReactNode }): ReactElement {
  const [signal, setSignal] = useState(0);
  const { status } = useCrewStatus(call, threadId, signal);
  const [selected, setSelected] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [open, setOpen] = useState(false);
  const value = useMemo<CrewCtx>(() => ({
    status, refresh: () => setSignal((n) => n + 1), selected, seq, call, threadId, open, close: () => { setOpen(false); setSelected(null); },
    show: (id) => { setSelected(id); setSeq((n) => n + 1); setOpen(true); onShow?.(); },
  }), [status, selected, seq, call, threadId, onShow, open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
