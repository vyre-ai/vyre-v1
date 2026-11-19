// The two reads the Crew pane's tabs share (lane r42-subagents): what this chat's helpers know together (the newest tree of work in the thread: board, messages, nodes) and what the Space has running or asleep. Each is one request
// at a time, again every few seconds while the pane is there, keeps what it showed when a refresh fails, and goes quiet for good only when the server says it has no such read. Nothing here draws.
import { useEffect, useRef, useState } from "react";
import { findRoot, readActivity, readBoard, readMessages, readTree } from "./reads.ts";
import type { ActivityRow, BoardEntry, NodeMessage, RunNode } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface RunData {
  /** loading: not answered yet; none: no tree of work in this chat, or the person only watches, or the server has no such read; ready: the board and what goes with it. */
  status: "loading" | "none" | "ready";
  board: readonly BoardEntry[];
  messages: readonly NodeMessage[];
  nodes: readonly RunNode[];
  /** The last refresh failed; what is shown is from before. */
  stale: boolean;
}

export function useRunData(call: Call, threadId: string): RunData {
  const [d, setD] = useState<RunData>({ status: "loading", board: [], messages: [], nodes: [], stale: false });
  useEffect(() => {
    let dead = false;
    let busy = false;
    const read = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const root = await findRoot(call, threadId);
        if (dead) return;
        if (root === "failed") {
          setD((x) => ({ ...x, stale: true }));
          return;
        }
        if (root === "none" || !root.full) {
          setD({ status: "none", board: [], messages: [], nodes: [], stale: false });
          return;
        }
        const [board, messages, nodes] = await Promise.all([
          readBoard(call, root.rootRun),
          readMessages(call, root.rootRun),
          readTree(call, root.rootRun),
        ]);
        if (dead) return;
        if (board === null && messages === null && nodes === null) {
          setD((x) => ({ ...x, stale: true }));
          return;
        }
        setD({ status: "ready", board: board ?? [], messages: messages ?? [], nodes: nodes ?? [], stale: false });
      } finally {
        busy = false;
      }
    };
    void read();
    const t = setInterval(() => void read(), 5000);
    (t as { unref?: () => void }).unref?.();
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [call, threadId]);
  return d;
}

export interface ActivityData {
  rows: readonly ActivityRow[] | undefined;
  /** The server says it has no such read: nothing is drawn. */
  absent: boolean;
  stale: boolean;
}

export function useActivity(call: Call): ActivityData {
  const [rows, setRows] = useState<readonly ActivityRow[] | undefined>(undefined);
  const [absent, setAbsent] = useState(false);
  const [stale, setStale] = useState(false);
  const gone = useRef(false);
  useEffect(() => {
    let dead = false;
    let busy = false;
    const read = (): void => {
      if (busy || gone.current) return;
      busy = true;
      void readActivity(call).then((r) => {
        busy = false;
        if (dead) return;
        if (r === "absent") {
          gone.current = true;
          setAbsent(true);
        } else if (r === "failed") setStale(true);
        else {
          setStale(false);
          setRows(r);
        }
      });
    };
    read();
    const t = setInterval(read, 5000);
    (t as { unref?: () => void }).unref?.();
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [call]);
  return { rows, absent, stale };
}
