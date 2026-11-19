// "What they know together" in the Crew pane (lane r42-subagents, prototype sub42): the board the helpers of this chat write to, the last words they sent each other, and what the run cost. Read when the person opens it
// (the newest tree that ran in this chat: runs.tree.find, then the board, the messages and the tree), again every few seconds while it stays open. A server without these reads, a chat that has run nothing, or a person
// who only watches the chat gets no section at all: never an empty box and never an error.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BoardView, MessageLines, TokenReport } from "./views.tsx";
import { findRoot, readBoard, readMessages, readTree } from "./reads.ts";
import type { BoardEntry, NodeMessage, RunNode } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Loaded = { board: BoardEntry[]; messages: NodeMessage[]; nodes: RunNode[] } | null;

export function RunSection({ call, threadId }: { call: Call; threadId: string }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const [stale, setStale] = useState(false);
  const [report, setReport] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    let busy = false;
    const read = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        await readOnce();
      } finally {
        busy = false;
      }
    };
    const readOnce = async (): Promise<void> => {
      const root = await findRoot(call, threadId);
      if (dead) return;
      if (root === "failed") {
        setStale(true);
        return;
      }
      if (root === "none" || !root.full) {
        setGone(true);
        setData(null);
        return;
      }
      const [board, messages, nodes] = await Promise.all([
        readBoard(call, root.rootRun),
        readMessages(call, root.rootRun),
        readTree(call, root.rootRun),
      ]);
      if (dead) return;
      if (board === null && messages === null && nodes === null) {
        setStale(true);
        return;
      }
      setGone(false);
      setStale(false);
      setData({ board: board ?? [], messages: messages ?? [], nodes: nodes ?? [] });
    };
    void read();
    const t = setInterval(() => void read(), 5000);
    (t as { unref?: () => void }).unref?.();
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [open, call, threadId]);
  // asked for and nothing to show: the button goes away rather than opening an empty box
  if (gone) return null;
  return (
    <View testID="crew-run" style={st.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="crew-run-toggle"
        onPress={() => setOpen((o) => !o)}
        style={st.toggle}
      >
        <Text style={st.toggleText}>{open ? "Hide board" : "Board"}</Text>
      </Pressable>
      {open && data ? (
        <View testID="crew-run-body" style={st.body}>
          <BoardView entries={data.board} nodes={data.nodes} />
          <MessageLines messages={data.messages} nodes={data.nodes} />
          <TokenReport nodes={data.nodes} open={report} onToggle={() => setReport((r) => !r)} />
        </View>
      ) : null}
      {open && stale ? (
        <Text testID="crew-run-stale" style={st.note}>
          Could not refresh.
        </Text>
      ) : null}
      {open && data === undefined && !stale ? (
        <Text testID="crew-run-reading" style={st.note}>
          Reading…
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 14, gap: 6 },
  body: { gap: 4 },
  toggle: {
    alignSelf: "flex-start",
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  toggleText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string },
});
