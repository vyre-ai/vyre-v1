// What an outside agent did, newest first: the tool, where, how it ended. It runs elsewhere, so this list is the owner's window onto it: never an input or an answer, only that it happened. Read again every few seconds, because
// nothing here moves when it works; a row in a chat opens that chat.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { OUTCOME_WORDS, toolWords } from "./model.ts";
import type { Activity } from "./model.ts";
import { agoLabel } from "../rightpane/model.ts";
import type { Clock } from "../rightpane/model.ts";

export const ACTIVITY_MS = 5000;

export function ActivityTab({ agentId, call, clock, openChat }: { agentId: string; call(cap: string, input: unknown): Promise<unknown>; clock: Clock; openChat(threadId: string): void }): ReactElement {
  const [rows, setRows] = useState<readonly Activity[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => { void call("mcp.activity.list", { agentId, limit: 100 }).then((o) => { if (live) setRows((o as CapMap["mcp.activity.list"]["out"]).rows); }, () => { if (live) setRows((r) => r ?? []); }); };
    read();
    const t = setInterval(read, ACTIVITY_MS);
    return () => { live = false; clearInterval(t); };
  }, [agentId, call]);
  if (rows === null) return <View testID="activity-loading" accessibilityLabel="Loading" style={st.loading} />;
  if (rows.length === 0) return <Text testID="activity-empty" style={st.empty}>Nothing yet. What it does in this Space shows here.</Text>;
  const list: ReactElement[] = [];
  for (const r of rows) {
    const body = (
      <>
        <Text numberOfLines={1} style={st.what}>{toolWords(r.tool)}</Text>
        <Text style={[st.state, r.outcome === "held" && st.held, r.outcome === "error" && st.failed]}>{OUTCOME_WORDS[r.outcome]}</Text>
        <Text style={st.when}>{agoLabel(r.at, clock)}</Text>
      </>
    );
    const threadId = r.threadId;
    list.push(threadId
      ? <Pressable key={r.id} testID={`activity-${r.id}`} accessibilityRole="link" onPress={() => openChat(threadId)} style={st.row}>{body}</Pressable>
      : <View key={r.id} testID={`activity-${r.id}`} style={st.row}>{body}</View>);
  }
  return <ScrollView testID="activity-list" style={st.scroll}>{list}</ScrollView>;
}

const st = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, paddingHorizontal: 6, borderRadius: 8 },
  what: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  state: { fontSize: 12, color: "var(--ink-3)" as string },
  held: { color: "var(--accent)" as string },
  failed: { color: "var(--danger)" as string },
  when: { fontSize: 12, color: "var(--ink-4)" as string, minWidth: 64, textAlign: "right" },
  empty: { padding: 16, fontSize: 13, color: "var(--ink-3)" as string },
  loading: { height: 120, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
