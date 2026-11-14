// The crew of the open chat, shared by the strip in the conversation and the Crew pane beside it: one read (engine.crew.status), one selection (the row whose peek is open), one request to show the pane.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

export function CrewProvider({
  call,
  threadId,
  onShow,
  children,
}: {
  call: Call | undefined;
  threadId: string;
  onShow?: () => void;
  children: ReactNode;
}): ReactElement {
  const [signal, setSignal] = useState(0);
  // one function for the life of the provider: a timer that reads again must not be torn down by each read it causes
  const refresh = useCallback(() => setSignal((n) => n + 1), []);
  const { status } = useCrewStatus(call, threadId, signal);
  const [selected, setSelected] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [open, setOpen] = useState(false);
  const value = useMemo<CrewCtx>(
    () => ({
      status,
      refresh,
      selected,
      seq,
      call,
      threadId,
      open,
      close: () => {
        setOpen(false);
        setSelected(null);
      },
      show: (id) => {
        setSelected(id);
        setSeq((n) => n + 1);
        setOpen(true);
        onShow?.();
      },
    }),
    [status, selected, seq, call, threadId, onShow, open, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** How often the crew is read while an agent of the chat is at work: a subagent its engine starts is on screen within about a second (F41), not when the reply lands. */
export const CREW_WORKING_MS = 1000;

/** Draws nothing. While `working`, it has the crew read again every second, so what an agent starts mid-turn (helpers, subagents) shows at once. */
export function CrewWhileWorking({ working }: { working: boolean }): null {
  const crew = useCrew();
  const refresh = crew?.refresh;
  useEffect(() => {
    if (!working || !refresh) return undefined;
    refresh();
    const t = setInterval(refresh, CREW_WORKING_MS);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }, [working, refresh]);
  return null;
}
