// The Inbox navigation/data adapter is shared by the lazy Inbox place and the
// optional phone dock. Keep it free of Inbox UI imports so phone setup cannot
// promote the full place into the startup common chunk.
import type { InboxData, InboxNav } from "../../places/inbox/sidebar/data.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function inboxData(rt: ShellRuntime, openConversation: (id: string) => void): InboxData {
  const nav: InboxNav = {
    openConversation,
    openThread: (threadId) => rt.open({ screen: "chats.conversation", args: { threadId } }),
    openCall: (callId) => rt.open({ subject: { type: "call", id: callId } }),
    openCalendar: () => undefined,
    openDialer: () => rt.open({ screen: "telephony.softphone" }),
    openMatch: (conversationId) => rt.open({ screen: "inbox.unmatched", args: { conversationId } }),
    compose: () => rt.open({ screen: "mail.message-detail" }),
    connect: (kind) => rt.open({ screen: "mail.connections", args: { kind } }),
    openInboxSettings: (inboxId) => rt.open({ screen: "settings.page", args: { page: "inboxes", inboxId } }),
  };
  return { screens: rt.screens, call: rt.call, connection: rt.connection, clock: rt.clock, nav };
}
