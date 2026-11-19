// The crew of the open chat, shared by the strip in the conversation and the Crew pane beside it: one read (engine.crew.status), one selection (the row whose peek is open), one request to show the pane.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { withLive } from "./model.ts";
import type { CrewMember, CrewStatusOut } from "./model.ts";
import { useCrewStatus } from "./status.ts";
import { useRunData } from "./run/useRun.ts";
import type { RunData } from "./run/useRun.ts";
import { nameStandIns } from "./run/model.ts";
import type { RunNode } from "./run/model.ts";
import type { Call } from "./status.ts";

export interface CrewCtx {
  status: CrewStatusOut | null;
  /** Read again now (a helper started, a note went). */
  refresh(): void;
  /** The subagents of a running turn, from its live frames (no read): the strip, island, chip and pane draw them beside the read. */
  setLive(members: readonly CrewMember[]): void;
  /** The helper whose peek is open in the pane; null: the overview. */
  selected: string | null;
  /** Show the Crew pane, on one helper's peek or on the overview, and open the pane when it is shut. */
  show(helperThreadId: string | null): void;
  /** Counts up on each show(): the pane switches to its Crew tab when it changes. */
  seq: number;
  /** The Crew pane (the shared side pane with its own Crew tab) is showing. */
  open: boolean;
  close(): void;
  /** The Crew pane is on screen, however it was opened (the pane tab by hand, a press on a helper): the runtime is read while it is. */
  reveal(on: boolean): void;
  call: Call | undefined;
  threadId: string;
  /** The nodes of this chat's newest tree of work (the runtime's step, stuck and dependsOn per helper); empty when there is none or this person only watches. */
  nodes: readonly RunNode[];
  /** The runtime's reads for this chat (board, messages, nodes): one reader shared by the strips and the pane. */
  run: RunData;
}

const Ctx = createContext<CrewCtx | null>(null);
export const useCrew = (): CrewCtx | null => useContext(Ctx);

const NO_NODES: readonly RunNode[] = [];
const same = (a: readonly CrewMember[], b: readonly CrewMember[]): boolean =>
  a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));

export function CrewProvider({
  call,
  threadId,
  onShow,
  shown = true,
  children,
}: {
  call: Call | undefined;
  threadId: string;
  onShow?: () => void;
  /** False while the place is kept mounted but not on screen (or the window is hidden): the runtime is not read then, and is read at once when it shows again. */
  shown?: boolean;
  children: ReactNode;
}): ReactElement {
  const [signal, setSignal] = useState(0);
  // one function for the life of the provider: a timer that reads again must not be torn down by each read it causes
  const refresh = useCallback(() => setSignal((n) => n + 1), []);
  const [live, setLiveState] = useState<readonly CrewMember[]>([]);
  const setLive = useCallback((m: readonly CrewMember[]) => setLiveState((cur) => (same(cur, m) ? cur : m)), []);
  const { status: read } = useCrewStatus(call, threadId, signal);
  const status = useMemo(() => withLive(read, live), [read, live]);
  const [selected, setSelected] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [open, setOpen] = useState(false);
  // the runtime's view of the same helpers, read once for the chat and shared by every strip and the pane (a server without it gives nothing). Only a chat that has helpers, or whose pane is open, asks:
  // a chat that never had one costs no request, and a chat with no tree of work is asked about rarely
  const absent = useMemo<Call>(() => async () => Promise.reject(new Error("unknown capability")), []);
  const run = useRunData(call ?? absent, threadId, {
    enabled: shown && call !== undefined && ((status?.members.length ?? 0) > 0 || open),
  });
  // a helper that has not had its first turn is a queued stand-in with no name: it takes the name the strip shows for that chat, so "Starts when Numbers is done" says who
  const titles = useMemo(
    () => new Map((status?.members ?? []).map((m) => [m.id, (m.name ?? m.title).trim()] as const)),
    [status],
  );
  const runNamed = useMemo(
    () =>
      run.status !== "ready"
        ? run
        : {
            ...run,
            nodes: nameStandIns(run.nodes, titles),
          },
    [run, titles],
  );
  const nodes = runNamed.status === "ready" ? runNamed.nodes : NO_NODES;
  const value = useMemo<CrewCtx>(
    () => ({
      status,
      refresh,
      setLive,
      selected,
      seq,
      call,
      threadId,
      nodes,
      run: runNamed,
      open,
      close: () => {
        setOpen(false);
        setSelected(null);
      },
      reveal: (on) => setOpen(on),
      show: (id) => {
        setSelected(id);
        setSeq((n) => n + 1);
        setOpen(true);
        onShow?.();
      },
    }),
    [status, selected, seq, call, threadId, nodes, runNamed, onShow, open, refresh, setLive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
