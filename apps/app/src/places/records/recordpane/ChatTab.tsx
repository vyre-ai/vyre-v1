// Right pane > Chat: this record's Ask pane, in place. The shell draws the conversation (one private chat per record, started on the first open, with the record as its context).
import type { ReactElement } from "react";
import { View } from "react-native";
import { usePageData } from "../recordpage/data.tsx";
import { PaneEmpty } from "./Empty.tsx";

export function ChatTab({ type, recordId }: { type: string; recordId: string }): ReactElement {
  const data = usePageData();
  if (!data.renderChat) return <PaneEmpty icon="chat" text="Chat is not available here" testID="pane-chat-empty" />;
  return <View style={{ flex: 1, minHeight: 0 }} testID="pane-chat">{data.renderChat(type, recordId)}</View>;
}
