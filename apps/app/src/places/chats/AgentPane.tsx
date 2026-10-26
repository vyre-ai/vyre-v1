// The agent's pane beside a chat (P-L9b_24, spec 3.2 right pane): the shared SidePane with Computer, Threads, Files, Memory (with its count) and Routines, drawn wide enough on a desktop
// window that every tab shows and More appears only when the window is narrow. The tabs and their bodies are ChatRightPane's (places/chats/rightpane); this is the one place the Chats place
// mounts it from, so the width it asks for lives here. The Computer tab lists the session's steps each with its frame thumbnail, its tool and how far into the session it was, and an
// asleep computer shows its last frame with a Wake button over it.
import type { ReactElement } from "react";
import { ChatRightPane, WIDE_PANE_W } from "./rightpane/ChatRightPane.tsx";
import type { ChatRightPaneProps } from "./rightpane/ChatRightPane.tsx";

/** The column the pane takes beside the chat on a wide window. */
export const AGENT_PANE_W = WIDE_PANE_W;

export function AgentPane(props: ChatRightPaneProps): ReactElement {
  return <ChatRightPane {...props} />;
}
