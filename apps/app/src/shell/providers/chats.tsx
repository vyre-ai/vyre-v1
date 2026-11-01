// Chats in the shell (spec 3.2): the sidebar on the left, the open page in the middle (a conversation, the Needs you page, an agent's page, a helper's chat), the agent's pane or a
// terminal on the right, and the computer popup, the recording sheet, Connect an outside agent, All agents and the terminal list and rules over it. The composition lives in
// places/chats/mounts (ChatsMounted); this file gives it the runtime of the open Space and the link another place opened Chats with (`screen=chats.agent-page&agentId=...`).
// Before the Space's runtime exists the place draws its loading frame (sidebar rows and a conversation skeleton), the size of the real one.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { ChatsSidebarLoading } from "../../places/chats/sidebar/ChatsSidebar.tsx";
import { ConversationLoading } from "../../places/chats/conversation/Conversation.tsx";
import { ChatsMounted, PANE_W, SIDEBAR_W } from "../../places/chats/mounts/ChatsMounted.tsx";
import { useHubState, useOptionalHub } from "../spaces/context.tsx";
import type { ShellHub } from "../spaces/hub.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

export { newestThread } from "../../places/chats/mounts/route.ts";
export { Conversation as ChatsConversation } from "../../places/chats/conversation/Conversation.tsx";
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
  if (!rt) return <ChatsLoading />;
  return hub ? <ChatsLinked rt={rt} hub={hub} /> : <ChatsMounted rt={rt} hash="" />;
}

// The shell keys the place by the Space and the place, not the link, so a link that arrives while Chats is open comes through here.
function ChatsLinked({ rt, hub }: { rt: NonNullable<ReturnType<typeof useOptionalShellRuntime>>; hub: ShellHub }): ReactElement {
  return <ChatsMounted rt={rt} hash={useHubState(hub).hash} />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
});
