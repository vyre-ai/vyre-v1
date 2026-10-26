// The Chats place (spec 3.2): the sidebar (Needs you, Agents, Channels, Chats) on the left, the open chat in the middle, the agent's pane on the right. It only composes what exists: ChatsSidebar,
// Conversation and ChatRightPane (which draws its tabs in the shared TabStrip inside the shared SidePane). The shell gives it the three data bags; the pane toggle's state lives here because
// it also drives the chat header's button. On a phone (under 640 px) the sidebar is the screen; the mobile shell (P-L9_17) takes it from there.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { ChatRightPane } from "./rightpane/ChatRightPane.tsx";
import type { ChatRightPaneData } from "./rightpane/data.tsx";
import { Conversation } from "./conversation/Conversation.tsx";
import type { ConversationData } from "./conversation/data.tsx";
import { ChatsSidebar } from "./sidebar/ChatsSidebar.tsx";
import type { ChatsSidebarData } from "./sidebar/data.tsx";
import type { VirtualWindow } from "../../../../../ui/src/VirtualList/index.tsx";

export const SIDEBAR_W = 272;
export const WIDE = 640;

export interface ChatsPlaceProps {
  sidebar: ChatsSidebarData;
  conversation: ConversationData;
  pane: ChatRightPaneData;
  /** Whether the pane starts open (it does on a wide screen). */
  paneOpen?: boolean;
  /** Pins which rows are drawn (tests and screenshots draw them all). */
  window?: VirtualWindow;
}

export function ChatsPlace({ sidebar, conversation, pane, paneOpen = true, window }: ChatsPlaceProps): ReactElement {
  const width = useWindowDimensions().width;
  const wide = width === 0 || width >= WIDE;
  const [open, setOpen] = useState(paneOpen);
  // The chat's own button toggles the same pane the pane's toggle does.
  const chat = useMemo<ConversationData>(() => ({ ...conversation, nav: { ...conversation.nav, togglePane: () => setOpen((o) => !o) } }), [conversation]);
  return (
    <View testID="chats-place" style={st.root}>
      <View testID="chats-place-sidebar" style={wide ? st.side : st.sideFull}>
        <ChatsSidebar data={sidebar} {...(window ? { window } : {})} />
      </View>
      {wide ? (
        <>
          <View testID="chats-place-chat" style={st.chat}><Conversation data={chat} /></View>
          <ChatRightPane data={pane} open={open} onToggle={() => setOpen((o) => !o)} {...(window ? { window } : {})} />
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, flexShrink: 0, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  sideFull: { flex: 1 },
  chat: { flex: 1, minWidth: 0 },
});
