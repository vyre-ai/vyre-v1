// Inbox in the shell (spec 3.3): the sidebar (inboxes, numbers, channels, calendars) on the left; in the middle the contact list, a contact's conversation once one is opened, or the
// Calendar when the sidebar asks for it. The Inbox's own UI state (view, scope, filters, selection) is one reducer shared by the sidebar and the list. Before the Space's runtime
// exists the place draws its loading frame.
import { useEffect, useMemo, useRef, useState } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { PhoneDeviceLike } from "../../../../../ui/src/Softphone/index.tsx";
import { Calendar } from "../../places/inbox/calendar/Calendar.tsx";
import { ContactList, ListLoading } from "../../places/inbox/contactlist/ContactList.tsx";
import { ContactTab } from "../../places/inbox/contacttab/ContactTab.tsx";
import { InboxDataProvider } from "../../places/inbox/sidebar/data.tsx";
import type { InboxData } from "../../places/inbox/sidebar/data.tsx";
import { InboxSidebar, SidebarLoading } from "../../places/inbox/sidebar/InboxSidebar.tsx";
import { InboxStateProvider, useInboxState } from "../../places/inbox/sidebar/state.tsx";
import { InboxPhoneDock } from "../../places/inbox/softphone/phone.tsx";
import { CallTitlePill } from "../../places/inbox/softphone/pill.tsx";
import { inboxData } from "./inbox-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export { inboxData } from "./inbox-data.ts";

/** The optional global phone shares Inbox's already-lazy production chunk. */
export function InboxPhoneShell({ device, data, children }: { device: PhoneDeviceLike; data: InboxData; children: ReactNode }): ReactElement {
  return <InboxDataProvider value={data}><InboxPhoneDock device={device}>{children}</InboxPhoneDock></InboxDataProvider>;
}

export { CallTitlePill as InboxCallTitlePill };

export const SIDEBAR_W = 264;

export function InboxLoading(): ReactElement {
  return (
    <View testID="inbox-place-loading" accessibilityLabel="Loading" style={st.row}>
      <View style={st.side}><SidebarLoading /></View>
      <View style={st.main}><ListLoading /></View>
    </View>
  );
}

function Main({ rt, openId, close }: { rt: ShellRuntime; openId: string | null; close: () => void }): ReactElement {
  const missing = useMissing(rt.screens, "inbox.contact-tab", "thread", openId ? { conversationId: openId } : null);
  const { state } = useInboxState();
  // Choosing another inbox, view, filter or the Calendar in the sidebar leaves the open conversation and shows the list again.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } close(); }, [state.scope, state.view, state.main, state.channels, state.inboxes, state.needsMatch]); // eslint-disable-line react-hooks/exhaustive-deps -- close is stable in effect
  if (state.main === "calendar") return <Calendar me={rt.me.id} team={[]} />;
  if (openId && missing) return <NotFound what="conversation" />;
  if (openId) return <ContactTab key={openId} conversationId={openId} onOpenRecord={(contactId, recordId) => rt.open({ subject: { type: "record", id: recordId ?? contactId } })} onAsk={(contactId) => rt.open({ screen: "chats.conversation", args: { with: "assistant", ...(contactId ? { contactId } : {}) } })} />;
  return <ContactList />;
}

function InboxView({ rt }: { rt: ShellRuntime }): ReactElement {
  const { opened } = usePlaceHash();
  const hashed = useOpenedId(["conversation", "call"], ["conversationId"]);
  const [picked, setOpenId] = useState<string | null>(null);
  const openId = picked ?? hashed;
  const data = useMemo(() => inboxData(rt, (id) => { setOpenId(id); opened({ subject: { type: "conversation", id } }); }), [rt, opened]);
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider>
        <View testID="inbox-place" style={st.row}>
          <View style={st.side}><InboxSidebar /></View>
          <View style={st.main}><Main rt={rt} openId={openId} close={() => setOpenId("")} /></View>
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
