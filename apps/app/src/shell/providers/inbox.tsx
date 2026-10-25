// Inbox in the shell (spec 3.3): the sidebar (inboxes, numbers, channels, calendars) on the left; in the middle the contact list, a contact's conversation once one is opened, or the
// Calendar when the sidebar asks for it. The Inbox's own UI state (view, scope, filters, selection) is one reducer shared by the sidebar and the list. Before the Space's runtime
// exists the place draws its loading frame.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Calendar } from "../../places/inbox/calendar/index.ts";
import { ContactList, ListLoading } from "../../places/inbox/contactlist/index.ts";
import { ContactTab } from "../../places/inbox/contacttab/index.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider, SidebarLoading, useInboxState } from "../../places/inbox/sidebar/index.ts";
import type { InboxData, InboxNav } from "../../places/inbox/sidebar/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export const SIDEBAR_W = 264;

export function inboxData(rt: ShellRuntime, openConversation: (id: string) => void): InboxData {
  const nav: InboxNav = {
    openConversation,
    openThread: (threadId) => rt.open({ screen: "chats.conversation", args: { threadId } }),
    openCall: (callId) => rt.open({ subject: { type: "call", id: callId } }),
    openCalendar: () => undefined,
    openDialer: () => rt.open({ screen: "inbox.dialer" }),
    openMatch: (conversationId) => rt.open({ screen: "inbox.match", args: { conversationId } }),
    compose: () => rt.open({ screen: "inbox.compose" }),
    connect: (kind) => rt.open({ screen: "mail.connections", args: { kind } }),
    openInboxSettings: (inboxId) => rt.open({ screen: "settings.page", args: { page: "inboxes", inboxId } }),
  };
  return { screens: rt.screens, call: rt.call, connection: rt.connection, clock: rt.clock, nav };
}

export function InboxLoading(): ReactElement {
  return (
    <View testID="inbox-place-loading" accessibilityLabel="Loading" style={st.row}>
      <View style={st.side}><SidebarLoading /></View>
      <View style={st.main}><ListLoading /></View>
    </View>
  );
}

function Main({ rt, openId, close }: { rt: ShellRuntime; openId: string | null; close: () => void }): ReactElement {
  const { state } = useInboxState();
  // Choosing another inbox, view, filter or the Calendar in the sidebar leaves the open conversation and shows the list again.
  useEffect(() => { close(); }, [state.scope, state.view, state.main, state.channels, state.inboxes, state.needsMatch]); // eslint-disable-line react-hooks/exhaustive-deps -- close is stable in effect
  if (state.main === "calendar") return <Calendar me={rt.me.id} team={[]} />;
  if (openId) return <ContactTab key={openId} conversationId={openId} onOpenRecord={(contactId, recordId) => rt.open({ subject: { type: "record", id: recordId ?? contactId } })} onAsk={(contactId) => rt.open({ screen: "chats.conversation", args: { with: "assistant", ...(contactId ? { contactId } : {}) } })} />;
  return <ContactList />;
}

function InboxView({ rt }: { rt: ShellRuntime }): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  const data = useMemo(() => inboxData(rt, setOpenId), [rt]);
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider>
        <View testID="inbox-place" style={st.row}>
          <View style={st.side}><InboxSidebar /></View>
          <View style={st.main}><Main rt={rt} openId={openId} close={() => setOpenId(null)} /></View>
        </View>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}

export default function InboxPlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <InboxView rt={rt} /> : <InboxLoading />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
});
