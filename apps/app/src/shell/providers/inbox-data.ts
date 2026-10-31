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
    // no compose screen exists yet (message-detail only reads a message), so New message opens the assistant to draft it
    compose: () => rt.open({ screen: "chats.conversation", args: { with: rt.assistant.id, about: "compose:email", draft: "Draft an email to " } }),
    // Twilio is an account, not a mailbox: its Account SID and Auth Token go to the Vault from the Twilio template
    connect: (kind) => kind === "twilio" ? rt.open({ screen: "vault.layout", args: { add: "twilio" } }) : rt.open({ screen: "settings.page", args: { page: "connections" } }),
    openEmailDesign: (emailId) => rt.open({ screen: "apps.email-builder", ...(emailId ? { args: { emailId } } : {}) }),
    openInboxSettings: (inboxId) => rt.open({ screen: "settings.page", args: { page: "inboxes", inboxId } }),
  };
  return { screens: rt.screens, call: rt.call, connection: rt.connection, clock: rt.clock, nav };
}
