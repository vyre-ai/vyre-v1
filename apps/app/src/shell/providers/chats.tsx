// Chats in the shell (spec 3.2): the sidebar on the left, the open page in the middle (a conversation, the Needs you page, an agent's page, a helper's chat), the agent's pane or a
// terminal on the right, and the computer popup, the recording sheet, Connect an outside agent, All agents and the terminal list and rules over it. The composition lives in
// places/chats/mounts (ChatsMounted); this file gives it the runtime of the open Space and the link another place opened Chats with (`screen=chats.agent-page&agentId=...`).
// Before the Space's runtime exists the place draws its loading frame (sidebar rows and a conversation skeleton), the size of the real one.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { ChatsSidebarLoading } from "../../places/chats/sidebar/ChatsSidebar.tsx";
import { ConversationLoading } from "../../places/chats/conversation/Conversation.tsx";
import { ChatsMounted, PANE_W, SIDEBAR_W } from "../../places/chats/mounts/ChatsMounted.tsx";
import { useOptionalHub } from "../spaces/context.tsx";
import { useOptionalShellRuntime } from "./runtime.tsx";

export { newestThread } from "../../places/chats/mounts/route.ts";
export { PANE_W, SIDEBAR_W };

export function ChatsLoading(): ReactElement {
  return (
    <View testID="chats-place-loading" accessibilityLabel="Loading" style={st.row}>
      <View style={st.side}><ChatsSidebarLoading /></View>
      <View style={st.main}><ConversationLoading /></View>
    </View>
  );
}

export default function ChatsPlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  const hub = useOptionalHub();
  // The shell keys the place by its link, so the link read here is the one this instance was opened with.
  const hash = hub ? hub.state().hash : "";
  return rt ? <ChatsMounted rt={rt} hash={hash} /> : <ChatsLoading />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
});
