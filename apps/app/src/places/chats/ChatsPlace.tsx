// The Chats place (spec 3.2): the sidebar (Needs you, Agents, Channels, Chats) in the shell's slot on the left, the open chat in the middle, the agent's pane on the right. It only composes what exists: ChatsSidebar,
// Conversation and ChatRightPane (which draws its tabs in the shared TabStrip inside the shared SidePane). The shell gives it the three data bags; the pane toggle's state lives here because
// it also drives the chat header's button. The sidebar is drawn by the shell in its shared place sidebar slot (collapse, search, and on a phone the list before the chat); under 640 px the pane is left out.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { ChatRightPane } from "./rightpane/ChatRightPane.tsx";
import { CrewProvider } from "./crew/context.tsx";
import type { ChatRightPaneData } from "./rightpane/data.tsx";
import { Conversation } from "./conversation/Conversation.tsx";
import type { ConversationData } from "./conversation/data.tsx";
import { THREAD_TITLE } from "./thread-replies/model.ts";
import { ThreadPane } from "./thread-replies/ThreadPane.tsx";
import { ThreadSheet } from "./thread-replies/ThreadSheet.tsx";
import { ChatsSidebarSlot } from "./sidebar/ChatsSidebar.tsx";
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
  // A thread under a message opens beside the chat on a wide screen (a tab in the pane) and as a full-screen sheet on a phone (agents reply in threads).
  const [replies, setReplies] = useState<string | null>(null);
  useEffect(() => { setReplies(null); }, [conversation.threadId]);
  const openReplies = useCallback((threadId: string): void => { setReplies(threadId); if (wide) setOpen(true); }, [wide]);
  const chat = useMemo<ConversationData>(() => ({ ...conversation, nav: { ...conversation.nav, togglePane: () => setOpen((o) => !o), openReplies } }), [conversation, openReplies]);
  const extra = replies !== null && wide ? { tabs: [{ key: "thread", title: THREAD_TITLE }], active: "thread", onSelect: () => undefined, onClose: () => setReplies(null), body: <ThreadPane data={chat} threadId={replies} /> } : undefined;
  return (
    <CrewProvider call={conversation.call} threadId={conversation.threadId} onShow={() => setOpen(true)}>
      <View testID="chats-place" style={st.root}>
        <ChatsSidebarSlot data={sidebar} {...(window ? { window } : {})} />
        <View testID="chats-place-chat" style={st.chat}><Conversation data={chat} /></View>
        {wide ? <ChatRightPane data={pane} open={open} onToggle={() => setOpen((o) => !o)} {...(extra ? { extra } : {})} {...(window ? { window } : {})} /> : null}
        {!wide && replies !== null ? <ThreadSheet data={chat} threadId={replies} onClose={() => setReplies(null)} /> : null}
      </View>
    </CrewProvider>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: "var(--win)" as string },
  chat: { flex: 1, minWidth: 0 },
});
