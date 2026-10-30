// A chat tied to a record or a project opens as a workspace (CHAT-DESIGN ruling 1): the work in the main pane and the conversation beside it. DMs and channels stay conversation-first.
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RecordDetail } from "../../../shell/providers/record-detail.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import type { Work } from "./route.ts";

/** The width the conversation keeps beside the work. */
export const CHAT_BESIDE_W = 380;

/** The record page is built for room (fields, then its Activity and Files pane): below this window width the chat stays conversation-first and the work is one click away. */
export const WORKSPACE_MIN_W = 1500;

export function Workspace({ rt, work, children }: { rt: ShellRuntime; work: Work; children: ReactNode }): ReactElement {
  return (
    <View testID="chats-workspace" style={st.row}>
      <View testID="chats-work" accessibilityLabel={work.type === "project" ? "The project" : "The record"} style={st.work}>
        <RecordDetail key={work.id} rt={rt} recordId={work.id} />
      </View>
      <View testID="chats-beside" accessibilityLabel="The conversation" style={st.chat}>
        <Text accessibilityRole="header" style={st.label}>Conversation</Text>
        <View style={st.fill}>{children}</View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  work: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  chat: { width: CHAT_BESIDE_W, minHeight: 0, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  label: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  fill: { flex: 1, minHeight: 0 },
});
