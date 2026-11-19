// The Crew pane as the approved prototype draws it (lane r42-subagents, sub42): Helpers / Board (count) / Tokens as the shared tab strip under the pane's head. Helpers is the pane as it was, with what the Space has running or
// asleep under it (a running one wears the live mark, a sleeping one the moon and what it waits on); Board holds what the helpers know together and the last words between them; Tokens is the one quiet line and its details.
// A chat that has run no tree of work, a person who only watches it, or a server without these reads has no Board and no Tokens: the strip is not drawn, and the pane is just Helpers.
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PageTabs } from "../../../../../../../ui/src/Page/index.tsx";
import { useDueText } from "../../../../../../../ui/src/Time/index.tsx";
import { ActivityList, BoardView, MessageLines, TokenReport } from "./views.tsx";
import { threadOfRun } from "./reads.ts";
import { useActivity, useRunData } from "./useRun.ts";
import type { RunData } from "./useRun.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Tab = "helpers" | "board" | "tokens";

export function CrewTabs({
  call,
  threadId,
  helpers,
  onOpenThread,
  run: shared,
}: {
  /** The reads the chat already shares (CrewProvider): when given, the pane reads nothing of its own. */
  run?: RunData | undefined;
  call: Call;
  threadId: string;
  /** The Helpers tab: the pane as it was. */
  helpers: ReactNode;
  onOpenThread?: (threadId: string) => void;
}): ReactElement {
  const own = useRunData(call, threadId, { enabled: shared === undefined });
  const run = shared ?? own;
  const act = useActivity(call);
  const when = useDueText();
  const [tab, setTab] = useState<Tab>("helpers");
  const [report, setReport] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pressed = useRef(0);
  const press = (runId: string): void => {
    setNote(null);
    const mine = ++pressed.current;
    void threadOfRun(call, runId).then((id) => {
      if (mine !== pressed.current) return; // a later press has taken over
      if (id !== null && onOpenThread) onOpenThread(id);
      else setNote("It has no chat to open.");
    });
  };
  const has = run.status === "ready";
  const showing: Tab = has ? tab : "helpers";
  const rows = act.absent ? undefined : act.rows;
  return (
    <View testID="crew-tabs" style={st.wrap}>
      {has ? (
        <PageTabs
          testID="crew-tab"
          tab={showing}
          onTab={(id) => setTab(id as Tab)}
          tabs={[
            { id: "helpers", label: "Helpers" },
            { id: "board", label: "Board", count: run.board.length },
            { id: "tokens", label: "Tokens" },
          ]}
        />
      ) : null}
      {run.stale ? (
        <Text testID="crew-tabs-stale" style={st.note}>
          Could not refresh.
        </Text>
      ) : null}
      {showing === "helpers" ? (
        <View testID="crew-tab-panel-helpers">
          {helpers}
          {rows && rows.length > 0 ? <ActivityList rows={rows} when={when} onOpen={press} /> : null}
          {note ? (
            <Text testID="crew-activity-note" style={st.note}>
              {note}
            </Text>
          ) : null}
        </View>
      ) : null}
      {showing === "board" ? (
        <View testID="crew-tab-panel-board" style={st.panel}>
          <BoardView entries={run.board} nodes={run.nodes} />
          <MessageLines messages={run.messages} nodes={run.nodes} />
        </View>
      ) : null}
      {showing === "tokens" ? (
        <View testID="crew-tab-panel-tokens" style={st.panel}>
          <TokenReport nodes={run.nodes} open={report} onToggle={() => setReport((r) => !r)} />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 4 },
  panel: { paddingTop: 10, gap: 4 },
  note: { fontSize: 12, color: "var(--ink-3)" as string },
});
