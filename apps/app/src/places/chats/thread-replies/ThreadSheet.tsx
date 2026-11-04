// A phone opens the thread as a full-screen sheet over the chat: a header with a back arrow, "Thread" and the chat's title, then the thread. It is drawn in the shared overlay layer so nothing in the chat covers it.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { Icon } from "../needsyou/parts.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CONVERSATION_SCREEN } from "../conversation/Conversation.tsx";
import { ConversationDataProvider, useConversationData, useScreenQuery } from "../conversation/data.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import { THREAD_TITLE } from "./model.ts";
import { ThreadPane } from "./ThreadPane.tsx";

/** The title of the chat the thread hangs in, under "Thread". */
function ChatTitle(): ReactElement | null {
  const d = useConversationData();
  const q = useScreenQuery<CapMap["threads.get"]["out"]>(CONVERSATION_SCREEN, "thread", { threadId: d.threadId });
  const title = q.status === "ready" ? q.data.thread.title ?? "" : "";
  return title === "" ? null : <Text testID="thread-sheet-title" numberOfLines={1} style={st.sub}>{title}</Text>;
}

export function ThreadSheet({ data, threadId, onClose }: { data: ConversationData; threadId: string; onClose(): void }): ReactElement {
  return (
    <Overlay>
      <View testID="thread-sheet" accessibilityViewIsModal accessibilityLabel={THREAD_TITLE} style={st.sheet}>
        <View style={st.head}>
          <Pressable testID="thread-sheet-back" accessibilityRole="button" accessibilityLabel="Back to the chat" onPress={onClose} hitSlop={10} style={st.back}><Icon name="back" size={18} color="var(--ink)" /></Pressable>
          <View style={st.titles}>
            <Text style={st.title}>{THREAD_TITLE}</Text>
            <ConversationDataProvider value={data}><ChatTitle /></ConversationDataProvider>
          </View>
        </View>
        <View style={st.body}><ThreadPane data={data} threadId={threadId} /></View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  sheet: { position: "fixed" as unknown as "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "var(--win)" as string, zIndex: 50 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  body: { flex: 1, minHeight: 0 },
});
